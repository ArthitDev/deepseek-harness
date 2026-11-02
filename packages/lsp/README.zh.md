---
description: "语言服务器代码导航和诊断：通过共享 LSP seam、stdio 提供方与模型工具，让用户和维护者组合代码语义查询。"
kind: "package-group"
---

# lsp/：语言服务器代码导航

[English](README.md) | 中文

## 概述

lsp 组让 agent（智能体）通过配置好的语言服务器导航代码并检查有边界的诊断。使用 `lsp-stdio` 连接本地 stdio 服务器，使用 `tool-lsp` 向模型开放 `lsp` 导航和 `lsp_diagnostics`。共享的 `lsp` 包使提供方选择和规范化结果保持一致，因此更换服务器不会改变模型请求。部署必须自行提供并配置语言服务器；本组不随附服务器。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [lsp/](lsp/README.zh.md) | 定义按文件扩展名选择提供方、四种规范化导航操作、按需诊断与结构化错误 | ctx.lsp |
| [`lsp-stdio/`](lsp-stdio/README.zh.md) | 通过 `ctx.fs` 与 `ctx.subprocess` 驱动配置好的 stdio 语言服务器命令，注册为提供方 | 注册到 `ctx.lsp` |
| [`tool-lsp/`](tool-lsp/README.zh.md) | 通过 `lsp` 与 `lsp_diagnostics` 向模型提供代码导航和有边界的文件诊断 | 注册到 `ctx.tools` |

提供方注册的是能力而非工具：`tool-lsp` 是面向模型的名称、schema、提示词指引与呈现的唯一 owner，因此更换提供方绝不会改变模型请求导航的方式。

-----

<a id="related-documentation"></a>
## 相关文档

- [LSP 导航子系统](../../docs/subsystems/lsp.zh.md)——操作、坐标、请求与结果，以及 `LspError` 错误码。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-lsp)——模型接收的 `lsp` schema。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
