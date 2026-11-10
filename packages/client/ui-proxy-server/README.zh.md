---
description: "用于查看内嵌模型代理状态及使用偏好的设置页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-proxy-server

[English](README.md) | 中文

## 概述

在设置中检查内嵌代理的端点、本地配置可用性和进程状态。启用代理会启动它，禁用则阻止新的匹配请求使用它。禁用仅停止此 Host 拥有的子进程；外部进程继续运行。启动失败会保留已保存的偏好并显示错误。

## 目录

- [使用此包](#use-this-package)
- [组合](#composition)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

**Settings > Proxy Server** 显示内嵌代理列表、回环端点、配置的路由、本地配置可用性和进程状态。每个共享 Switch 通过 [Host 服务](../../llm/proxy-server/README.zh.md) 保存独立使用偏好。打开开关会显式启动代理；关闭则阻止新的匹配请求，并且仅停止此 Host 拥有的子进程。外部进程继续运行。

读取页面不启动代理。刷新会重新读取进程状态。写入期间禁用其他操作；失败会保留可见错误及已保存的偏好。因此，启动失败时可能显示已启用的开关和已停止的进程。设置不可用或只读时禁用开关。

<a id="composition"></a>
## 组合

<details>
<summary>客户端集成详情</summary>

此插件需要 `proxyServers`、配置表单、语言、资源及 Settings section slot。列表通过共享的 `proxy-servers` 资源协议和生成的 Remote 方法加载。提供英文和简体中文文案；其他受支持语言使用英文。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [Host 服务](../../llm/proxy-server/README.zh.md)：使用偏好与进程归属。
- [客户端集成](src/client/index.ts)：设置页注册与 Remote 调用。
- [Host 实现](../../llm/proxy-server/src/index.ts)：路由匹配与代理启动。

<a id="model-experience"></a>
## 模型体验

### 代理偏好

#### 模型看到什么

此 UI 不添加工具、提示词或模型可见上下文。显式操作调用 `proxyServers`，修改 Host 的代理使用偏好和进程生命周期。

#### Token 影响

读取状态和修改偏好不增加模型输入 token。此 UI 不调用上游模型。

#### KV Cache 影响

此 UI 不添加缓存内容，也不改写模型请求前缀。后续模型请求的缓存行为由其提供方和代理决定。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 进程状态在刷新、切换开关或重新打开页面后更新；页面不轮询。
- 安装、代理配置和认证不属于此页面的功能。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
