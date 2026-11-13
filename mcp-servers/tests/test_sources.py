"""Check imported sources and MCP discovery without running security tools."""

import ast
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


ROOT = Path(__file__).resolve().parents[1]


class SourceTests(unittest.TestCase):
    def test_upstream_source_and_license_hashes(self):
        records = json.loads((ROOT / "UPSTREAM.json").read_text(encoding="utf-8"))
        self.assertEqual(len(records), 2)
        files = [entry for record in records for entry in record["files"]]
        self.assertEqual(len(files), 5)
        for entry in files:
            with self.subTest(file=entry["localPath"]):
                content = (ROOT / entry["localPath"]).read_bytes()
                self.assertEqual(hashlib.sha256(content).hexdigest(), entry["sha256"])
                if entry["localPath"].endswith(".py"):
                    compile(content, entry["localPath"], "exec")

    def test_terminal_control_frames_preserve_keystrokes(self):
        # The POSIX-only module cannot import on Windows; compile its actual pure parser.
        tree = ast.parse((ROOT / "redamon/terminal_server.py").read_text(encoding="utf-8"))
        parser = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_control_frame")
        namespace = {"json": json, "_CONTROL_TYPES": ("resize", "ping")}
        exec(compile(ast.Module(body=[parser], type_ignores=[]), "terminal_server.py", "exec"), namespace)
        parse = namespace["_control_frame"]
        self.assertEqual(parse('{"type":"resize","rows":30,"cols":100}'), {"type": "resize", "rows": 30, "cols": 100})
        self.assertEqual(parse('{"type":"ping"}'), {"type": "ping"})
        for text in ["ls\n", "42", "true", "null", '"pasted text"', "[]", '{"type":[]}', '{"type":"command"}']:
            with self.subTest(text=text):
                self.assertIsNone(parse(text))


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def check_server(self, relative, expected, *, status=False):
        env = {key: value for key, value in os.environ.items() if key.upper() in {"PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE"}}
        env["MCP_TRANSPORT"] = "stdio"
        server = StdioServerParameters(command=sys.executable, args=[str(ROOT / relative)], env=env)
        async with stdio_client(server) as (reader, writer):
            async with ClientSession(reader, writer) as session:
                await asyncio.wait_for(session.initialize(), timeout=20)
                result = await asyncio.wait_for(session.list_tools(), timeout=10)
                self.assertEqual({tool.name for tool in result.tools}, expected)
                if status:
                    result = await asyncio.wait_for(session.call_tool("reverse_shell_status", {}), timeout=10)
                    self.assertFalse(result.isError)
                    text = "\n".join(block.text for block in result.content if block.type == "text")
                    self.assertIn("监听中: False", text)
                    self.assertIn("已连接: False", text)

    async def test_reverse_shell_stdio_discovery_and_idle_status(self):
        await self.check_server("reverse_shell/mcp_reverse_shell.py", {
            "reverse_shell_start_listener", "reverse_shell_stop_listener", "reverse_shell_status",
            "reverse_shell_send_command", "reverse_shell_disconnect",
        }, status=True)

    async def test_metasploit_stdio_discovery(self):
        await self.check_server("redamon/metasploit_server.py", {"metasploit_console", "msf_restart"})


if __name__ == "__main__":
    unittest.main()
