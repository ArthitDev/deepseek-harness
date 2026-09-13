---
description: "位于 Web composer 访问模式选择器旁的按会话始终搜索控件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-web-search-mode

[English](README.md) | 中文

## 概述

本包在 composer 的访问模式选择器旁放置 `Web Search` 开关。它读取宿主投影的 `webSearchMode` 状态，并发送 `/web-search always` 或 `/web-search auto`；持久化与提示词注入由宿主负责。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

将其与 `ui-conversation`、`dsh-tool-web`、会话投影运行时和命令 remote 一起挂载。只有宿主暴露 `webSearchMode` 时控件才会出现。状态由宿主确认，并从 Session 日志折叠，因此刷新、恢复与上下文压缩后仍然保留。

-----

<a id="understand-the-implementation"></a>
## 理解实现

浏览器插件占用 `conversation.input.webSearch` 单会话席位。它发送用户也能手动输入的命令，并在行内显示命令或传输错误。它不会更改权限、沙箱或审批设置。

-----

<a id="dev-note"></a>
## 开发备注

node 端刻意为空。测试覆盖席位注册、命令发送、错误展示、投影持久化与条件系统提示词组装。

本包不发布 runtime invariant companion，因为此浏览器控件不拥有存在差异的 runtime observation。

-----

<a id="model-experience"></a>
## 模型体验

通过 `/web-search` 命令间接影响；面向模型的系统提示词策略由 `dsh-tool-web` 所有。

#### KV Cache 影响

切换模式会改变下一次组装的系统提示词，并使从该策略区段起的复用失效；模式稳定时前缀保持稳定。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 仅在组合中存在 `web_search` 时提供该开关。
- 搜索提供方的可用性独立；缺少提供方时仍返回标准 web 工具错误。
