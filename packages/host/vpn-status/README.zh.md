---
description: "缓存验证宿主 HTTPS 出口，供 VPN 状态显示使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-vpn-status

[English](README.md) | 中文

## 概述

宿主在 Windows 和 Linux 上检查 HTTPS 出口，Web 和 TUI 共享同一份缓存。读取操作不会触发网络请求，结果和日志不包含 IP 地址或凭证。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>

## 配置

将组合中的 `vpn-status` 条目设为 `enabled: true` 以启用。每次检查访问 `https://am.i.mullvad.net/json`；Mullvad 能看到请求的公网出口 IP。首次在启动时检查，随后在每次检查完成后等待 `intervalMs`（默认 300000，最小 60000）。`timeoutMs` 默认 10000。检查不重叠，拒绝重定向，销毁时取消并等待当前请求结束。

Mullvad 官方的 `mullvad_exit_ip: true` 可验证其出口。其他服务商，包括 WireGuard 和 OpenVPN 部署，需要在 `expectedExitCidrs` 中配置已知的 VPN 出口 IP/CIDR，支持 IPv4 和 IPv6。宽泛或共享的范围会削弱验证依据。公网 IP 变化本身不能验证 VPN。无效 CIDR 会导致加载失败，拒绝通用 /0 范围。

`vpnStatus/read` Remote 和进程内 `ctx.vpnStatus.read()` 返回 checking、verified、unverified 或 unknown，以及依据、上次检查时间和失效时间。不匹配为 unverified；网络、解析或端点失败为 unknown。每次新检查清除旧验证，过期样本不能保持 verified。Web 标注宿主 HTTPS，TUI 使用同一缓存。不同宿主进程各自管理检查周期。

<a id="dev-note"></a>

## 开发备注

验证状态只在观测结果有效且未过期时成立；此结果不能代表其他进程或目的地址的路由。


<a id="model-experience"></a>

## 模型体验

无，本包仅显示操作员状态，不向模型上下文添加内容。

#### KV Cache 影响

不改变模型请求或可复用前缀。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

- 这是对一个宿主 HTTPS 目的地的定期采样，不是连续监控、kill switch 或所有流量的证明。两次检查之间路由可能变化。分流、IPv4/IPv6 差异、代理、远程 shell 和 Kali 命名空间可能使用其他路由。其他服务商的验证依赖准确的预期出口，仍使用 Mullvad 公共 JSON 服务观察出口。无法区分 VPN 与共享同一配置出口的其他路径，两个界面均不声称这些其他路由受到保护。
