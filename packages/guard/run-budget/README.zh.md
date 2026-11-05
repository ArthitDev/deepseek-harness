---
description: "运行预算守卫插件：token 或墙钟预算耗尽后拒绝新的工具调用，供编排有界自主运行的用户使用"
kind: "package-reference"
---

# run-budget

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-run-budget` 是 Dead Mode 预算要求（"งบใกล้หมด: จบด้วยรายงาน partial แทน loop ไม่จำกัด"）的强制执行半边。挂载进组合后，它包裹工具调用管线：一旦 agent 的测量 token 总量达到 `maxTotalTokens` —— 通过 `@deepseek-ai/dsh-token-meter` 的持久日志 fold 读取，绝不在本包内估算 —— 或自该 agent 首次被观察的调用起经过 `maxWallMs`，之后的每次工具调用都会被拒绝。拒绝以失败工具结果到达模型，其文本指示立即停止调用工具并产出 partial 报告，因此拒绝本身就是收尾触发器。直接的 `ctx.tools.execute()` 调用没有 agent，永不计预算；调用在阈值之内时，插件不添加任何模型可见内容。

## 目录

- [配置](#config)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="config"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxTotalTokens` | `0` | 由 token meter 测量的 token 上限；`0` 表示禁用 |
| `maxWallMs` | `0` | 自 agent 首次被观察调用起的墙钟上限；`0` 表示禁用 |

两个上限都为 `0` 时挂载属于配置错误，加载即抛错；负数或小数同样抛错。设置 `maxTotalTokens` 但未挂载 token-meter 服务也会显式失败 —— 无法测量的预算绝不会静默关闭。

<a id="model-experience"></a>
## 模型体验

### 运行预算执行

#### 模型看到什么

首次拒绝会将工具结果替换为 `Error: run budget exhausted (totalTokens=<n> [wallMs=<ms>]): stop making tool calls and produce the partial report now`；之后每次调用同样被拒绝，持久投影保留该文本（结构化 `error.info` 不会回显进日志）。

#### Token 影响

运行在预算之内时零 token 消耗：一个 `tools/execute` 监听器原样委托，拒绝不会产生工具结果之外的新模型请求。

#### KV Cache 影响

无。守卫不注册任何提示词段落，也不改写历史；保留的拒绝文本本来就是日志中工具结果的一部分。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>
- **墙钟起点是首次被观察的调用，而非会话启动** —— agent 首次工具调用之前的空闲时间不计入。以启动为锚点的时钟需要会话生命周期锚点，待有消费者需要时再延期实现。
- **无实时花费显示** —— 强制执行在本包；在 host UI 卡片上呈现 `totalTokens`/`wallMs` 属于已经读取 token-meter 快照的 host presenter。
- **拒绝是收尾触发器，不是硬停** —— 模型被指示以 partial 报告收尾；继续调用工具的运行会持续收到拒绝（随后 repeat-call 提醒会标记该循环）。

### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
