---
description: "浏览器侦察运行查看器：基于 reconRuns Remote 命名空间的 Recon 页签、输入区目标控件，以及精简的 Chat 交接。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-recon

[English](README.md) | 中文

## 概述

使用本包为操作员提供确定性 recon 引擎的浏览器表面。它注册 `conversation.view` 的 Recon 页签（运行列表、紧凑报告、覆盖率、warning、阶段、按需读取 evidence）与输入区的 Recon Target 控件，两者都接到生成的 `reconRuns` Remote 命名空间。从任一入口发起扫描，调用的都是 `recon_scan` 工具所驱动的同一引擎；扫描进行中，页签轮询运行列表以显示实时阶段进度并提供取消；完成的报告为旧版扫描显示徽标、解释不可观测的后端，并把精简投影经 Chat 交给 Agent。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 web-app bundle 中把本插件挂载到 recon-engine host 插件旁边；它需要 `remote.reconRuns` 载体、会话外壳与语言服务。它自身没有配置：证据位置、预算与缓存行为仍由引擎插件的设置卡片持有。操作员在输入区控件或页签里输入目标 URL，在阶段行中等待运行结束，从列表打开已存储的运行，并通过确认对话框删除一个运行及其全部证据。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部结构——点击展开</summary>

`src/client/index.ts` 注册两个 slot，并把生成的 Remote 客户端适配成视图注入的加载器；每个 Remote 结果只解包一次，错误显示在视图的告警行。`ReconView.tsx` 持有列表/详情状态、扫描进度轮询（每三秒刷新一次列表并读取最新运行条目的阶段），以及 `reconChatPrompt` 中的精简 Chat 投影——保留 finding、端点、覆盖率与 warning，绝不携带原始正文。`ReconTargetControl.tsx` 渲染输入区入口。文案位于 `locales.ts`，简体中文是键集的唯一事实来源，英文对照校验完整。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Recon 引擎](../../pentest/recon-engine/README.zh.md) — 本表面投射的扫描、报告与证据。
- [客户端 UI 文案由语言包持有](../../../.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.zh.md) — 为什么所有文案都走类型化字典。

-----

<a id="model-experience"></a>
## 模型体验

### 操作员表面，而非 agent 表面

#### 模型看到什么

不直接看到任何内容。Chat 收到的是操作员主动发送的内容：`reconChatPrompt` 构建的精简投影，作为一条用户消息经会话服务提交。

#### Token 影响

每次显式发送一条有界消息；投影携带端点、覆盖率与 warning，但不携带原始页面或证据正文。

#### KV Cache 影响

无。本包不注册任何工具或提示；这条消息与任何其他用户输入的行为一致。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

页签只投射已存储的运行；它自身从不执行侦察。

- **没有认证重扫流程** — 该表面只发起引擎定义的匿名 Full Deep 扫描。
- **轮询式进度** — 实时阶段更新靠三秒一次的列表轮询，不是推送通道；不写检查点的扫描只能显示不确定进度。
- **没有运行对比** — 同一目标的两次运行并排列出，但从不做差异比较。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
