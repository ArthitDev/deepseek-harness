---
description: "Shield Break TUI：基于 pi-tui 的 Shield Break Harness 交互式终端入口，面向以终端为主、希望会话轻量持久的用户"
kind: "package-bundle"
---

# pi-tui

[English](README.md) | 中文

## 概述

`dsh-pi-tui` 是 Shield Break Harness 的终端入口：驱动 Web profile 同一 agent 运行时的全屏 TUI。会话保存在共享的 `~/.dsh/sessions` 存储中，这里开启的会话可以在 Web GUI 中重新打开，反之亦然。TUI 渲染流式 Markdown、可折叠思考过程与工具卡片，并在进程内挂载 agent preset、渗透测试控制面（`/runs`、`/recon`）与已保存的 SSH 机器（`/machines`）。使用 `dsh tui` 启动 —— 源码检出先运行 `tools/antigravity-proxy/setup.mjs` 创建 `tui` profile。`--resume`、`--preset`、`--machine` 分别选择会话、preset 与执行目标。需要交互式终端。

## 目录

- [使用本包](#use-this-package)
- [命令](#commands)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>

## 使用本包

本插件作为 `tui` profile 的 bundle row 发货：先执行 `dsh plugin --profile tui add <本包目录>` 安装一次，然后 `dsh tui` 启动。`--machine <id>` 会把会话工作目录放进该机器的远程执行命名空间，shell 与文件工具随即通过 SSH 在该已保存机器上运行。

<a id="commands"></a>

新会话，包括 `/new`，使用共享 Web 设置中与所选提供方和模型绑定的预设；未绑定时使用配置的默认预设。`--preset <id>` 优先；恢复的会话保留其记录的预设。

`/new` 保留最近选择的提供方和模型。

状态栏以 `N agents` 显示当前会话下活跃的子 agent 运行，包括嵌套后代。计数跟随开始/结束事件更新，切换会话时重新显示，归零时隐藏。

模型图标在工作时保持为静态机器人。后台任务和子 agent 的活动图标在对应工作进行时播放动画，即使没有新的流事件也会更新。这些活动空闲或 TUI 释放时，状态动画停止。状态栏不显示会话标题。

聊天区的工作指示器是红色扫描条，以 80 毫秒的帧间隔往返移动；等待 LLM 时，已用时间标签持续更新。回合结束或 TUI 释放时停止。

思考内容从首个增量开始显示在带箭头的 Thinking 标题下，流式文本使用较淡的颜色并缩进。点击标题可折叠单个区域，按 Ctrl+T 可折叠或展开所有区域，流式生成期间也可操作。默认在生成时展开、定稿时折叠；用户明确选择的展开状态优先。

实时文本和思考增量立即保留，UI 更新按 16 毫秒合并，以匹配渲染器的节奏。流结束和持久化事件立即刷新待处理更新；切换会话和释放时取消这些更新。非文本块不触发对话区更新。显示节奏仍取决于提供方何时发送数据块。

回答和展开的思考内容在流式生成期间及完成后均渲染 Markdown。渲染器处理尚未闭合的代码围栏，并缓存未变化的正文；已提交的助手消息替换预览，不会重复添加。搜索高亮使用源文本，清除搜索后恢复 Markdown。格式尚未完整或表格列宽随内容增长时，后续文本仍可能改变布局。

TUI 在选择模型或创建会话时读取 Web 配置档补丁中的预设覆盖值，因此 Web 绑定修改也会在这里生效。横幅和状态栏显示已挂载的预设；预设缺失时拒绝创建会话，不会在缺少其插件组合的情况下启动。

Web 的 Suppress built-in prompt sections 开关也适用于 TUI。TUI 在启动时及每次组装提示词前读取已保存的开关。启用后，提供方收到的系统提示词仅包含预设贡献：全局指导和模式策略被隐藏，工作区指令、运行时上下文、Jev-first 上下文及纯文本 developer 消息也不再发送。原始消息保留在持久日志中。修改从下一次请求生效，包括恢复的会话。Web 未保存开关值时，TUI 使用自身设置；该同步不会编辑任一配置档文件。

开关关闭时，工作区指令、运行时上下文和 Jev-first 上下文从第二轮对话开始注入。整个第一轮，包括后续步骤，保留预设提示词和用户输入，不包含这些上下文。恢复现有对话时保留其轮次计数。延后注入改变上下文到达的时间，不能防止上下文影响后续回答。

`/preset` 和 `--preset` 选择列表隐藏系统预设，仅显示可用的用户预设。模型绑定和恢复的会话仍可使用系统预设。

## 命令

`/new`、`/fork`、`/resume`、`/tree`、`/agents`、`/jobs`、`/model`、`/preset`、`/thinking`、`/skills`、`/runs`、`/recon`、`/machines`、`/key`、`/provider`、`/providers`、`/memory`、`/sessions`、`/rewind`、`/clear`、`/queue`、`/export`、`/rename`、`/copy`、`/retry`、`/expand-all`、`/hotkeys`，以及官方 dsh 斜杠命令（`/compact`、`/goal`、`/plan`、`/feedback`）。

`/clear` 立即移除对话文本、思考内容、工具卡片和旧的 UI 提示，仅保留欢迎横幅和一条清空提示。会话 id 和持久化历史仍保留，可供恢复。`/clear` 和 `/rewind` 标记保留在日志中供 UI 回放，但无论 Suppress 开关状态如何都不成为模型输入；恢复会话中的标记和压缩输入也遵循此规则。

<a id="connect-antigravity"></a>

## 连接 Antigravity

TUI 自带 Antigravity 代理（零依赖，就在本仓库内），全新克隆无需其他下载，也不需要 Antigravity CLI —— 只需一个 Google 账号。一条命令：

```
node packages/experimental/pi-tui/tools/antigravity-proxy/setup.mjs
```

脚本会在 profile 缺失时创建 `tui` profile、安装静默自启动器、启动端点，并在浏览器中打开一次 Google 登录；轮换后的令牌保存在代理自己的状态文件中，之后自动刷新。Antigravity provider 已内置于 TUI bundle，`dsh tui` → `/model` 直接列出其 Gemini 模型，无需 `/provider` 步骤（源码检出用 `node --import tsx/esm apps/cli/src/bin.ts tui` 启动）。Antigravity 配额与 Google 服务条款照常适用。登录过期时重跑脚本（或打开 `http://127.0.0.1:8877/auth/login`）即可。

若部署偏好外部 CLIProxyAPI 网关：下载后运行 `cliproxy --antigravity-login`（打开浏览器一次），在 `/provider` 注册 provider（`name: antigravity`、`endpoint: http://127.0.0.1:8317/v1`、`protocol: openai-completions`、`key: shield-break`），再用 `node tools/antigravity-proxy/install-autostart.mjs` 随登录常驻 —— 在 home patch 中命名 `llm-pi-ai` 行会按 id 替换本 bundle 的代理 roster。

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
