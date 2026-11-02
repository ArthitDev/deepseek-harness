---
description: "面向模型的 lsp 与 lsp_diagnostics 工具：精确导航和带明确新鲜度的有边界文件诊断，供用户与维护者组合模型代码导航。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-lsp

[English](README.md) | 中文

## 概述

`dsh-tool-lsp` 让模型通过只读 `lsp` 工具导航代码，并通过 `lsp_diagnostics` 检查单个工作区文件的有边界诊断。导航结果按文件分组并标记省略或截断；诊断结果带有明确的新鲜度状态和文档身份。该包要求配置 LSP 提供方和会话工作区根目录。文本搜索有歧义或需要精确符号关系时使用导航；修改后或报告完成前检查相关文件的诊断。

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

当文本匹配有歧义，或修改前需要精确的定义、实现或引用时，agent（智能体）使用 `lsp`；该工具的提示词指引会告诉它，普通导航应优先使用 `search`／`read`。

### 工具

`lsp` 接受 `operation`（`goToDefinition`、`findReferences`、`goToImplementation` 或 `hover`）、`file_path`、`line` 与 `character`。`line` 与 `character` 是正的、从 1 开始的 UTF-16 光标坐标；未落在符号上的位置可能返回空结果。`findReferences` 始终包含声明。`lsp_diagnostics` 接受一个 `file_path`，并返回有边界的诊断及新鲜度状态。提供方、language id、工作区根目录、限制、超时与可执行文件均不进入模型输入。

### 模型得到什么

