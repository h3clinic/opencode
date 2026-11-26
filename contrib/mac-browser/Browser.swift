import Cocoa
import WebKit

typealias Message = [String: Any]

final class Browser: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSTextFieldDelegate {
    let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let terminal = WKWebView()
    let page: WKWebView = {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        return WKWebView(frame: .zero, configuration: config)
    }()
    let address = NSTextField()
    var window: NSWindow!
    var observer: NSKeyValueObservation?
    var pageScript = ""
    var loading: (navigation: WKNavigation, id: String)?

    func emit(_ message: Message) {
        guard var data = try? JSONSerialization.data(withJSONObject: message) else { return }
        data.append(10)
        FileHandle.standardOutput.write(data)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        pageScript = (try? String(contentsOf: root.appendingPathComponent("page.js"), encoding: .utf8)) ?? ""
        terminal.configuration.userContentController.add(self, name: "terminal")
        terminal.navigationDelegate = self
        page.navigationDelegate = self
        address.placeholderString = "Enter a web address"
        address.target = self
        address.action = #selector(openAddress)
        address.delegate = self
        observer = page.observe(\.url, options: [.new]) { [weak self] page, _ in
            self?.address.stringValue = page.url?.absoluteString ?? ""
        }
        let back = NSButton(title: "Back", target: self, action: #selector(goBack))
        let forward = NSButton(title: "Forward", target: self, action: #selector(goForward))
        let bar = NSStackView(views: [back, forward, address])
        bar.edgeInsets = NSEdgeInsets(top: 5, left: 6, bottom: 5, right: 6)
        address.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let right = NSStackView(views: [bar, page])
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
        if view === page, allowed, action.targetFrame == nil {
            decisionHandler(.cancel)
            page.load(action.request)
        } else { decisionHandler(allowed ? .allow : .cancel) }
    }
    @objc func goBack() { page.goBack() }
    @objc func goForward() { page.goForward() }
    @objc func openAddress() {
        let raw = address.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = webURL(raw.contains("://") ? raw : "https://" + raw) { page.load(URLRequest(url: url)) }
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
        if op == "navigate" {
            guard let url = webURL(args["url"] as? String ?? "") else {
                emit(["id": id,"error": "Enter an HTTP or HTTPS URL."]); return
            }
            if let prior = loading { emit(["id": prior.id,"error":"Navigation replaced."]) }
            loading = nil
            if let nav = page.load(URLRequest(url: url)) { loading = (nav, id) }
            else { emit(["id":id,"error":"Could not start navigation."]) }
            return
        }
        page.callAsyncJavaScript(pageScript, arguments: ["operation":op,"args":args], in: nil, in: .defaultClient) { result in
            switch result {
            case .success(let value): self.emit(["id": id,"value": value ?? NSNull()])
            case .failure(let error): self.emit(["id": id,"error": error.localizedDescription])
            }
        }
    }
    func finish(_ nav: WKNavigation?, _ error: Error? = nil) {
        guard let current = loading, current.navigation === nav else { return }
        loading = nil
        if let error = error { emit(["id":current.id,"error":error.localizedDescription]) }
        else { emit(["id":current.id,"value":["url":page.url?.absoluteString ?? ""]]) }
    }
    func webView(_ view: WKWebView, didFinish nav: WKNavigation!) { if view === page { finish(nav) } }
    func webView(_ view: WKWebView, didFail nav: WKNavigation!, withError error: Error) { finish(nav,error) }
    func webView(_ view: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) { finish(nav,error) }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let browser = Browser()
app.delegate = browser
app.run()
