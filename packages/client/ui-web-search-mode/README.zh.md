---
description: "General Settings 中的全局始终搜索开关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-web-search-mode

[English](README.md) | 中文

## 概述

本包在 General Settings 中放置 `Always use web search` 开关。它写入宿主拥有的 `web-search-policy` 设置；`dsh-tool-web` 在每次请求前读取该设置，并负责注入提示词。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

将其与 `ui-settings`、`dsh-tool-web`、设置 remote 和宿主的 `@deepseek-ai/dsh-tool-web/settings` 条目一起挂载。只有宿主暴露 `web-search-policy` 命名空间时，该设置行才会出现。此设置默认关闭，并持久化在用户设置文档中。

-----

<a id="understand-the-implementation"></a>
## 理解实现

浏览器插件向 `settings.general.item` 添加一个设置行，并使用共享的 `Switch` 控件。加载或保存时开关会禁用；宿主未暴露该命名空间时设置行会隐藏；写入失败会显示在行内。本插件不再注册聊天控件。

-----

<a id="dev-note"></a>
## 开发备注

node 端刻意为空。测试覆盖设置席位注册、持久化写入、错误展示、宿主策略优先级与条件系统提示词组装。

本包不发布 runtime invariant companion，因为此浏览器控件不拥有存在差异的 runtime observation。

-----

<a id="model-experience"></a>
## 模型体验

启用时，`dsh-tool-web` 要求模型在每次回答前发送一次结构化 `web_search` 调用。关闭时，模型仅在信息可能已更新或现有知识不足时搜索，并优先使用其他更合适的工具。搜索词默认使用用户的语言。

#### KV Cache 影响

更改此设置会改变所有会话下一次组装的系统提示词。设置不变时，提示词前缀保持稳定。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 仅在宿主暴露 `web-search-policy` 时提供该开关。
- 搜索提供方的可用性独立；缺少提供方时仍返回标准 web 工具错误。
