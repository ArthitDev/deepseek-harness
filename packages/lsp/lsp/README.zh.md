---
description: "LSP 能力服务（ctx.lsp）：按文件扩展名选择提供方、四种规范化导航操作、按需诊断与结构化错误，供用户和维护者组合代码导航。"
kind: "package-reference"
---

# @deepseek-ai/dsh-lsp

[English](README.md) | 中文

## 概述

使用 dsh-lsp 为 agent（智能体）提供定义、引用、实现与悬停导航，也可单独按需查询一个工作区文件的诊断。导航按文件扩展名选择提供方，并返回规范化结果与结构化错误。诊断返回有边界的发现项及明确的新鲜度和文档身份。本包不提供通用 JSON-RPC 访问、重命名、格式化或符号列表。它必须与 dsh-lsp-stdio 等提供方及 dsh-tool-lsp 组合。

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

挂载语言服务器提供方与 `lsp` 工具，即可为 agent 提供文本搜索无法可靠给出的、基于语义的代码导航——区分同名函数、跟随导入别名、把接口连接到其实现，或读取推断出的类型。本包就是这些包所注册的服务；它自身不定义任何 UI、工具或提供方。

### 何时选择

当部署希望语言服务器支撑模型可见的代码导航或文件诊断时，选择此服务。导航覆盖定义、引用、实现与悬停；诊断是没有光标位置的独立请求。两种操作都按文件扩展名选择提供方。本服务与提供方无关：本地 stdio、远程和沙箱原生提供方都以相同方式注册，因此更换后端不会改变模型看到的内容或请求方式。

### 组合导航栈

seam 需要提供方与消费方才能发挥作用。最小组合挂载服务、stdio 提供方与工具：

```yaml
- name: '@deepseek-ai/dsh-fs-local'
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-lsp'
- name: '@deepseek-ai/dsh-lsp-stdio'
- name: '@deepseek-ai/dsh-tool-lsp'
```

服务器命令、扩展名映射与文件系统／子进程配对在提供方与工具包中配置；见 [dsh-lsp-stdio](../lsp-stdio/README.zh.md) 与 [dsh-tool-lsp](../tool-lsp/README.zh.md)。

### 四种操作

每个查询在源文件的某个光标位置提出四个语义问题之一；结果是被规范化的位置或悬停内容，绝不是原始协议载荷。

| 操作 | agent 获得的内容 |
|---|---|
| `goToDefinition` | 光标处符号的定义位置 |
| `findReferences` | 所有引用，始终包含声明 |
| `goToImplementation` | 具体实现位置 |
| `hover` | 该符号的规范化文档，或没有 |

`findReferences` 始终包含声明，因此影响分析绝不会遗漏定义位置。协议上的位置是从零开始的 UTF-16；面向模型的工具接受从 1 开始的光标坐标并自行转换。

### 失败与恢复

当没有注册的提供方处理该文件扩展名时，查询会以结构化错误 `LSP_UNAVAILABLE` 失败——为该扩展名添加提供方，或查询受支持的文件。无效或冲突的提供方注册会在任何路由发布前以 `LSP_INVALID_PROVIDER` 或 `LSP_CONFLICT` 失败；对已释放提供方的查询以 `LSP_DISPOSED` 失败。消费方捕获 `LspError` 并按稳定的 `code` 路由；经由工具，这些会呈现为模型可读的错误结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释 seam 背后的设计决策并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **能力 seam，Service Definition 角色。** 本包拥有 `ctx.lsp` 与提供方注册表；提供方注册的是能力而非工具，`dsh-tool-lsp` 是面向模型表层的唯一 owner。
- **原子注册。** `registerProvider()` 在变更前验证并检查全部冲突：无效或冲突的注册不会发布任何内容，其 disposer 会一并释放 id 与全部扩展名保留。
- **与顺序无关的选择。** `query()` 按文件的最终扩展名（规范化为小写、以点开头的形式）路由；注册与 HMR（热模块替换）顺序绝不会改变路由。language id 只用于同步临时文档，绝不参与选择。
- **封闭的词汇。** 四种操作的联合是封闭的——新增操作是跨 seam、提供方与工具的编译期强制变更。没有 JSON-RPC 逃生口，且每个请求字段都必填，因此不存在 `resolve()` 步骤。
- **提供方拥有的工作区坐标。** 位置结果携带提供方的规范工作区 URI，消费方据此在执行世界的命名空间内相对化文件 URI，而不是应用宿主平台路径规则。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Lsp` 服务、`registerProvider`／`query`、`finalExtension`、`LspError` code |
| [`src/types.ts`](src/types.ts) | seam 词汇：请求、结果、提供方与服务约定 |
| [`src/brand.ts`](src/brand.ts) | `LspProviderId` 品牌化 id 类型与工厂 |
| — | 不发布运行时不变式伴生入口；提供方 id 与扩展名路由属于以原子方式更新的私有状态；该 seam 既不公开可枚举快照，也不公开可供独立比较的生命周期事件。 |

### 注册与选择生命周期

注册与释放通过 `ctx.effect()` 执行，因此提供方路由随注册 fiber 一同存活与消亡。`finalExtension()` 按两种路径分隔符切分，对没有扩展名的名称或点开头的 dotfile 返回 `''`，任何路由都不会匹配。`LspError` 扩展 `HarnessError`，携带稳定的 code（`LSP_INVALID_PROVIDER`、`LSP_CONFLICT`、`LSP_UNAVAILABLE`、`LSP_DISPOSED`、`LSP_UNSUPPORTED_OPERATION`、`LSP_MALFORMED_RESPONSE`），调用方据此路由，而不是解析 `message`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享的导航模型逐步进入提供方与工具。

- [LSP 导航子系统](../../../docs/subsystems/lsp.zh.md)——操作、坐标、请求与结果，以及 `LspError` code。
- [dsh-lsp-stdio](../lsp-stdio/README.zh.md)——注册到该 seam 的 stdio 提供方。
- [dsh-tool-lsp](../tool-lsp/README.zh.md)——基于该 seam 的面向模型工具。
- [lsp 组地图](../README.zh.md)——三个包的家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-lsp` 间接影响；该工具拥有面向模型的 `lsp` schema、提示词指引与渲染结果，本注册表自身不贡献提示词或 schema。

#### KV Cache 影响

不会直接失效；请求前缀变更由 `dsh-tool-lsp` 负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义 seam 当前的范围。它们是包约束，不是任务积压。

- **同一运行时内扩展名归属互斥**——两个提供方不能同时声明 `.ts`，即使 language id 不同；重叠会使注册失败。预期扩展是在注册之上增加部署配置的 selector，它可以在不把提供方选择加入模型输入的前提下放宽互斥保留。
- **导航仍限于四种操作**——symbol 与 call hierarchy 因需要不同 schema 而推迟；diagnostics 使用具有明确新鲜度的独立文件请求；修改（重命名、code action、格式化）需要独立工具并集成预览、权限与写入策略。
- **没有观测表层**——可用性只能通过运行 `query()` 并按抛出的 `LspError` code 路由来观测；没有提供方变更事件或能力状态查询。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
