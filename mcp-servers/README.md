---
description: "Optional security-tool sources, upstream licenses, transports and isolated verification."
---
# Optional security-tool sources

English | [中文](README.zh.md)

## Summary

Keep the optional Reverse Shell and RedAmon sources with their upstream licenses and a reproducible Python dependency environment. These files require explicit deployment configuration; this directory does not register tools, start services or enforce VPN routing.

## Table of Contents

- [Sources and transports](#sources-and-transports)
- [Execution and access](#execution-and-access)
- [Dependencies and verification](#dependencies-and-verification)
- [Licenses](#licenses)
- [Dev Note](#dev-note)

<a id="sources-and-transports"></a>

## Sources and transports

| Source | Transport | Runtime requirement |
| --- | --- | --- |
| [Reverse Shell](reverse_shell/mcp_reverse_shell.py) | MCP stdio | Python; a listener starts only through its start tool |
| [RedAmon Metasploit](redamon/metasploit_server.py) | MCP stdio by default; optional SSE | Linux/Kali and `msfconsole` for console operations |
| [RedAmon Terminal](redamon/terminal_server.py) | WebSocket PTY | POSIX PTY APIs and `/bin/bash`; keep the existing Harness Terminal for Harness sessions |

The WebSocket terminal is a standalone upstream source, without a stdio MCP interface. The [Reverse Shell guide](reverse_shell/README.md) describes its upstream tool workflow. [UPSTREAM.json](UPSTREAM.json) records the exact upstream revisions, paths and SHA-256 hashes; the imported Python files are unchanged.

<a id="execution-and-access"></a>

## Execution and access

Only run these sources in an authorized, isolated execution environment. The RedAmon WebSocket terminal listens on `0.0.0.0:8016` by default and grants connected clients a shell as its process user. It has no authentication. RedAmon Metasploit's optional SSE mode also starts HTTP session-control endpoints; those endpoints have no authentication and bind all interfaces by default. Keep these listeners behind private networking and explicit firewall restrictions; do not expose their ports publicly.

The deployment owns VPN routing and fail-closed egress controls. A source checkout, a successful MCP handshake or a passing test does not establish VPN protection. Keep the deployed broker and network policy in force before running network tools.

[Arsenal](../scripts/sb-arsenal.cjs) contains optional command adapters inspired by the CyberStrikeAI and RedAmon tool inventories. Its exported `TOOLS` and CLI `list` output own the available catalog. An adapter does not install its binary. Parameters such as `additional_args` are trusted Bash fragments and can execute additional commands; accept them only from callers authorized to run shell commands. Commands and output are retained in Arsenal evidence logs, so avoid supplying credentials that must not be logged.

<a id="dependencies-and-verification"></a>

## Dependencies and verification

Use uv with a supported Python interpreter. The project declares Python 3.10 or newer; the Windows verification uses Python 3.13. The lockfile records Python packages only; installing it does not install Kali tools or `msfconsole`.

Run from the repository root:

```sh
uv sync --project mcp-servers --locked --python 3.13
uv run --project mcp-servers --locked --python 3.13 python -m unittest discover -s mcp-servers/tests -v
node --test scripts/sb-arsenal-tools-test.cjs
node scripts/sb-wsl-routing-test.cjs
node scripts/sb-arsenal.cjs list
```

The Python checks verify source/license hashes, syntax, MCP initialization and tool discovery. The Reverse Shell status call runs without starting a listener or connecting to a target. Terminal control-frame checks exercise its parser without starting a PTY. The Node checks verify command construction and simulated Windows/WSL and Linux routing without launching scanners. These checks do not validate exploitation, an active listener, a real Metasploit console or a deployed network policy.

<a id="licenses"></a>

## Licenses

CyberStrikeAI's Reverse Shell source uses [Apache-2.0](reverse_shell/LICENSE). RedAmon's Metasploit and terminal sources use [MIT](redamon/LICENSE), including the upstream copyright notice. Preserve these files when redistributing the imported sources. The repository's root license does not replace their notices.

<a id="dev-note"></a>

## Dev Note

None.
