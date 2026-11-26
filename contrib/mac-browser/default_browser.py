"""Open the system HTTPS handler alongside OpenCode, with MCP on supported browsers."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent
CHROMIUM = {"com.google.Chrome", "org.chromium.Chromium", "com.microsoft.edgemac",
            "com.brave.Browser"}


def browser_endpoint(browser, profile):
    discovery = profile / "DevToolsActivePort"
    for _ in range(200):
        if browser.poll() is not None:
            raise RuntimeError("Browser exited during startup.")
        if discovery.exists():
            lines = discovery.read_text().splitlines()
            if len(lines) == 2 and lines[0].isdigit() and lines[1].startswith("/devtools/browser/"):
                return f"ws://127.0.0.1:{lines[0]}{lines[1]}"
        time.sleep(0.1)
    raise RuntimeError("Browser did not publish a local automation endpoint.")


def launch(bin_dir, workspace):
    default = json.loads(subprocess.check_output([bin_dir / "sidebrowser", "--default-browser"]))
    cli = [str(bin_dir / "opencode"), "--standalone", "."]
    if default["identifier"] not in CHROMIUM:
        subprocess.run(["open", "-a", default["application"]], check=True)
        print("Opened the system browser. For browser MCP on this browser configuration, use the WebKit launcher.", flush=True)
        return subprocess.call(cli, cwd=workspace)
    with tempfile.TemporaryDirectory(prefix="opencode-chrome-", dir="/tmp") as directory:
        root = Path(directory)
        profile = root / "profile"
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Node.js is required for browser MCP.")
        browser = subprocess.Popen([default["executable"], "--user-data-dir=" + str(profile),
                "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
                "--no-first-run", "--no-default-browser-check", "--new-window", "about:blank"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            endpoint = browser_endpoint(browser, profile)
            config = root / "opencode.json"
            config.write_text(json.dumps({"mcp":{"servers":{"sidebrowser":{
                "type":"local", "codemode":False, "command":[node,
                str(ROOT / "node_modules/@playwright/mcp/cli.js"), "--cdp-endpoint", endpoint]
            }}}}))
            return subprocess.call(cli, cwd=workspace, env=dict(os.environ, OPENCODE_CONFIG=str(config)))
        finally:
            if browser.poll() is None:
                browser.terminate()
                try:
                    browser.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    browser.kill()
                    browser.wait()


if __name__ == "__main__":
    sys.exit(launch(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()))
