# macOS browser beside the OpenCode terminal

This companion displays the fork's terminal and a tabbed WebKit browser in one resizable window. OpenCode starts a stdio MCP server with tools to list, open, focus and close tabs, plus navigate, snapshot, click and fill. Each tab has a stable ID. Page tools accept a tabID to target one tab even when the user views another. Omitting it targets the selected tab at dispatch. Each launched window gets a private Unix socket and an ephemeral WebKit profile. Page snapshots describe visible controls in the top document. Take a fresh snapshot after navigation. Canvas, iframe and native dialog automation are outside the current tool set.

To run on macOS with Xcode command-line tools, Node.js and an OpenCode executable:

```sh
npm ci
# BIN_DIR contains the opencode executable.
swiftc Browser.swift -o "$BIN_DIR/sidebrowser"
python3 launch.py "$BIN_DIR" "$WORKSPACE"
```

Drag the divider to resize the panes. Enter an HTTP or HTTPS address on the right, or ask the agent to open one. The launcher supplies its MCP config for this process and leaves the project's model selection in place.

Use + to open a blank tab, click its title to switch, and × to close the selected tab. Closing the last tab opens a fresh blank one. To exercise tab routing in a running companion, run `OPENCODE_SIDEBROWSER_SOCKET=/path/to/session/browser.sock node tabs-test.mjs`. The test serves two loopback pages and restores the original tab.
