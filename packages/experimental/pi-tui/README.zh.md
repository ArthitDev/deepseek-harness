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

启动时先等待预设注册表和模型默认值就绪，再创建会话；缺少服务会阻止 TUI 激活。新会话使用共享 Web 设置中与所选提供方和模型绑定的预设；未绑定时使用配置的默认预设。`--preset <id>` 优先；恢复的会话保留其记录的预设。

`/new` 保留最近选择的提供方、模型和已挂载的预设。

通过 `/preset` 切换预设，或选择绑定另一预设的模型时，会开启一个新会话，并保留对话历史、工具结果和压缩检查点。复制的日志重置系统消息，并从模型历史中移除 developer 消息和注入的用户指令；原会话保持不变。下一次请求组装新预设的系统提示词，并加载当前附加上下文。部署 skill hook 需要同时安装在 TUI 和 Web 配置档中；内容未变的 skill 从当前历史中复用。执行工作期间拒绝切换预设。先前的回答和检查点摘要仍可能影响后续回复。

按 Ctrl+X 或运行 `/thinking`，可打开带编号和说明的推理等级列表。选择器聚焦当前 effort 或配置默认值，并在可用时标记二者。用 ↑/↓ 或数字选择一行，按 Enter 从下一步开始应用，按 Esc 取消。列表只提供所选模型公布的等级；二态控制说明启用或禁用思考。仍可用 `/thinking <level>` 直接选择。确认后的选择通过共享模型默认设置持久化。在执行回合期间取消选择器不会中断该回合。

状态栏以 `N agents` 显示当前会话下活跃的子 agent 运行，包括嵌套后代。计数跟随开始/结束事件更新，切换会话时重新显示，归零时隐藏。

模型图标在工作时保持为静态机器人。后台任务和子 agent 的活动图标在对应工作进行时播放动画，即使没有新的流事件也会更新。这些活动空闲或 TUI 释放时，状态动画停止。状态栏不显示会话标题。

聊天区的工作指示器是红色扫描条，以 80 毫秒的帧间隔往返移动；等待 LLM 时，已用时间标签持续更新。回合结束或 TUI 释放时停止。

思考内容从首个增量开始显示在带箭头的 Thinking 标题下，流式文本使用较淡的颜色并缩进。点击标题可折叠单个区域，按 Ctrl+T 可折叠或展开所有区域，流式生成期间也可操作。默认在生成时展开、定稿时折叠；用户明确选择的展开状态优先。

实时文本和思考增量立即保留，UI 更新按 16 毫秒合并，以匹配渲染器的节奏。流结束和持久化事件立即刷新待处理更新；切换会话和释放时取消这些更新。非文本块不触发对话区更新。显示节奏仍取决于提供方何时发送数据块。

回答和展开的思考内容在流式生成期间及完成后均渲染 Markdown。渲染器处理尚未闭合的代码围栏，并缓存未变化的正文；已提交的助手消息替换预览，不会重复添加。搜索高亮使用源文本，清除搜索后恢复 Markdown。格式尚未完整或表格列宽随内容增长时，后续文本仍可能改变布局。

代码围栏使用 highlight.js 语法，包括 C/C++、C#、Java、PowerShell、HTML/CSS、PHP、Ruby、Swift 和 Kotlin。围栏中的语言名称或别名选择对应语法；多行注释和字符串在整个代码块中保留词法状态。流式着色保留源字符、空行和行数。没有语言名称或名称未知时按纯文本渲染，不自动检测语言。

TUI 在选择模型或创建会话时读取 Web 配置档补丁中的预设覆盖值，因此 Web 绑定修改也会在这里生效。横幅和状态栏显示已挂载的预设；预设缺失时拒绝创建会话，不会在缺少其插件组合的情况下启动。

TUI 在启动时及每次组装提示词前读取自身保存的 Suppress built-in prompt sections 设置；没有 TUI 覆盖值时使用 Web 设置。启用后，提供方收到的系统提示词仅包含预设贡献：全局指导和模式策略被隐藏，工作区指令、运行时上下文、Jev-first 上下文及纯文本 developer 消息也不再发送。原始消息保留在持久日志中。修改从下一次请求生效，包括恢复的会话。

