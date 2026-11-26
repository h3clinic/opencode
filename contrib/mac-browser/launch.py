"""Run one OpenCode terminal and one MCP-controlled WebKit view in a split window."""
import asyncio
import base64
import fcntl
import json
import os
from pathlib import Path
import pty
import shutil
import signal
import struct
import sys
import tempfile
import termios
from uuid import uuid4

ROOT = Path(__file__).resolve().parent


async def launch(bin_dir, workspace, session):
    endpoint = session / "browser.sock"
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required for the MCP server.")
    config = {"mcp": {"servers": {"sidebrowser": {
        "type": "local", "codemode": False, "command": [node, str(ROOT / "mcp.mjs")],
        "environment": {"OPENCODE_SIDEBROWSER_SOCKET": str(endpoint)},
    }}}}
    config_path = session / "opencode.json"
    config_path.write_text(json.dumps(config))
    ui = await asyncio.create_subprocess_exec(str(bin_dir / "sidebrowser"), str(ROOT),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, limit=1024 * 1024)
    loop = asyncio.get_running_loop()
    waiting = {}
    terminal = None
    pid = None
    size = (32, 80)

    def send(message):
        ui.stdin.write(json.dumps(message).encode() + b"\n")

    async def handle(reader, writer):
        request_id = str(uuid4())
        try:
            request = json.loads(await asyncio.wait_for(reader.readline(), 5))
            future = loop.create_future()
            waiting[request_id] = future
            send({**request, "id": request_id})
            reply = await asyncio.wait_for(future, 22)
        except Exception as error:
            reply = {"error": str(error) or type(error).__name__}
        finally:
            waiting.pop(request_id, None)
        try:
            writer.write(json.dumps(reply).encode())
            await writer.drain()
        finally:
            writer.close()

    def read_terminal():
        try:
            chunk = os.read(terminal, 32768)
        except OSError:
            chunk = b""
        if chunk:
            send({"output": base64.b64encode(chunk).decode()})
        else:
            loop.remove_reader(terminal)
            ui.terminate()

    server = await asyncio.start_unix_server(handle, path=str(endpoint))
    try:
        while line := await ui.stdout.readline():
            msg = json.loads(line)
            if "id" in msg:
                future = waiting.get(msg["id"])
                if future and not future.done():
                    future.set_result(msg)
            elif msg["kind"] == "ready" and terminal is None:
                pid, terminal = pty.fork()
                if pid == 0:
                    try:
                        os.chdir(workspace)
                        env = dict(os.environ, OPENCODE_CONFIG=str(config_path), TERM="xterm-256color",
                                   COLORTERM="truecolor")
                        os.execve(str(bin_dir / "opencode"), ["opencode", "--standalone", "."], env)
                    finally:
                        os._exit(1)
                loop.add_reader(terminal, read_terminal)
                fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", *size, 0, 0))
            elif msg["kind"] == "input" and terminal is not None:
                os.write(terminal, msg["data"].encode())
            elif msg["kind"] == "resize":
                size = (msg["rows"], msg["cols"])
                if terminal is not None:
                    fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", *size, 0, 0))
    finally:
        server.close()
        await server.wait_closed()
        if terminal is not None:
            loop.remove_reader(terminal)
            os.close(terminal)
        if pid:
            try:
                os.kill(pid, signal.SIGHUP)
            except ProcessLookupError:
                pass
            os.waitpid(pid, 0)
        if ui.returncode is None:
            ui.stdin.close()
        await ui.wait()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="opencode-browser-", dir="/tmp") as directory:
        asyncio.run(launch(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), Path(directory)))
