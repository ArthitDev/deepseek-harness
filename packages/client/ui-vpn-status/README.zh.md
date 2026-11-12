---
description: "在 Web 框架中追加 VPN 验证状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-vpn-status

[English](README.md) | 中文

## 概述

Web 状态行显示[宿主 VPN 采样](../../host/vpn-status/README.zh.md)、依据和上次检查时间。通过共享资源模型每 15 秒读取缓存，过期或读取失败时移除验证。注册到可追加的 `shell.status`，不替换 `shell.bottom`。窄窗口内文字换行，并使用当前主题。

## 目录

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="dev-note"></a>

## 开发备注

验证状态只在观测结果有效且未过期时成立；此结果不能代表其他进程或目的地址的路由。


<a id="model-experience"></a>

## 模型体验

无，本包仅渲染操作员可见状态。

#### KV Cache 影响

不改变模型请求或可复用前缀。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

- 状态行最多滞后宿主缓存 15 秒；过期时在本地移除验证。采样限制和启用配置由宿主包说明。
