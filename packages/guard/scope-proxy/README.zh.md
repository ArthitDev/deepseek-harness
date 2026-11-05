---
description: "范围钉扎正向代理插件：按操作者范围判定每条连接并钉扎到已验证地址，无需沙箱即可关闭 DNS rebinding"
kind: "package-reference"
---

# scope-proxy

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-scope-proxy` 关闭 `tools/execute` 守卫无法覆盖的唯一强制执行缺口：判定目标与建立连接之间的 DNS rebinding 竞态。它在回环地址上运行正向代理，讲 `HTTP_PROXY` 客户端实际发送的两种形式——绝对形式请求与 `CONNECT` 隧道；每条连接都按与 `scope-policy` 相同的归一化范围词汇（`dsh-pentest-run`）判定，主机名只解析一次，出站 socket 打开到已验证地址，因此后续 DNS 答案无法改变该连接的落点。TLS 保持端到端：隧道是盲管道，证书校验仍归客户端。代理 URL 以 `DSH_SCOPE_PROXY` 贡献给受管 shell 环境；把运行期的 `HTTP_PROXY`/`HTTPS_PROXY` 指向它，curl、`Invoke-WebRequest` 与多数工具的连接都会经过范围强制与钉扎，无需沙箱。只绑定回环——代理按目标判定，不按调用方判定。

## 目录

- [配置](#config)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="config"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `authorizedTargets` | `[]` | 运行可触碰的主机；为空表示只有排除项生效 |
| `excludedTargets` | `[]` | 即使已授权也拒绝的主机 |
| `allowedSchemes` | `['http', 'https', 'ws', 'wss']` | 绝对形式请求可使用的 scheme |
| `resolveAddresses` | `true` | 每个主机名解析一次；解析结果触及被排除 IP 字面量或解析失败即拒绝 |
| `host` | `127.0.0.1` | 监听绑定地址 |
| `port` | `0` | 监听端口；`0` 自动选择空闲端口 |

无法解析的范围条目或空的 `allowedSchemes` 在插件加载时抛错。以编程方式挂载时，读取 `ctx.scopeProxy.url` 前先 `await ctx.scopeProxy.whenReady()`；Loader 路径在 `apply` 返回后才完成插件 fiber，因此用下方事实组装运行环境。

<a id="model-experience"></a>
## 模型体验

### 范围转发代理

#### 模型看到什么

代理本身对模型不可见；模型只能在受管事实中看到 `DSH_SCOPE_PROXY`，以及其 HTTP 客户端打印的拒绝文本。被拒绝的连接返回 `403`，正文为 `denied by scope proxy: '<target>' <规则短语>`（CONNECT 客户端可能只看到状态码）；放行的连接在钉扎 socket 上原样转发。

#### Token 影响

零 token。代理过滤网络连接，不改变任何模型请求。

#### KV Cache 影响

无。代理不注册任何提示词段落，也不触碰会话历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>
- **只覆盖代理感知的客户端** —— 遵守 `HTTP_PROXY` 的工具（curl、PowerShell web cmdlet、多数 HTTP 库）被强制执行；忽略代理变量而直连的工具绕过本插件。关闭它需要进程级网络隔离（沙箱接缝）；在此之前保持挂载 `scope-policy` 守卫作为逐调用第二意见。
- **首地址钉扎** —— 连接钉扎到第一个已验证答案；多地址主机每条连接使用其中一个地址，这是普通客户端行为，不削弱范围（每个地址都已验证）。
- **UDP 与非 HTTP 协议不在范围内** —— 代理只讲 HTTP 代理形式；经解析器自身的 DNS 外泄不在此判定。

### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