导航返回按文件分组的 `path:line:character` 位置行（从 1 开始），悬停返回规范化文本或无悬停提示。`lsp_diagnostics` 返回文档版本、内容摘要、提供方身份、观察时间、新鲜度状态、诊断与省略计数。`current` 表示观察时收到匹配文档版本的报告，不代表报告完整，也不能替代测试；`unverified`、`not-reported`、`changed` 或 `invalid` 均不能证明文件没有问题。位置结果受 `maxLocations` 限制，呈现文本受 `maxResultChars` 限制。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxLocations` | `100` | 出现省略标记前可渲染位置的最大数量 |
| `maxResultChars` | `16000` | 完整渲染结果的最大长度，包括截断元数据 |
| `timeoutMs` | `60000` | 由 `dsh-tool-call-timeout-policy` 强制执行的工具调用超时预算；覆盖完整的排队打开／查询／关闭生命周期，且模型不可配置 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-lsp)是每个受支持字段的穷尽式真源。

### 失败与恢复

该工具要求会话工作区根目录（`header.cwd`），没有回退值；缺失时会在任何查询前以 `LSP_WORKSPACE_REQUIRED` 失败。当没有提供方处理该文件扩展名时，查询以 `LSP_UNAVAILABLE` 失败；格式错误的提供方载荷仍保持为结构化 `LSP_MALFORMED_RESPONSE` 错误。这些会呈现为模型可读、可路由的错误工具结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计说明

- **只做消费方。** 工具运行时只注入 `tools`、`lsp` 与 `systemPrompt`，不导入任何提供方，并且只把 `exec.signal` 传给 seam。
- **坐标转换。** `parseLspArgs` 验证 `line` 与 `character` 是正整数，并转换为 seam 从零开始的位置；渲染出的位置再转回从 1 开始的形式。
- **规范结果透传。** 工具返回 seam 的封闭联合（`{ kind: 'locations', locations, resolvedWorkspaceUri }` 或 `{ kind: 'hover', hover }`），原生渲染器可以直接检查每个已取得的位置与从零开始的范围。
- **执行世界 URI 渲染。** `renderUri` 以提供方的规范工作区 URI 为基准解析 `file:` URI——在其内为工作区相对路径，在其外为从 URI 派生的绝对路径，格式错误或非 `file:` 时原样保留——绝不把宿主平台路径规则应用到会话 cwd。
- **渲染后再设限。** `maxLocations` 先限制条目数量，`maxResultChars` 再限制包含省略或截断标记在内的完整渲染文本。
- **通用搜索卡片呈现。** `presentLspCall` 渲染 `{ card: 'generic', kind: 'search', title, locations: [{ path, line }] }` 视图；从 args 派生的标题携带操作与从 1 开始的光标，跟随焦点对准查询行，标题则保留列号。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、工具注册、系统提示词区段、执行 |
| [`src/render.ts`](src/render.ts) | 纯格式化、坐标转换、URI 解析、结果上限、UI 呈现 |
| [`src/session-cwd.ts`](src/session-cwd.ts) | 从会话 `header.cwd` 取得工作区根目录 |
| — | 不发布运行时不变式伴生入口；该无状态适配器提供一个工具和一个提示词区段，而查询生命周期与结果关系仍由它所组合的工具 seam 和 LSP seam 负责。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从面向模型的表层逐步进入 seam 与提供方。

- [LSP 导航子系统](../../../docs/subsystems/lsp.zh.md)——操作、坐标、请求与结果，以及 `LspError` 错误码。
- [dsh-lsp](../lsp/README.zh.md)——本工具查询的 seam。
- [dsh-lsp-stdio](../lsp-stdio/README.zh.md)——应答这些查询的 stdio 提供方。
- [lsp 组地图](../README.zh.md)——三个包的家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

一个系统提示词区段（first-party 顺序 2200）将 LSP 定位为精确辅助工具，文本如下：

##### 逐字指引

```markdown
Use search/read for ordinary navigation. Use lsp when textual matches are ambiguous or before a change requires precise definitions, implementations, or references. Use lsp_diagnostics for relevant edited files and before reporting completion. Diagnostics may be stale, unverified, or unavailable; never treat silence as clean. Positions are one-based line and character (UTF-16) at the cursor; an off-symbol position may return no results. findReferences always includes the declaration.
```

#### Token 影响

插件处于活跃状态时，每次请求承担固定指引成本。

#### KV Cache 影响

只要插件 scope 与指引文本不变，前缀就保持稳定；激活或 dispose（资源释放）可能使从该区段起的复用失效。

### 工具 schema

#### 模型看到什么

模型会看到生成的 [`lsp` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-lsp)。

#### Token 影响

启用期间，每次请求承担固定 schema 成本；`timeoutMs` 预算绝不会发给模型。

#### KV Cache 影响

只要可见工具定义与顺序不变，前缀就保持稳定；注册生命周期或 scope 限制可能使从第一个变化的 schema token 起的复用失效。

### 结果

#### 模型看到什么
按文件分组的 `path:line:character` 位置行或规范化悬停文本，先由 `maxLocations` 限制，再由 `maxResultChars` 限制；省略与截断标记计入完整字符上限。诊断结果受 `maxResultChars` 限制，并保留新鲜度与文档身份字段；它们只进入工具结果，不改变请求前缀。这些上限只影响呈现，不影响规范值。空结果使用不同的 `No results.`／`No hover information.` 行。

#### Token 影响

每项工具结果以 `maxResultChars` 为上限，`maxLocations` 还会限制导航项数量。

#### KV Cache 影响

工具结果追加在已缓存请求前缀之后，不会直接使其失效。

### UI 呈现

#### 模型看到什么

无。客户端渲染通用搜索卡片——`{ card: 'generic', kind: 'search', title, locations: [{ path, line }] }`——从 args 派生的标题携带操作与从 1 开始的光标；跟随焦点对准查询行，标题则保留列号。

#### Token 影响

直接 token 影响为零，因为渲染只发生在客户端。

#### KV Cache 影响

无；UI 呈现位于模型请求之外。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明该工具何时不太合适。它们是当前包约束，不是任务积压。

- **UTF-16 光标坐标**——列坐标与协议精确一致，但模型难以在非 BMP 字符周围计数；未落在符号上的位置可能返回空结果，因此提示词解释了该约定，但不鼓励广泛使用 LSP。
- **不承诺跨服务器完整性**——受支持的服务器仍可能根据索引就绪情况返回空或部分结果；该工具不承诺跨语言或服务器的完整性。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
