---
description: "V4 到 V5 的恒等 Session 转换、放宽的生产者来源接纳，以及原生 V5 校验。"
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

[English](README.md) | 中文

## 概述

在不改变事件的前提下，将已发布的 V4 Session 恢复为 V5。本页说明该迁移边的恒等转换、保留的坐标与继承切点、投递代际拒绝，以及原生 V5 接纳。持久化层负责文件读取和后继代际发布；本库负责转换与目标规则。

## 目录

- [使用本包](#use-this-package)
- [V4 到 V5 规范](#v4-to-v5-specification)
  - [Header 与物理分帧](#header-and-framing)
  - [主体转换](#body-conversion)
  - [序号引用与继承](#sequence-references)
  - [Delivery 代际](#delivery-guards)
  - [源审计与拒绝](#source-audit)
- [原生 V5 接纳](#native-v5-admission)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过 [catalog](../session-format-catalog/README.zh.md) 完成恢复。直接导入用于 catalog 组装和测试；本库没有 Cordis 挂载配置。[公开导出](src/index.ts)提供相邻迁移、已发布的 V4 源 codec、V5 codec 和目标校验器。源 codec 仍由 [V3 到 V4](../session-format-v3-to-v4/README.zh.md) 所有。

仅 header 迁移会在读取正文之前校验并推进元数据：

```text
const targetHeader = sessionFormatV4ToV5.migrateHeader(sourceHeader)
```

每次恢复都会创建独立的阶段状态；`finish()` 会从带标记的种子标记推导种子 Session 的继承切点。[格式协议](../session-format/README.zh.md)拥有调度与错误处理；[JSONL 持久化](../session-persistence-jsonl/README.zh.md)拥有源读取、准备，以及经验证的独占后继发布。

-----

<a id="v4-to-v5-specification"></a>
## V4 到 V5 规范

V5 只放宽了声明的生产者来源词表，而原生 V4 接纳早已把这些来源当作生产者自有的 kind 接受；任何已存储的 V4 事件都未曾使用这些 kind，因此主体转换是恒等转换。本边保留每一个被接纳的源事件、其载荷、其消息身份、其表面元数据与全部坐标。它不创建事件、不改写引用、不重命名字段。更早的 V0–V3 输入先经过各自现有的相邻边到达 V4；那些边保留各自的转换与拒绝策略。

<a id="header-and-framing"></a>
### Header 与物理分帧

| 输入 | V5 结果 | 保留或拒绝 |
|---|---|---|
| 逻辑 V4 header | `version: 4` 变为 `5` | 先运行已发布的 V4 header 校验；其余逻辑 header 字段保持不变。 |
| V4 物理行 | 已发布的 V4 源 codec 解码事件与紧凑运行 | 源分帧与源事件区间解码仍由前一个包拥有。 |
| V5 物理行 | `releasedV5SessionFormatCodec` 复用已发布的 V4 分帧与不变的原生接纳 | V5 事件不会进入 V4 语义校验器。编码与解码不会运行本输入迁移。 |

本边不重命名任何 preset id、文件附件或物理文件名。

<a id="body-conversion"></a>
### 主体转换

每个解码出的源事件都按同一对象原样发出，包括带有不透明载荷与表面元数据的未知可忽略记录。没有任何事件类型被加命名空间：V4 接纳已经拒绝退役的原生形态，而 V5 词表没有需要历史重解释的新增内容。V5 新声明的生产者来源 kind —— `output-limit-continuation`、`pentest-executor`、`pentest-supervisor` 与 `recon-engine` —— 只出现在以 V5 写入的事件中；V4 源工件不可能包含它们，转换也不会凭空制造它们。

<a id="sequence-references"></a>
### 序号引用与继承

恒等转换保留所有序号，因此全部引用、表面坐标、投递坐标与继承位置无需重映射即保持有效。对种子 Session，最后一个携带 `inherited: true` 的 `session/end-seed` 标识继承事件数（不含该标记），且目标计数等于源计数。未播种的阶段在 EOF 前暴露零；播种的阶段把计数留到 `finish()` 才可知。提供的源切点必须与该标记位置一致。未打标的标记不定义分叉继承。

<a id="delivery-guards"></a>
### Delivery 代际

| 投递记录 | 接纳与保留 |
|---|---|
| 宣称代际 5 的 V4 源标记 | 拒绝：推进 header 不得激活目标代际的水位。 |
| 代际 4 的 V4 源标记 | 要求标记之前存在非空 Session id 与非负安全整数 `throughSeq`；外来 id 只允许出现在带有 `parentSession` 的继承切点之前。 |
| 其他源代际，包括大于 5 的值 | 事件类型与载荷坐标原样保留；它们在 V5 中保持不活跃。 |
| 代际 5 的原生 V5 标记 | 以 V5 为当前代际，应用相同的更早坐标与 Session 归属检查。 |
| 原生 V5 中的历史标记，包括代际 4 | 保留记录的坐标与身份；它不是 V5 接受水位。 |

本边不改写任何投递载荷或事件类型。更高版本的迁移拥有未来的激活检查；本边只检查晋升到 V5。

<a id="source-audit"></a>
### 源审计与拒绝

V4 物理解码与 header 校验先于阶段运行。阶段按上文说明检查源切点与投递归属；密集的标记位置由目标校验隐式检查。它不会对源运行完整的已发布 V4 语义恢复器。完整恢复还会应用下文的 V5 目标规则；物理解析、阶段转换与目标恢复是彼此独立的检查。

直接阶段可能为畸形数据抛出 `SessionFormatError`，或在无法保真转换时抛出 `SessionFormatUnsupportedMigrationError`。catalog 把阶段失败包装为不支持的迁移；转换后目标的失败同样归入该分类。严格当前校验直接报告其目标失败。物理损坏遵循所选的解码恢复策略。任何前缀都不是已完成的恢复，拒绝也不授权改动源、发布部分后继或回退代际。

-----

<a id="native-v5-admission"></a>
## 原生 V5 接纳

已标记为 V5 的输入不会运行 V4→V5。原生校验保留记录的事件并返回同一工件；它不合成历史。原生 V5 接纳等于已发布的 V4 接纳：[行接纳](src/codec.ts)在可恢复后缀抑制之前委托给已发布的 V4 检查，[工件恢复](src/validation.ts)复用已发布的 V4 字段与关系校验器，并采用 V5 header 身份与代际 5 的投递归属。[V3 到 V4 规范](../session-format-v3-to-v4/README.zh.md#native-v4-admission)因此拥有完整的原生字段、消息与关系目录 —— 精确的 header 字段、信封与表面规则、采用开放式生产者自有词表的生产者归属、developer 绑定、fork 结果，以及生命周期关系 —— 差异如下。

| 数据 | 原生 V5 规则 |
|---|---|
| 逻辑 header | 相同的字段与检查，`version` 恰为 `5`。 |
| 生产者归属 | V5 新声明的生产者 kind 是普通的生产者自有 kind：读取器保留其 JSON 元数据，不施加任何校验、回放或权限要求，消费者对未投影的 kind 逐例跳过。 |
| 投递代际 | 代际 5 的标记是活跃水位并执行 Session 归属检查；代际 4 及更早的标记是原样保留的历史记录。 |

冻结的 `RELEASED_V4_EVENT_TYPES` 集合列出已发布 V4 读取器理解的事件名 —— 已发布的 V3 词表加上 `developer/message` —— 供固定代际的前置读取器使用。它不继承安装侧写入器的增量。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 —— 点击展开</summary>

迁移声明创建独立的流式阶段，在观察继承标记与投递代际的同时原样发出每个源事件。V5 codec 包装已发布的 V4 codec 以完成物理分帧、header 解码与行接纳，并在解码与编码的 header 上标记 V5 版本。目标恢复器复用已发布的 V4 字段与关系校验器，并校验代际 5 的投递归属。不发布运行时不变式伴生包，因为每个已完成的操作都会校验其结果，且阶段之间从不共享状态。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [格式版本与发布状态](../../../docs/session-format-status.zh.md) —— 检出写入器与已发布格式的权威。
- [新增 Session 格式版本](../../../docs/cookbook/adding-a-session-format-version.zh.md) —— 相邻边集成与校验。
- [JSONL 持久化](../session-persistence-jsonl/README.zh.md) —— 不可变代际选择与发布。

-----

<a id="model-experience"></a>
## 模型体验

### 历史恢复

#### 模型看到什么

历史请求保留其记录的消息与模型配置。恒等转换不添加任何模型可见内容，恢复的事件重建出与其 V4 源相同的表面。

#### Token 影响

转换不改变任何请求文本或承载 token 的数据。

#### KV Cache 影响

本迁移边保留记录的请求前缀。提供方缓存的可用性和淘汰策略不属于本库职责。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- **已接受 V4 转换**——[检查点](../../../docs/session-format-status.zh.md#finalization-record)保护已接受历史。向后兼容的新增可以通过新的确认记录保留 V4；破坏性变更要求后继版本。已写入的 V4 文件不会重跑此入边，历史输入保持不变。
- **固定代际的 V4 前置读取器**——为 V3→V4 边读取 V4 子日志证据的消费者绑定固定的 V4 catalog，而不是安装侧写入器目录，因此其结果不随检出写入器变化。
- **未来的投递代际**——V5 保持前代标记不活跃。激活代际 6 需要下一个相邻边；宣称代际 5 的 V4 源会被拒绝。
- **生产者归属不是权限**——放宽的 kind 不携带任何运行时权限。生产方可检查自己的 kind 以恢复去重；其他读取器必须在没有该投影的情况下保留并派生记录的消息。
- **源拒绝遵循已发布的 V4 codec**——本边不添加自己的源接纳。V4 codec 在解码时拒绝的形态会在此拒绝，且不发布 V5 后继。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
