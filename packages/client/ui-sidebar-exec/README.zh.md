---
description: "右侧边栏的已执行 shell 命令页：按 KALI/WIN 分类的命令历史，并带配对的结果状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-exec

[English](README.md) | 中文

## 概述

`ui-sidebar-exec` 向右侧边栏贡献 `exec` 标签页：一个按新到旧列出可见会话中 agent 已执行 shell 命令的页面。它读取与 Conversation 相同的 Session Controller 事件窗口，按 call id 将每个 shell `tool/call` 与其 `tool/result` 配对，并分类每条命令的执行世界——经 `wsl -d kali` 路由的为 `KALI`，否则为 `WIN`。配对与分类位于表现层纯粹的模块中；React 主体渲染条目的状态、命令文本与配对结果，选择一行会聚焦 transcript 中对应的工具卡片。

## 目录

- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## 模型体验

无，本包将 Session 事件渲染为浏览器历史，不注册任何模型可见的内容。

#### KV Cache 影响

无；exec 页面只读取事件窗口，从不构造或修改模型上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **只列出模型侧 shell 工具**——agent 通过 PTY `terminal_send` 工具发送的命令不会出现；面板只配对 shell 工具的 `tool/call`/`tool/result` 事件。
- **分类基于文本**——KALI/WIN 的划分读取命令文本中的 `wsl -d kali` 路由，因此换行或别名形式进入发行版的命令可能被误记为 `WIN`。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
