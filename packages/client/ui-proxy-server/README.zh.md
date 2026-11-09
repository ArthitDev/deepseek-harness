---
description: "用于查看内嵌模型代理状态及使用偏好的设置页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-proxy-server

[English](README.md) | 中文

## 使用此包

**Settings > Proxy Server** 显示内嵌代理列表、回环端点、配置的路由、本地配置可用性和进程状态。每个共享 Switch 通过 [Host 服务](../../llm/proxy-server/README.zh.md) 保存独立使用偏好。打开开关会显式启动代理；关闭则阻止新的匹配请求，并且仅停止此 Host 拥有的子进程。外部进程继续运行。

读取页面不启动代理。刷新会重新读取进程状态。写入期间禁用其他操作；失败会保留可见错误及已保存的偏好。因此，启动失败时可能显示已启用的开关和已停止的进程。设置不可用或只读时禁用开关。

## 组合

此插件需要 `proxyServers`、配置表单、语言、资源及 Settings section slot。列表通过共享的 `proxy-servers` 资源协议和生成的 Remote 方法加载。提供英文和简体中文文案；其他受支持语言使用英文。

## 模型体验

此 UI 不添加工具、提示词、token 或 KV-cache 内容。显式操作会修改 Host 的代理使用偏好和进程生命周期，不调用上游模型。

## 已知限制与后续工作

- 进程状态在刷新、切换开关或重新打开页面后更新；页面不轮询。
- 安装、代理配置和认证不属于此页面的功能。
