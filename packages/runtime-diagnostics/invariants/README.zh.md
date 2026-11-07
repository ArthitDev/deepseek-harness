---
description: "用于实时组合的运行时不变量检查：运行包自有检查的注册表服务，供用户和维护者选择、配置或排查。"
kind: "package-reference"
---

# @deepseek-ai/dsh-invariants

[English](README.md) | 中文

## 概述

`dsh-invariants` 在 Shield Break Harness 组合中运行包自有的运行时检查——不变量：任何包都可以发布一个 `./invariant` 配套入口，在组合运行期间验证其自身的持久关系（权威事件流与可变快照）。检查自动运行，失败的检查会报告归因到拥有被违反关系的包的 `InvariantError`。需要带全局开关与包名过滤器的自检诊断时选择它；组合按需显式挂载它及所需配套入口，而单独加载服务不会安装任何检查。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当组合需要验证自身运行时约定时挂载注册表，然后决定运行哪些包的检查。服务暴露 `ctx.invariants`；配套入口以其包的精确 npm 名称注册检查，每次失败都会携带所属包名。

### 何时使用

需要实时诊断的组合请使用注册表。本分支随附一个可执行配套入口——`@deepseek-ai/dsh-experimental-agent-team`，其不变量逐条核对 Agent Teams 事件与投影后的已提交流；`dsh-base` 刻意省略运行时诊断。自定义组合挂载注册表，并为任何其他已加载、且希望检查其约定的包添加配套入口。单独加载注册表不会安装任何检查：它自身不携带任何产品检查，因此从不挂载配套入口的组合不会观察到任何诊断行为。

### 启用检查与选择包

注册表默认启用，并在没有过滤器的情况下检查每个已注册的包。用 `enabled` 作全局开关，用 `package_allowlist` 只接纳指定包，用 `package_blocklist` 在 allowlist 匹配之后排除包——blocklist 匹配优先于 allowlist 匹配。模式是区分大小写的 JavaScript 正则表达式源（除非自带 `^` 与 `$`，否则不锚定）；无效、空白或重复的条目会使服务启动失败，而不是被跳过。

```yaml
- name: '@deepseek-ai/dsh-invariants'
  config:
    enabled: true
    package_allowlist:
      - '^@deepseek-ai/dsh-'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 所有已注册检查的全局开关 |
| `package_allowlist` | `[]` | 接纳包名的正则源；为空则全部接纳 |
| `package_blocklist` | `[]` | 在 allowlist 匹配之后排除包名的正则源 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-invariants)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 运行哪些检查

每个配套入口保护其包拥有的关系，且只为可观察的事件或可变数据关系安装检查——绝不针对服务或方法是否存在。已发布的可执行配套入口覆盖：

| 配套入口 | 检查 |
|---|---|
| `@deepseek-ai/dsh-experimental-agent-team` | 每条 `experimental-team/*` 会话事件都能干净地应用到投影后的已提交团队状态（名册、邮箱回执、任务生命周期） |

其余工作区包省略配套入口，并在各自 README 中说明包级原因。

### 向自定义组合添加配套入口

配套入口就是挂载在注册表旁的普通插件。它声明所需的服务，并以其包的精确 npm 名称注册；注册表会先完成其设置再完成注册。

```ts
import type { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as TeamInvariant from '@deepseek-ai/dsh-experimental-agent-team/invariant'

declare const ctx: Context

ctx.plugin(InvariantRegistry, { enabled: true })
ctx.plugin(TeamInvariant)
```

### 检查失败时

违规会从报告它的上下文抛出 `InvariantError`：它携带稳定的 `INVARIANT` 代码、所属包的完整 npm `packageName`，以及以 `invariant violated by "<package>": …` 开头的消息。失败因此可以归因到某个包，而注册表无需导入任何产品代码。installer 本身失败的配套入口会被释放，其注册会回滚，因此损坏的检查不会遗留部分监听器。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释注册表背后的设计；可观察行为已在[使用本包](#use-this-package)中说明。

### 设计理念

- **与产品无关的注册表。** 服务不导入任何 session、agent、scope 或 agent-loop 包，也不包含它们的检查；配套入口把检查放在其归属者旁边。
- **真实关系，而非人为断言。** 配套入口只检查其包拥有的事件流或可变数据关系；确认方法、插件名、注入或固定纯函数结果是类型、加载或单元测试关注点，绝不是运行时不变量。
- **注册保留归属。** 即使过滤器让 installer 保持非活动，包名也会被保留，因此两个插件永远不会静默认领同一个名字。
- **配套入口接线规则。**配套入口以其包 npm 名注册检查、通过 reporter 参数安装、并在关系被违反时立刻失败；配套入口的省略决策记录在[省略配套入口笔记](../../../.agents/notes/implemented/simplification/2026-08-28-omit-unneeded-invariant-companions.zh.md)。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、`InvariantRegistry` 服务、选择、注册、`InvariantError` |
| — | 不发布运行时不变量配套入口；注册归属与子级生命周期本身就是服务的变更边界；由同一注册表观察它们只会重复其实现。 |

### 选择与注册生命周期

`register(packageName, installer)` 保留完整 npm 名称并返回作用域化 disposer。启用的 installer 在专用子 fiber 中运行；`installer.inject` 声明该 fiber 可访问的服务，同步或异步完成都会在注册成功前被 join。失败会释放子级并原子地收回保留。服务拥有每个注册 fiber，返回的 disposer 同时属于配套 fiber，因此卸载任一侧都会移除监听器、跟踪状态与保留——配套入口可以重新加载并再次注册同一名称而不保留旧状态。由会话支撑的配套入口从持久事件重建 baseline；仅实时配套入口观察重新加载后开始的操作。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从生成的服务参考逐步进入决策证据与组地图。

- [运行时不变量子系统](../../../docs/subsystems/invariants.zh.md)——`Config`、installer、服务与配套入口约定的生成参考。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-invariants)——每个受支持配置字段及其源声明。
- [运行时不变量约定 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.zh.md)——运行时不变量可以断言什么，以及强制配套入口接线的机械门禁。
- [runtime-diagnostics 组地图](../../README.zh.md)——相邻的诊断包。

-----

<a id="model-experience"></a>
## 模型体验

无。作为观察者，本包验证请求但从不改写其上下文。

#### KV Cache 影响

检查只观察已组装的请求与持久状态，不修改请求内容，因此提供方缓存复用与底层组合产生的结果完全一致。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明注册表何时不合适或需要特别运维。它们是当前包约束，不是任务积压。

- **过滤器在服务生命周期内固定**——`enabled`、`package_allowlist` 与 `package_blocklist` 在启动时编译一次；更改它们需要执行 Cordis 插件重新加载。
- **仅实时配套入口会遗漏重载前的操作**——只观察实时操作的配套入口无法重建自身重新加载前开始的操作；由会话支撑的配套入口从持久事件重建 baseline。
- **请求重建只覆盖 loop 构建的请求**——`dsh-agent-loop` 配套入口只重建 loop 显式构建的请求；直接一次性 LLM 调用即使由调用方冻结或附加会话 id，仍不在此约定内。
- **没有配套入口就没有检查**——注册表自身不携带产品检查；只挂载服务的组合观察不到任何行为。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
