---
description: "目标范围策略守卫插件：拒绝引用操作者授权范围之外的网络目标的工具调用，供编排自主（Dead Mode）会话的用户使用"
kind: "package-reference"
---

# scope-policy

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-scope-policy` 是 Dead Mode 姿态的部署级强制执行半边。挂载进组合后，它包裹工具调用管线：每次调用的参数都按渗透测试执行器同一套归一化词汇（`@deepseek-ai/dsh-pentest-run`）读作候选网络目标；引用了排除目标、授权集合之外的目标、无法解析的 URL 形参值、或允许协议清单之外 scheme 的调用，会在工具体执行前被拒绝。启用地址解析时，每个主机名候选解析一次，解析结果触及被排除的 IP 字面量、或解析失败时同样拒绝。拒绝以携带结构化 `SCOPE_DENIED` 代码、策略规则与归一化目标的失败工具结果到达模型，循环因此能读到拒绝原因，UI 也能渲染它。默认不启用：该插件的存在意义，是在操作者声明目标与窗口之后，由 Dead Mode（或其他需要限定范围的）组合显式挂载。

## 目录

- [配置](#config)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="config"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `authorizedTargets` | `[]` | 运行可触碰的主机（`host`、`host:port`、`host/path`）；为空表示所有主机均授权 |
| `excludedTargets` | `[]` | 即使已授权也拒绝的主机；排除始终优先 |
| `allowedSchemes` | `['http', 'https', 'ws', 'wss']` | 工具调用可引用的 URL scheme |
| `resolveAddresses` | `true` | 每个主机名解析一次，解析结果触及被排除 IP 字面量或解析失败时拒绝 |

无法解析的范围条目、空的 `allowedSchemes`、格式非法的 scheme token 都会在插件加载时抛错——配置错误的范围绝不会静默关闭强制执行。未配置任何范围条目时，插件对每次调用原样放行，因此挂载它在操作者声明范围之前是惰性的。

<a id="model-experience"></a>
## 模型体验

### 范围策略执行

#### 模型看到什么

被拒绝的调用会将工具结果替换为 `Error: denied by scope policy: '<target>' <规则短语>` 形式的 `isError` 消息；同一结果附带结构化 `error.info`（`code`，以及注明规则与归一化目标的 `reason` 细节）供 UI 渲染。范围内的调用原样通过。

#### Token 影响

调用在范围内时零 token 消耗：插件只注册一个 `tools/execute` 监听器并原样委托。范围内主机名的 DNS 解析每次调用一次，绝不引用给模型。

#### KV Cache 影响

无。守卫不注册任何提示词段落；拒绝只改写日志中已有的工具结果。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>
- **主机名授权基于文本；解析仅用于排除。** 解析地址检查将 DNS 答案与被排除的 IP 字面量条目比对；它不会把授权清单改写成 CIDR，也不会把连接钉扎到已验证的答案集合。本检查与工具自身建连之间仍存在 DNS rebinding 竞态——关闭它需要 shell 沙箱中的网络隔离（即已隔离文件的同一接缝），届时这里的解析器退为第二意见而非边界。
- **无逐调用的命令效果判定。** 插件判定目标、协议与解析地址；不判定 shell 命令对已授权主机做了什么。那仍由执行器的恢复纪律与运行提示承担。

### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
