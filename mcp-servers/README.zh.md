---
description: "可选安全工具源码、上游许可证、传输方式与隔离验证。"
---
# 可选安全工具源码

[English](README.md) | 中文

## 概述

将可选的 Reverse Shell 和 RedAmon 源码、上游许可证及可复现的 Python 依赖环境一同保存。这些文件需要显式部署配置；本目录不注册工具、不启动服务，也不实施 VPN 路由控制。

## 目录

- [源码与传输方式](#sources-and-transports)
- [执行与访问](#execution-and-access)
- [依赖与验证](#dependencies-and-verification)
- [许可证](#licenses)
- [开发备注](#dev-note)

<a id="sources-and-transports"></a>

## 源码与传输方式

| 源码 | 传输方式 | 运行时要求 |
| --- | --- | --- |
| [Reverse Shell](reverse_shell/mcp_reverse_shell.py) | MCP stdio | Python；仅通过启动工具开启监听器 |
| [RedAmon Metasploit](redamon/metasploit_server.py) | 默认 MCP stdio；可选 SSE（Server-Sent Events） | 控制台操作需要 Linux/Kali 和 `msfconsole` |
| [RedAmon Terminal](redamon/terminal_server.py) | WebSocket PTY | POSIX PTY API 和 `/bin/bash`；Harness 会话继续使用现有 Harness Terminal |

WebSocket 终端是独立的上游源码，不提供 stdio MCP 接口。[Reverse Shell 指南](reverse_shell/README.zh.md)介绍其上游工具工作流。[UPSTREAM.json](UPSTREAM.json)记录精确的上游修订、路径和 SHA-256 哈希；导入的 Python 文件未作修改。

<a id="execution-and-access"></a>

## 执行与访问

仅在获授权且隔离的执行环境中运行这些源码。RedAmon WebSocket 终端默认监听 `0.0.0.0:8016`，并向连接的客户端提供以其进程用户身份运行的 shell。它没有身份验证。RedAmon Metasploit 的可选 SSE 模式还会启动 HTTP 会话控制端点；这些端点没有身份验证，并默认绑定所有接口。通过私有网络和显式防火墙限制保护这些监听器；不要向公网暴露其端口。

部署方负责 VPN 路由和故障时阻止外连的控制措施。源码检出、成功的 MCP 握手或通过的测试均不能证明 VPN 防护有效。在运行网络工具前，必须保留已部署的 broker 和网络策略。

[Arsenal](../scripts/sb-arsenal.cjs)包含参考 CyberStrikeAI 和 RedAmon 工具清单编写的可选命令适配器。其导出的 `TOOLS` 和 CLI（命令行界面）`list` 输出是可用目录的权威来源。适配器不会安装对应的可执行文件。`additional_args` 等参数是受信任的 Bash 片段，可以执行额外命令；仅接受已获授权执行 shell 命令的调用方提供的此类参数。Arsenal 证据日志会保存命令和输出，因此不要传入禁止记录的凭据。

<a id="dependencies-and-verification"></a>

## 依赖与验证

将 uv 与受支持的 Python 解释器配合使用。项目声明需要 Python 3.10 或更新版本；Windows 验证使用 Python 3.13。锁文件仅记录 Python 包；安装依赖不会安装 Kali 工具或 `msfconsole`。

从仓库根目录运行：

```sh
uv sync --project mcp-servers --locked --python 3.13
uv run --project mcp-servers --locked --python 3.13 python -m unittest discover -s mcp-servers/tests -v
node --test scripts/sb-arsenal-tools-test.cjs
node scripts/sb-wsl-routing-test.cjs
node scripts/sb-arsenal.cjs list
```

Python 检查验证源码与许可证哈希、语法、MCP 初始化及工具发现。Reverse Shell 状态调用不会启动监听器或连接目标。终端控制帧检查在不启动 PTY 的情况下测试其解析器。Node 检查验证命令构造以及模拟的 Windows/WSL 和 Linux 路由，不启动扫描器。这些检查不验证漏洞利用、活动监听器、实际 Metasploit 控制台或已部署的网络策略。

<a id="licenses"></a>

## 许可证

CyberStrikeAI 的 Reverse Shell 源码使用 [Apache-2.0](reverse_shell/LICENSE)。RedAmon 的 Metasploit 和终端源码使用 [MIT](redamon/LICENSE)，并包含上游版权声明。重新分发导入的源码时，必须保留这些文件。仓库根目录的许可证不能替代这些声明。

<a id="dev-note"></a>

## 开发备注

无。