`/suppress-prompt`（别名 `/suppress-promot`）打开带编号的 ON/OFF 选择列表，默认聚焦并标记当前状态。使用 ↑/↓ 或数字选择，Enter 保存，Esc 取消且不写入设置或中断正在运行的回合。`on`、`off` 和 `toggle` 仍可直接修改，`status` 只显示当前状态。命令通过 Harness 设置服务保存 TUI 配置档，保留其他设置，不修改 Web 配置档。TUI 覆盖值在重启、新建会话及切换预设后仍有效。保存失败时显示错误。

开关关闭时，工作区指令、运行时上下文、Jev-first 上下文及所选团队提示词从第一轮对话起即可注入，与 Web 一致。两个界面使用 Harness 提示词注册表和提供方适配器；Pi TUI 不会额外添加编码代理人格。Web 的 GUI 专用提示词章节仅用于 Web。对于支持在历史中更新系统提示词的提供方，当前提示词会合并到历史开头，替换先前的预设及团队策略，同时保留持久日志。

`/team-mode` 打开带编号的 Blue、Red、Black 或 Dead 选择列表，支持方向键、数字选择、Enter 保存及 Esc 取消。也支持直接输入模式名或 `status`。状态栏显示所选模式的图标和名称。TUI 独立于 Web 保存模式；尚未选择时使用 Web 保存的模式。团队提示词文本使用 Web 保存的设置，否则使用随 TUI 交付的默认值。修改从下一次请求生效，并在重启和新建会话后保留。Suppress ON 隐藏团队提示词，但不改变所选模式；命令会提示该状态。保存失败时保留原来的选择。

TUI 未指定默认推理级别时，如果提供方和模型相同，则使用 Web 保存的级别。TUI 显式设置的模型和推理级别优先。恢复会话时，从请求头恢复明确选择的推理级别；适配器默认级别仍作为提供方默认值，不会变为用户选择。

`/preset` 和 `--preset` 选择列表隐藏系统预设，仅显示可用的用户预设。模型绑定和恢复的会话仍可使用系统预设。

## 命令

`/exit`、`/new`、`/fork`、`/resume`、`/tree`、`/agents`、`/jobs`、`/model`、`/preset`、`/thinking`、`/team-mode`、`/suppress-prompt`、`/skills`、`/runs`、`/recon`、`/machines`、`/key`、`/provider`、`/providers`、`/memory`、`/sessions`、`/rewind`、`/clear`、`/queue`、`/export`、`/rename`、`/copy`、`/retry`、`/expand-all`、`/hotkeys`，以及官方 dsh 斜杠命令（`/compact`、`/goal`、`/plan`、`/feedback`）。

`/exit` 关闭 TUI。恢复终端画面并释放应用后，如果当前会话已有持久事件，会打印完整会话 id 和 `dsh tui --resume <id>`。Ctrl+D 和 Ctrl+C 的退出手势显示相同提示。空会话不提供未保存历史的恢复命令。通过 new、fork、resume 或 preset 切换会话后，提示使用当前可见的会话。

`/providers` 列出已注册的路由、模型数量、当前路由及凭据配置状态。它逐个描述凭据引用，不解析或显示凭据值。读取凭据状态失败时显示 `key status unavailable`；命令失败会在 TUI 中显示通知。本地异步命令将 Promise 返回给分发器，避免错误成为脱离调用链的拒绝。

`/clear` 立即移除对话文本、思考内容、工具卡片和旧的 UI 提示，仅保留欢迎横幅和一条清空提示。会话 id 和持久化历史仍保留，可供恢复。`/clear` 和 `/rewind` 标记保留在日志中供 UI 回放，但无论 Suppress 开关状态如何都不成为模型输入；恢复会话中的标记和压缩输入也遵循此规则。

即使模型上下文中没有对话消息，纯 UI 命令输出和失败尝试预览也会清空。清空范围来自当前会话界面节点，包括没有对话气泡的注入用户上下文。纯 UI 清空保留系统消息，不追加会话编辑标记。回放清空标记时，也会移除被替换范围与标记之间的尝试文本和回合提示。

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
