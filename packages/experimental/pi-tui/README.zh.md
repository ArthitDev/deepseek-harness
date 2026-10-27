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
- [本地 MCP、skill 与插件](#local-mcp-skills-and-plugins)
- [命令](#commands)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>

## 使用本包

本插件作为 `tui` profile 的 bundle row 发货：先执行 `dsh plugin --profile tui add <本包目录>` 安装一次，然后 `dsh tui` 启动。开头的位置参数目录设定会话工作目录（`dsh tui .`），优先于 row 配置，且必须真实存在。`--machine <id>` 会把会话工作目录放进该机器的远程执行命名空间，shell 与文件工具随即通过 SSH 在该已保存机器上运行。

<a id="commands"></a>

启动时先等待预设注册表和模型默认值就绪，再创建会话；缺少服务会阻止 TUI 激活。新会话使用共享 Web 设置中与所选提供方和模型绑定的预设；未绑定时使用配置的默认预设。`--preset <id>` 优先；恢复的会话保留其记录的预设。

`/resume` 和 `--resume` 只回放一次所选会话的完整快照，包括继承的 fork seed。父会话 id 仅记录继承关系，渲染 transcript 时不打开父日志。祖先会话缺失不会阻止已保存的子会话显示继承消息。回放不会修改会话文件。

TUI 默认仅为最新 20 个 transcript 项创建并保留视图，计入消息、思考、工具和提示。较早项目仍保留在 transcript 数据中以供搜索和导出；只有显示这些项目时才加载其视图和图片。`/expand-all` 显示所有项目，再次执行恢复限制。可将 `pi-tui` 配置行的 `historyLimit` 设为正整数来调整窗口。此限制不会截断会话日志或 Agent 的模型上下文；回放仍读取完整日志。

打开已保存的对话历史时会添加一行回顾；`/recap` 可按需再次显示。回顾摘录最新的用户请求、助手回复以及活动检查点中的当前工作和下一步，最多 400 个 Unicode 码点。检查点信息单独标注，因为后续消息可能已改变这些信息。回顾读取当前派生历史，因此不包含已清除、回退或被压缩替代的消息。它不调用模型、不写入会话事件，也不添加模型上下文；不会在后台空闲时生成回顾。

继承的[自动压缩后端](../../compaction/compaction-basic/README.zh.md#tuning-when-condensation-starts)独立于 20 项显示窗口管理上下文。它默认启用，在步骤之间检查 token 压力，将较早历史总结为结构化检查点，并逐字保留最近一段内容。空闲时可用 `/compact` 手动触发。摘要记录意图、文件、修复、待办工作、下一步和关键上下文；摘要仍可能遗漏细节，但原始事件保留在持久日志中。

<a id="local-mcp-skills-and-plugins"></a>

## 本地 MCP、skill 与插件

此部署不能只复制 `dsh-pi-tui`。实际配置由包 bundle、`~/.dsh/cordis.patch.yml` 和 `~/.dsh/profiles/tui/cordis.patch.yml` 合并而成。移动或恢复环境时，必须同时保留这些层及其引用的本地文件，并在启动 TUI 前重新构建源码检出。下表使用三种故障标签：`Blocked` 表示 TUI 无法激活，`Turn-fatal` 表示 TUI 能打开但模型回合失败，`Degraded` 表示 TUI 能打开但缺少该集成。

| 范围 | 必需的 row 与本地资源 | 缺失或无效时的结果 |
|---|---|---|
| TUI 启动 | base 与 TUI bundle 必须提供 `agents`、`cmdlineArgs`、`workspaceRegistry`、`loader`、`profileContext`、`pentestModePolicy`、`systemPrompt`、`agentPresets` 和 `agentDefaultModel`。 | **Blocked。** `pi-tui` 插件保持 pending，不会打开终端界面。 |
| Skill | Base row `skill`、`skill-filesystem` 和 `tool-skill`；TUI row `global-default-skills`；`C:\Users\EPIT-Dev\.dsh\global-skills.mjs`。发现机制只读取 harness 自有根目录——`~/.dsh/skills`、`<projectRoot>/.dsh/skills` 与 `customSkillDirs`；跨 harness 共享目录不会被扫描。目录当前包含 133 个 skill，含 `losthex-*` 系列与 `apk-reverse`。 | 缺少 base 服务会移除 skill catalog 与调用路径。缺少本地插件或某个默认 skill 属于 **Degraded**，对应 hook 或 skill 会被跳过。 |
| Jev-first 策略 | 全局 row `jev-first-action-policy`；`C:\Users\EPIT-Dev\.dsh\jev-first.mjs`；`C:\Users\EPIT-Dev\.agent-rules\JEV-FIRST.md`。`global-skills.mjs` 也导入此插件。 | 插件已加载但策略文件缺失时属于 **Turn-fatal**，因为每次 pre-step 读取都会失败。插件文件无法加载时属于 **Degraded**，策略不会生效。 |
| Kali 执行策略 | 全局 row `kali-exec-policy`；`C:\Users\EPIT-Dev\.dsh\kali-exec.mjs`；`kali-linux` WSL 发行版及 Kali 软件集（nmap、sqlmap、hydra、john、hashcat、impacket），通过 `wsl -d kali-linux -- bash -lc` 调用。 | 发行版或软件包缺失只会让相应命令在回合内失败，策略文本仍然加载；只有插件文件无法加载才属于 **Degraded**。 |
| Jev MCP | 全局 row `mcp-jev`；`C:\Users\EPIT-Dev\.local\bin\jev-mcp-launcher.mjs`；Node 22 或更新版本；`C:\Users\EPIT-Dev\.config\typesafe\key`；launcher 固定的 `@jkudish/jev-mcp` 包。 | **Degraded。** `failOnStartupError: false` 允许 TUI 继续运行，但 `/jev status` 不会显示可用工具，状态栏显示 `Jev unavailable`。 |
| REA MCP | 全局 row `mcp-rea`（insert）；通过 `C:\nvm4w\nodejs\node.exe` 运行 `C:\Users\EPIT-Dev\AppData\Roaming\npm\node_modules\rea-agents\scripts\rea.mjs`。 | **Degraded。** `failOnStartupError: false` 允许 TUI 在没有 REA 时继续运行；正常启动会暴露约 170 个 `mcp__rea__*` 工具。 |
| IDA MCP | 全局 row `mcp-ida`（streamable HTTP `http://127.0.0.1:13337/mcp`）；运行中的 IDA 及其 `ida-pro-mcp` 插件（即 `ida-pro-mcp` dotnet tool）。 | **Degraded。** 端点只在 IDA 运行时存在；IDA 出现后客户端会自行重连。 |
| x64dbg MCP | 全局 row `mcp-x64dbg`（stdio）；Python 3.13（含 `mcp` 与 `requests`）运行 `C:\Users\EPIT-Dev\.dsh\mcp\x64dbg-mcp.py`；x64dbg 插件的 HTTP 服务器 `127.0.0.1:8888`。 | **Degraded。** bridge 可以在 x64dbg 未运行时启动，其工具在插件 HTTP 服务器上线前逐次调用失败。 |
| Cyber Wiki | 使用 `C:\Users\EPIT-Dev\.dsh\cyber-wiki` 的 `cyber` knowledge root 覆盖现有 host row `tool-fs-search`，并保持其 `INDEX.md` 有效。 | **Degraded。** 无效根目录会使该插件激活失败。不要插入第二个 host `tool-fs-search` row，否则两个实例都会注册 `knowledge_list`，其中一个会以 `tool "knowledge_list" is already registered` 失败。 |
| Orca hook | 全局 row `orca-agent-hooks` 与 `C:\Users\EPIT-Dev\.orca\agent-hooks\dsh-hooks.json`。 | **Degraded。** Orca hook 集成不可用；它不是 TUI 启动服务。 |

`global-skills.mjs`、`jev-first.mjs` 与 `kali-exec.mjs` 通过绝对 `file:///E:/Cybersecure-Pentest/deepseek-harness/.../lib/index.js` URL 导入构建产物。移动源码检出后不更新这些 URL，或清理 `lib` 后不重新构建，都会阻止本地插件激活。

移动或重新构建后，先检查合并后的 profile，再打开 TUI：

```text
dsh --profile tui --dump-config
```

输出必须包含 `pi-tui`、`global-default-skills`、`jev-first-action-policy`、`kali-exec-policy`、`mcp-rea`、`mcp-jev`、`mcp-ida`、`mcp-x64dbg` 和唯一一个被覆盖的 `tool-fs-search` row。TUI 打开后运行以下检查；`/mcp status` 必须列出 `rea` 与 `jev` 且工具计数为正，`ida` 与 `x64dbg` 会在其宿主应用运行时加入，可用的 Wiki 选择器表示可选集成已加载。

```text
/mcp status
/skills status
/jev status
/wiki
```

`/new` 保留最近选择的提供方、模型和已挂载的预设。

通过 `/preset` 切换预设，或选择绑定另一预设的模型时，会开启一个新会话，并保留对话历史、工具结果和压缩检查点。复制的日志重置系统消息，并从模型历史中移除 developer 消息和注入的用户指令；原会话保持不变。下一次请求组装新预设的系统提示词，并加载当前附加上下文。部署 skill hook 需要同时安装在 TUI 和 Web 配置档中；内容未变的 skill 从当前历史中复用。执行工作期间拒绝切换预设。先前的回答和检查点摘要仍可能影响后续回复。

按 Ctrl+X 或运行 `/thinking`，可打开带编号和说明的推理等级列表。选择器聚焦当前 effort 或配置默认值，并在可用时标记二者。用 ↑/↓ 或数字选择一行，按 Enter 从下一步开始应用，按 Esc 取消。列表只提供所选模型公布的等级；二态控制说明启用或禁用思考。仍可用 `/thinking <level>` 直接选择。确认后的选择通过共享模型默认设置持久化。在执行回合期间取消选择器不会中断该回合。

状态栏以 `N agents` 显示当前会话下活跃的子 agent 运行，包括嵌套后代。计数跟随开始/结束事件更新，切换会话时重新显示，归零时隐藏。

当前 agent 可调用 `knowledge_list` 时，状态栏显示 `📚 Wiki`；禁用或显式拒绝时隐藏。标记随会话切换及工具重载更新，独立于内置提示词抑制。Wiki 插件在 Web 与 TUI 中提供相同的简短操作上下文，不修改 preset system 文本。

状态栏还会显示 `Jev ON`、`Jev OFF` 或 `Jev unavailable`。成功的 direct `mcp__jev__*` 调用会把 provider 返回的 `usage.cost` 累加到当前可见会话。该数值是已发生的花费，不是账户剩余额度；当前配置的 Jev MCP 没有余额工具。状态标记本身不会发起请求。

模型图标在工作时保持为静态机器人。后台任务和子 agent 的活动图标在对应工作进行时播放动画，即使没有新的流事件也会更新。这些活动空闲或 TUI 释放时，状态动画停止。状态栏不显示会话标题。

聊天区的工作指示器是红色扫描条，以 80 毫秒的帧间隔往返移动；等待 LLM 时，已用时间标签持续更新。回合结束或 TUI 释放时停止。

思考内容从首个增量开始显示在带箭头的 Thinking 标题下，流式文本使用较淡的颜色并缩进。点击标题可折叠单个区域，按 Ctrl+T 可折叠或展开所有区域，流式生成期间也可操作。默认在生成时展开、定稿时折叠；用户明确选择的展开状态优先。

实时文本和思考增量立即保留，UI 更新按 16 毫秒合并，以匹配渲染器的节奏。流结束和持久化事件立即刷新待处理更新；切换会话和释放时取消这些更新。非文本块不触发对话区更新。显示节奏仍取决于提供方何时发送数据块。

回答和展开的思考内容在流式生成期间及完成后均渲染 Markdown。渲染器处理尚未闭合的代码围栏，并缓存未变化的正文；已提交的助手消息替换预览，不会重复添加。搜索高亮使用源文本，清除搜索后恢复 Markdown。格式尚未完整或表格列宽随内容增长时，后续文本仍可能改变布局。

代码围栏使用 highlight.js 语法，包括 C/C++、C#、Java、PowerShell、HTML/CSS、PHP、Ruby、Swift 和 Kotlin。围栏中的语言名称或别名选择对应语法；多行注释和字符串在整个代码块中保留词法状态。流式着色保留源字符、空行和行数。没有语言名称或名称未知时按纯文本渲染，不自动检测语言。

TUI 在选择模型或创建会话时读取 Web 配置档补丁中的预设覆盖值，因此 Web 绑定修改也会在这里生效。横幅和状态栏显示已挂载的预设；预设缺失时拒绝创建会话，不会在缺少其插件组合的情况下启动。

TUI 在启动时及组装提示词前强制关闭提示词抑制，即使 TUI 或 Web 已保存启用值也如此；不修改保存的文件。组装监听器不得删除、修改或重排已注册的系统段落。显式编写的完整 persona 仍作为完整提示词。在 agent-loop 和压缩请求到达适配器前，TUI 要求首条系统消息非空，且所有系统消息与会话的有效历史完全一致。系统消息缺失、截断、重排或替换时，请求直接失败，不使用降级提示词。恢复、压缩及切换预设或模型后同样检查。这些检查验证提示词经过 Harness 的传递，不保证模型服从或提供方的内部处理；辅助标题请求使用自身的提示词。

`/suppress-prompt`（别名 `/suppress-promot`）和 `status` 显示 OFF，并注明严格系统提示词保护已锁定。`on` 和 `toggle` 被拒绝，不写入设置或中断正在运行的回合。`off` 通过 Harness 设置服务保存已关闭的 TUI 覆盖值；保存失败时显示错误。其他设置与 Web 配置档保持不变。

`/mcp` 打开可搜索的 MCP 服务器列表；选择服务器会切换其全部工具。`/mcp on|off|toggle|status` 控制当前 TUI 进程的全部 MCP 工具。被停用的服务器或全局 OFF 状态会从后续模型请求中移除受影响的 `mcp__*` 工具，并拒绝旧调用。选择会跟随会话切换，但在 TUI 重启时重置。回合运行期间不允许更改。

`/jev [on|off|toggle|status]` 控制当前 TUI 进程的 Jev-first 策略上下文和 open-dev-browser MCP 工具。OFF 会从后续模型请求中移除两者，并拒绝旧的 JEV 调用；ON 会恢复它们，除非全局 MCP 或 skills 开关也将其隐藏。带连字符和规范化下划线的服务器命名空间都能被识别。状态会跟随会话切换，但在 TUI 重启时重置。回合运行期间不允许更改。

`/skills` 打开可搜索的 skill 列表；选择 skill 会切换其 catalog 条目、直接 `/name` 指令注入、模型工具调用和自动补全条目。`/skills on|off|toggle|status` 控制当前 TUI 进程的全部 skill。全局 OFF 还会从后续模型请求中移除 `skill` 工具。选择会跟随会话切换，但在 TUI 重启时重置。回合运行期间不允许更改。

开关关闭时，工作区指令、运行时上下文、Jev-first 上下文及所选团队提示词从第一轮对话起即可注入，与 Web 一致。两个界面使用 Harness 提示词注册表和提供方适配器；Pi TUI 不会额外添加编码代理人格。Web 的 GUI 专用提示词章节仅用于 Web。对于支持在历史中更新系统提示词的提供方，当前提示词会合并到历史开头，替换先前的预设及团队策略，同时保留持久日志。

`/team-mode` 打开带编号的 Blue、Red、Black 或 Dead 选择列表，支持方向键、数字选择、Enter 保存及 Esc 取消。也支持直接输入模式名或 `status`。状态栏显示所选模式的图标和名称。TUI 独立于 Web 保存模式；尚未选择时使用 Web 保存的模式。团队提示词文本使用 Web 保存的设置，否则使用随 TUI 交付的默认值。修改从下一次请求生效，并在重启和新建会话后保留。保存失败时保留原来的选择。

TUI 未指定默认推理级别时，如果提供方和模型相同，则使用 Web 保存的级别。TUI 显式设置的模型和推理级别优先。恢复会话时，从请求头恢复明确选择的推理级别；适配器默认级别仍作为提供方默认值，不会变为用户选择。

`/preset` 和 `--preset` 选择列表隐藏系统预设，仅显示可用的用户预设。模型绑定和恢复的会话仍可使用系统预设。

原生分栏 shell 在聊天右侧的右栏挂载一个实时 PTY 会话（`shared-win` 位于 Windows pwsh 后端，`shared-kali` 位于 kali WSL 发行版内）。`/shell` 打开使用 TUI 样式的选择列表，提供 Windows、Kali，以及面板已打开时的 Close shell。使用 ↑/↓ 或数字选择，再按 Enter 确认；Esc 取消且不中断正在运行的回合。列表默认聚焦当前后端，没有打开 shell 时聚焦 Windows。shell 关闭时，`Ctrl+P` 打开此列表；shell 已打开时，它在聊天与 shell 之间循环切换键盘焦点；按 `Esc` 把焦点交还聊天。面板轮询共享会话，因此 agent 通过 `terminal_*` 运行的命令与操作者提交的命令实时显示在一起。`/shell win|kali` 和 `/shell close` 仍可直接控制面板。面板挂载时状态栏显示 `⌨ shell:<variant>`。打开面板需要终端至少 100 列宽，且在任务运行期间也允许打开。关闭面板会保留其会话；关闭 TUI 时这些会话随 agent 一起释放。

拖动竖直分隔线或中央的 `↔` 手柄可调整聊天与活动栏的宽度，shell 关闭时也可调整。在任一输入框中，`Ctrl+Alt+Left` 和 `Ctrl+Alt+Right` 每次将分隔线移动两列；浮层仍独立接收键盘输入。空间足够时每栏至少保留 30 列，较小的终端窗口则共享可用宽度。所选活动栏宽度在当前 TUI 进程内关闭并重新打开 shell 后保留，并在终端扩大后恢复。

shell 输入框固定在底部，下边框与聊天中自动换行的状态栏上沿对齐，输出在其上方滚动。Kali 最近一次的原生双行提示符包含用户名、主机名、目录以及 `#` 或 `$` 标记，即使输出被清空也会保留在输入框上方。shell 输出新提示符时显示随之更新；尚未观察到提示符时显示 `kali ❯`。切换后端会重置保留的提示符。

输出片段和命令完成会立即请求重绘，无需等待下一次 scrollback 轮询或按键。scrollback 轮询也会显示 agent 在共享会话中运行的命令。

单个 `Agent Debug` 面板默认显示，即使没有打开 shell。`/agent-debug` 在当前 TUI 进程内切换显示，不清空历史或 shell 输入。shell 关闭时面板占满右栏，打开时与下方 shell 共享右栏；两者都隐藏时聊天恢复全宽。时间线按开始顺序保留最近 20 个操作，标记为 Agent、Tool、Shell、MCP、File、Approval 或 Retry，显示状态及根据会话时间戳计算的耗时。工具行显示命令或参数预览及结果或错误摘要。Approval 行观察等待状态和已记录的决定；Retry 行显示提供方、尝试次数、延迟、失败及结束状态。File 行只来自成功工具结果中已确认的 diff。这些行只观察事件，不执行命令或授予批准。

点击条目展开或收起详情。键盘操作使用 `Ctrl+Alt+D` 聚焦、↑/↓ 选择、Enter 切换详情、PageUp/PageDown 滚动。Esc 返回之前的编辑器，不中断 agent；隐藏已聚焦面板也会恢复编辑器。详情包含参数、工具输出、错误及文件修改前后文本，每行最多 16,000 个字符；聊天中的工具卡片仍然可用。鼠标滚轮可查看较早的行。隐藏时仍继续更新；回放恢复事件历史，切换会话重置列表，rewind/clear 移除被遮蔽的行。切换 shell 后端保留当前会话的活动。面板仅显示已有事件，不推测缺少工具 diff 元数据的文件变化。

shell 打开时，其 agent 可以调用 `shell_draft`，传入 `shell`（`win` 或 `kali`）和 `command`，将命令填入空的 shell 输入框供人工检查。例如，在 `/shell` 中选择 Windows，按 `Esc` 返回聊天，然后让 agent 使用 `shell_draft` 暂存 `Get-Date`。该工具不会执行命令、发送 PTY 输入或切换焦点。检查输入后，用 `Ctrl+P` 聚焦 shell，再自行按 Enter 提交。工具会拒绝不匹配的后端、已有输入、空命令和终端控制字符；命令文本仍可包含制表符和换行。切换后端也要求输入框为空。关闭 shell 会注销该工具，其他 agent 无法访问。现有工具 guard 仍然适用。暂存命令不是安全拒绝或批准被拒后的自动替代路径；模型仍须遵守其安全和执行策略，也可能拒绝提供命令。

`/exec` 按新到旧列出本会话中 agent 执行过的 shell 命令，标注 `KALI`（经 `wsl -d kali-linux` 路由）或 `WIN`，并显示配对结果状态。选择一行会聚焦对应的 transcript 工具卡片以查看完整输出与参数。

## 命令

`/exit`、`/new`、`/fork`、`/resume`、`/recap`、`/tree`、`/agents`、`/jobs`、`/model`、`/preset`、`/thinking`、`/team-mode`、`/suppress-prompt`、`/mcp`、`/jev`、`/skills`、`/shell [win|kali|close]`、`/agent-debug`、`/exec`、`/wiki`、`/runs`、`/recon`、`/machines`、`/key`、`/provider`、`/providers`、`/memory`、`/sessions`、`/rewind`、`/clear`、`/queue`、`/export`、`/rename`、`/copy`、`/retry`、`/expand-all`、`/hotkeys`，以及官方 dsh 斜杠命令（`/compact`、`/goal`、`/plan`、`/feedback`）。

`/wiki` 打开带编号的知识库选择列表，读取当前预设可见的 `knowledge_list` 工具所配置的知识库。选择知识库后，可在对话区查看 `INDEX.md` 的标题和链接、在 Obsidian 中打开该索引，或在文件管理器中打开配置的文件夹。方向键或数字选择，Enter 确认，Esc 取消。需要安装 Obsidian 并注册 `obsidian://` 协议处理程序，且 Wiki 文件夹已作为 Obsidian 库打开过。知识库不可用或打开失败时显示 TUI 通知。菜单不请求模型、不追加会话事件，也不修改提示词或 Wiki 文件。

`/exit` 关闭 TUI。恢复终端画面并释放应用后，如果当前会话已有持久事件，会打印完整会话 id 和 `dsh tui --resume <id>`。Ctrl+D 和 Ctrl+C 的退出手势显示相同提示。空会话不提供未保存历史的恢复命令；创建后未产生用户内容的会话在切换或退出时也会从会话存储中丢弃，因此启动后未使用不会留下空壳。通过 new、fork、resume 或 preset 切换会话后，提示使用当前可见的会话。

`/providers` 列出已注册的路由、模型数量、当前路由及凭据配置状态。它逐个描述凭据引用，不解析或显示凭据值。读取凭据状态失败时显示 `key status unavailable`；命令失败会在 TUI 中显示通知。本地异步命令将 Promise 返回给分发器，避免错误成为脱离调用链的拒绝。

`/model` 使用与 Web 相同的 LLM 目录中的模型和提供方显示名称。每行同时显示 provider/model id，便于搜索和识别；选择后仍发送这些原始 id。直接输入 `/model <query>` 也支持目录显示名称及 id。两个界面分别读取各自生效的配置档，因此配置覆盖或尚未重新加载修改的进程仍可能显示不同列表。

切换模型时，仅在目标模型声明支持原推理级别时保留该级别，否则使用目标提供方默认值，不强制关闭思考。保存选择前先验证解析后的推理级别；状态栏不会把旧模型的级别带入新路由。未声明 effort 元数据的模型仍可按提供方默认行为思考，但 TUI 无法为其提供显式推理级别选项。

每次请求前，TUI 还会检查从默认设置、恢复的历史记录或会话切换中载入的推理级别。若当前模型不再声明该级别，则从请求及实时选择中移除，并显示 UI 通知，然后使用提供方默认值。历史请求头及保存的配置保持不变。能力查询失败时仍拒绝请求，不猜测支持的级别。

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
