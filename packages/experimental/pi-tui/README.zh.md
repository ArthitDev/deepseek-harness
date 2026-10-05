---
description: "Shield Break TUI：基于 pi-tui 的 Shield Break Harness 交互式终端入口，面向以终端为主、希望会话轻量持久的用户"
kind: "package-reference"
---

# pi-tui

[English](README.md) | 中文

## 摘要

`dsh-pi-tui` 是 Shield Break Harness 的终端入口：一个全屏交互式 TUI，驱动与 Web profile 相同的 agent 运行时。会话保存在共享的 `~/.dsh/sessions` 存储中，这里开启的会话可以在 Web GUI 中重新打开，反之亦然。TUI 渲染流式 Markdown、可折叠思考过程与工具卡片，并在进程内挂载部署的 agent preset、渗透测试控制面（`/runs`、`/recon`）与已保存的 SSH 机器（`/machines`）。使用 `dsh tui` 启动；`--resume`、`--preset`、`--machine` 分别选择会话、preset 与远程执行目标。它需要交互式终端，缺少时会直接报错退出。

## 目录

- [使用本包](#use-this-package)
- [命令](#commands)
- [开发说明](#dev-note)

-----



<a id="use-this-package"></a>

## 使用本包

本插件作为 `tui` profile 的 bundle row 发货：先执行 `dsh plugin --profile tui add <本包目录>` 安装一次，然后 `dsh tui` 启动。`--machine <id>` 会把会话工作目录放进该机器的远程执行命名空间，shell 与文件工具随即通过 SSH 在该已保存机器上运行。

## 命令

`/new`、`/fork`、`/resume`、`/tree`、`/agents`、`/jobs`、`/model`、`/preset`、`/thinking`、`/skills`、`/runs`、`/recon`、`/machines`、`/key`、`/provider`、`/providers`、`/memory`、`/sessions`、`/rewind`、`/clear`、`/queue`、`/export`、`/rename`、`/copy`、`/retry`、`/expand-all`、`/hotkeys`，以及官方 dsh 斜杠命令（`/compact`、`/goal`、`/plan`、`/feedback`）。

<a id="connect-antigravity"></a>

## 连接 Antigravity

内置的 `tools/antigravity-proxy/`（MIT，随包附带）将 Google Antigravity
登录暴露为本地 OpenAI 兼容端点，使 TUI 能通过 /provider 驱动其 Gemini 与
Claude 模型。一次性设置：先运行一次 Antigravity CLI（`agy`）完成认证，然后
启动 `python tools/antigravity-proxy/antigravity_proxy.py`（或
`antigravity-proxy` 命令），再注册 provider：

```
/provider
  name:     antigravity
  endpoint: http://127.0.0.1:8877/v1
  protocol: openai-completions
  key:      any-string
```

代理会自行刷新 OAuth 令牌；Antigravity 配额与 Google 服务条款照常适用。

<a id="dev-note"></a>

## 开发说明

改编自社区 `dsh-pi-tui` 插件（MIT，见 NOTICE）；已移植到 0.1.7-alpha.2 harness API 并集成为 workspace 包。终端渲染层与其他 GUI 债务面一样豁免逐文件覆盖率门；`src/core` 下的纯逻辑照常受门控。
