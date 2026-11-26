# macOS browser beside the OpenCode terminal

This companion displays the fork's terminal and a WebKit view in one resizable window. OpenCode starts a stdio MCP server with four tools: navigate, snapshot, click and fill. Each launched window gets a private Unix socket and an ephemeral WebKit profile. Page snapshots describe visible controls in the top document. Take a fresh snapshot after navigation. Canvas, iframe and native dialog automation are outside the current tool set.

To run on macOS with Xcode command-line tools, Node.js and an OpenCode executable:

```sh
npm ci
# BIN_DIR contains the opencode executable.
swiftc Browser.swift -o "$BIN_DIR/sidebrowser"
python3 launch.py "$BIN_DIR" "$WORKSPACE"
```

Drag the divider to resize the panes. Enter an HTTP or HTTPS address on the right, or ask the agent to open one. The launcher supplies its MCP config for this process and leaves the project's model selection in place.
