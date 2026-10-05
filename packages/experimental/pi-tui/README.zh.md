---
description: "Shield Break TUI：基于 pi-tui 的 Shield Break Harness 交互式终端入口，面向以终端为主、希望会话轻量持久的用户"
kind: "package-bundle"
---

# pi-tui

[English](README.md) | 中文

## 概述

`dsh-pi-tui` 是 Shield Break Harness 的终端入口：一个全屏交互式 TUI，驱动与 Web profile 相同的 agent 运行时。会话保存在共享的 `~/.dsh/sessions` 存储中，这里开启的会话可以在 Web GUI 中重新打开，反之亦然。TUI 渲染流式 Markdown、可折叠思考过程与工具卡片，并在进程内挂载部署的 agent preset、渗透测试控制面（`/runs`、`/recon`）与已保存的 SSH 机器（`/machines`）。使用 `dsh tui` 启动；`--resume`、`--preset`、`--machine` 分别选择会话、preset 与远程执行目标。它需要交互式终端，缺少时会直接报错退出。

## 目录

- [使用本包](#use-this-package)
- [命令](#commands)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>

## 使用本包

本插件作为 `tui` profile 的 bundle row 发货：先执行 `dsh plugin --profile tui add <本包目录>` 安装一次，然后 `dsh tui` 启动。`--machine <id>` 会把会话工作目录放进该机器的远程执行命名空间，shell 与文件工具随即通过 SSH 在该已保存机器上运行。

<a id="commands"></a>

## 命令

`/new`、`/fork`、`/resume`、`/tree`、`/agents`、`/jobs`、`/model`、`/preset`、`/thinking`、`/skills`、`/runs`、`/recon`、`/machines`、`/key`、`/provider`、`/providers`、`/memory`、`/sessions`、`/rewind`、`/clear`、`/queue`、`/export`、`/rename`、`/copy`、`/retry`、`/expand-all`、`/hotkeys`，以及官方 dsh 斜杠命令（`/compact`、`/goal`、`/plan`、`/feedback`）。

<a id="connect-antigravity"></a>

## 连接 Antigravity

TUI 配合 CLIProxyAPI（外部下载）使用：它将 Google Antigravity 登录转换为本地 OpenAI 兼容端点并提供 /v1/models。一次性设置：安装后运行 `cliproxy --antigravity-login`（打开浏览器一次），启动 `cliproxy`，再在 /provider 注册 provider：

```
/provider
  name:     antigravity
  endpoint: http://127.0.0.1:8317/v1
  protocol: openai-completions
  key:      shield-break
```

代理会自行刷新 OAuth 令牌；Antigravity 配额与 Google 服务条款照常适用。

若不想常驻终端窗口，运行一次自带安装器：`node tools/antigravity-proxy/install-autostart.mjs` —— 它会把静默启动器放入 Windows Startup 文件夹，端点随每次登录自动启动。

<a id="dev-note"></a>

## 开发备注

改编自社区 `dsh-pi-tui` 插件（MIT，见 NOTICE）；已移植到本分支的 0.1.7-alpha.2 harness API 并集成为 workspace 包。终端渲染层按 GUI 债务先例豁免逐文件覆盖率；`src/core` 下的纯逻辑照常按逐文件 100% 标准把守。

## Model Experience

### 有界渗透测试对话

#### 模型看到什么

横幅与会话事实、折叠后的转录、工具卡片以及状态栏（模型、token、上下文条、git、todo、队列）。被抑制的内置 prompt 段落使操作者的 preset 贡献与 `/preset` 切换后的策略成为系统 prompt。

#### Token 影响

仅会话内容：TUI 自身不注册任何常驻 prompt 段落，被回退的对话也继续在持久日志中遮蔽（经 `/rewind` 与 `/clear` 标记）。

#### KV Cache 影响

回退与 /clear 追加 surface 替换标记，provider 的 prompt 前缀在遮蔽点之前保持前缀稳定，不会使整段对话失效。

## Known Limitations and Deferred Work

- 仅针对本分支的 dsh 0.1.7-alpha.2 API 验证；上游发布独立演进，可能出现漂移。
- 渗透测试仪表盘（Runs 图、recon 报告）仍仅在 web 提供；/runs 与 /recon 覆盖文本层面的控制。
- 沙箱说明：会话工作目录为主目录时，shell 沙箱将在启动时以横幅警告拒绝其临时根目录。

### 开发备注

<details>
<summary>维护者的工作背景 —— 点击展开</summary>

改编自社区 `dsh-pi-tui` 插件（MIT，见 NOTICE）；已移植到本分支的 0.1.7-alpha.2 harness API 并集成为 workspace 包。终端渲染层按 GUI 债务先例豁免逐文件覆盖率；`src/core` 下的纯逻辑照常按逐文件 100% 标准把守。

</details>
