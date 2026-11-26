import Cocoa
import WebKit

typealias Message = [String: Any]

final class Browser: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSTextFieldDelegate, NSTabViewDelegate {
    let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let terminal = WKWebView()
    let tabs = NSTabView()
    let storage = WKWebsiteDataStore.nonPersistent()
    var observers: [String: [NSKeyValueObservation]] = [:]
    var selected: WKWebView? { tabs.selectedTabViewItem?.view as? WKWebView }
    let address = NSTextField()
    var window: NSWindow!
    var pageScript = ""
    var loading: [ObjectIdentifier: (navigation: WKNavigation, id: String)] = [:]

    func emit(_ message: Message) {
        guard var data = try? JSONSerialization.data(withJSONObject: message) else { return }
        data.append(10)
        FileHandle.standardOutput.write(data)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        pageScript = (try? String(contentsOf: root.appendingPathComponent("page.js"), encoding: .utf8)) ?? ""
        terminal.configuration.userContentController.add(self, name: "terminal")
        terminal.navigationDelegate = self
        tabs.delegate = self
        _ = newTab()
        address.placeholderString = "Enter a web address"
        address.target = self
        address.action = #selector(openAddress)
        address.delegate = self
        let back = NSButton(title: "Back", target: self, action: #selector(goBack))
        let forward = NSButton(title: "Forward", target: self, action: #selector(goForward))
        let add = NSButton(title: "+", target: self, action: #selector(addTab))
        add.toolTip = "New tab"
        add.setAccessibilityLabel("New tab")
        let close = NSButton(title: "×", target: self, action: #selector(closeSelected))
        close.toolTip = "Close current tab"
        close.setAccessibilityLabel("Close current tab")
        let bar = NSStackView(views: [back, forward, address, add, close])
        bar.edgeInsets = NSEdgeInsets(top: 5, left: 6, bottom: 5, right: 6)
        address.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let right = NSStackView(views: [bar, tabs])
        right.orientation = .vertical
        right.alignment = .width
        right.spacing = 0
        let split = NSSplitView()
        split.isVertical = true
        split.dividerStyle = .thin
        split.addArrangedSubview(terminal)
        split.addArrangedSubview(right)
        let frame = (NSScreen.main?.visibleFrame ?? NSRect(x: 0,y: 0,width: 1200,height: 800)).insetBy(dx: 24,dy: 24)
        window = NSWindow(contentRect: frame, styleMask: [.titled,.resizable,.closable,.miniaturizable], backing: .buffered, defer: false)
        window.title = "OpenCode · Browser"
        window.contentView = split
        split.setPosition(frame.width * 0.52, ofDividerAt: 0)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        terminal.loadFileURL(root.appendingPathComponent("terminal.html"), allowingReadAccessTo: root)
        DispatchQueue.global().async {
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let message = try? JSONSerialization.jsonObject(with: data) as? Message else { continue }
                DispatchQueue.main.async { self.receive(message) }
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.webView === terminal, message.frameInfo.isMainFrame, let body = message.body as? Message {
            emit(body)
        }
    }
    func webView(_ view: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = action.request.url
        let allowed = view === terminal ? url == root.appendingPathComponent("terminal.html") :
            ["https", "http", "about"].contains(url?.scheme?.lowercased() ?? "")
        if view !== terminal, allowed, action.targetFrame == nil {
            decisionHandler(.cancel)
            if let page = newTab().view as? WKWebView { page.load(action.request) }
        } else { decisionHandler(allowed ? .allow : .cancel) }
    }
    func newTab() -> NSTabViewItem {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = storage
        let page = WKWebView(frame: .zero, configuration: config)
        page.navigationDelegate = self
        let id = UUID().uuidString
        let item = NSTabViewItem(identifier: id)
        item.label = "New tab"
        item.view = page
        observers[id] = [
            page.observe(\.url) { [weak self] page, _ in
                if self?.selected === page { self?.address.stringValue = page.url?.absoluteString ?? "" }
                if page.title?.isEmpty != false { item.label = page.url?.host ?? "New tab" }
            },
            page.observe(\.title) { page, _ in item.label = page.title ?? page.url?.host ?? "New tab" }
        ]
        tabs.addTabViewItem(item)
        tabs.selectTabViewItem(item)
        return item
    }
    func closeTab(_ item: NSTabViewItem) {
        if let page = item.view as? WKWebView {
            if let request = loading.removeValue(forKey: ObjectIdentifier(page)) {
                emit(["id":request.id,"error":"Tab closed."])
            }
            page.stopLoading()
        }
        if let id = item.identifier as? String { observers.removeValue(forKey: id) }
        tabs.removeTabViewItem(item)
        if tabs.numberOfTabViewItems == 0 { _ = newTab() }
    }
    func tabView(_ tabView: NSTabView, didSelect tabViewItem: NSTabViewItem?) {
        address.stringValue = (tabViewItem?.view as? WKWebView)?.url?.absoluteString ?? ""
    }
    @objc func addTab() { _ = newTab(); window.makeFirstResponder(address) }
    @objc func closeSelected() { if let item = tabs.selectedTabViewItem { closeTab(item) } }
    @objc func goBack() { selected?.goBack() }
    @objc func goForward() { selected?.goForward() }
    @objc func openAddress() {
        let raw = address.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = webURL(raw.contains("://") ? raw : "https://" + raw) { selected?.load(URLRequest(url: url)) }
    }
    func webURL(_ value: String) -> URL? {
        guard let url = URL(string: value), let scheme = url.scheme?.lowercased(),
              ["http","https"].contains(scheme), url.host != nil else { return nil }
        return url
    }

    func receive(_ message: Message) {
        if let data = message["output"] as? String {
            terminal.callAsyncJavaScript("window.output(data)", arguments: ["data": data], in: nil, in: .page, completionHandler: nil)
            return
        }
        guard let id = message["id"] as? String, let op = message["operation"] as? String,
              let args = message["args"] as? Message else { return }
        if op == "tabs_list" {
            let inventory: [Message] = tabs.tabViewItems.map { item in
                ["tabID": item.identifier as? String ?? "", "title": item.label,
                 "url": (item.view as? WKWebView)?.url?.absoluteString ?? "about:blank",
                 "selected": item === tabs.selectedTabViewItem]
            }
            emit(["id":id,"value":inventory]); return
        }
        if op == "tabs_open" {
            let item = newTab()
            emit(["id":id,"value":["tabID":item.identifier as? String ?? ""]]); return
        }
        let item: NSTabViewItem?
        if let target = args["tabID"] as? String {
            item = tabs.tabViewItems.first { $0.identifier as? String == target }
        } else { item = tabs.selectedTabViewItem }
        guard let tab = item, let page = tab.view as? WKWebView else {
            emit(["id":id,"error":"Unknown tab. List the open tabs again."]); return
        }
        if op == "tabs_focus" || op == "tabs_close" {
            if op == "tabs_focus" { tabs.selectTabViewItem(tab) } else { closeTab(tab) }
            emit(["id":id,"value":["performed":op]]); return
        }
        let key = ObjectIdentifier(page)
        if op == "navigate" {
            guard let url = webURL(args["url"] as? String ?? "") else {
                emit(["id": id,"error": "Enter an HTTP or HTTPS URL."]); return
            }
            if let prior = loading.removeValue(forKey: key) { emit(["id": prior.id,"error":"Navigation replaced."]) }
            if let nav = page.load(URLRequest(url: url)) { loading[key] = (nav, id) }
            else { emit(["id":id,"error":"Could not start navigation."]) }
            return
        }
        page.callAsyncJavaScript(pageScript, arguments: ["operation":op,"args":args], in: nil, in: .defaultClient) { result in
            switch result {
            case .success(let value): self.emit(["id": id,"value": value])
            case .failure(let error): self.emit(["id": id,"error": error.localizedDescription])
            }
        }
    }
    func finish(_ page: WKWebView, _ nav: WKNavigation?, _ error: Error? = nil) {
        let key = ObjectIdentifier(page)
        guard let current = loading[key], current.navigation === nav else { return }
        loading.removeValue(forKey: key)
        if let error = error { emit(["id":current.id,"error":error.localizedDescription]) }
        else { emit(["id":current.id,"value":["url":page.url?.absoluteString ?? ""]]) }
    }
    func webView(_ view: WKWebView, didFinish nav: WKNavigation!) { finish(view,nav) }
    func webView(_ view: WKWebView, didFail nav: WKNavigation!, withError error: Error) { finish(view,nav,error) }
    func webView(_ view: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) { finish(view,nav,error) }
}
if CommandLine.arguments.dropFirst().first == "--default-browser" {
    guard let url = NSWorkspace.shared.urlForApplication(toOpen: URL(string: "https://example.com")!),
          let bundle = Bundle(url: url), let executable = bundle.executableURL,
          let identifier = bundle.bundleIdentifier else { exit(1) }
    let result = ["application":url.path,"executable":executable.path,"identifier":identifier]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
    exit(0)
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let browser = Browser()
app.delegate = browser
app.run()
