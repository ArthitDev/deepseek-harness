---
description: "内嵌模型代理的操作控制与进程生命周期管理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-proxy-server

[English](README.md) | 中文

## 概述

查看并控制 ZCode Direct、Antigravity 和 SB transport，读取状态不会启动进程。保存独立的使用偏好，在匹配请求到来时启动已启用的代理，并仅停止此 Host 拥有的子进程。禁用会阻止新的匹配请求，现有流仍可完成。三个代理都需要 Bun；Harness Host 仍使用 Node.js。

## 目录

- [使用此包](#use-this-package)
- [配置](#configuration)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

`proxyServers` 服务列出 ZCode Direct、Antigravity 和 SB transport。读取状态仅探测其回环端点，不启动进程。`setEnabled` 先持久化一个使用偏好，再启动或停止对应代理。启动失败保留已保存的偏好并返回错误，不报告为运行中。禁用会阻止通过已配置路由发送新请求，不取消进行中的请求。

服务仅通过自身持有的进程句柄停止自己启动的子进程。外部监听进程在禁用后仍继续运行。禁用会等待进行中的下游流结束再停止子进程；保存偏好不必等待这些流结束。每个代理的操作串行执行；Host 销毁会停止并等待受管子进程。打开设置页不启动代理。三个使用偏好默认启用以保持现有路由行为；匹配的模型请求或显式打开开关才启动代理。Liveshare 读者不能读取或控制此 Host 级服务。

<a id="configuration"></a>
## 配置

可动态更新的 `zcodeEnabled`、`antigravityEnabled` 和 `sbEnabled` 字段分别保存独立偏好。端口默认取 `ZCODE_PORT` 或 18080、`ANTIGRAVITY_PORT` 或 18877、`SB_PORT` 或 18899。`startupTimeoutMs` 默认 15000。提供方列表分别默认为 `zcode-direct`、`antigravity`、`sb`/`sb-proxy`。模型前缀 `zcode/`、`antigravity/` 和 `sb/` 也会选择对应代理。其他模型路由保持委托行为。

ZCode 需要 Bun、已构建的 worker bundle，以及 `ZCODE_DIR` 或 `third-party/zcode-api` 中已有的 `config.yaml`。三个代理都要求 `PATH` 中存在 Bun；Antigravity 和 SB 通过 `bun --no-env-file` 运行内置 JavaScript，保留 Host 传入的环境，不额外加载 `.env` 文件。Harness Host 仍使用 Node.js。服务不创建凭据，不执行登录、OAuth 设置或上游模型请求。设置失败和缺失的本地配置会报告给操作者。

<a id="further-exploration"></a>
## 进一步探索

- [代理设置 UI](../../client/ui-proxy-server/README.zh.md)：操作开关与进程状态。
- [服务实现](src/index.ts)：请求路由与子进程生命周期。
- [生命周期测试](tests/proxy-server.spec.ts)：启动失败、流结束等待与进程归属。

<a id="model-experience"></a>
## 模型体验

### 代理路由

#### 模型看到什么

`proxyServers` 服务不添加工具、提示词或模型可见上下文。其 `llm/stream` 监听器在分发前启动匹配且启用的代理，并原样委托请求；禁用或启动失败时返回终止模型请求的错误。

#### Token 影响

服务不增加提示词、工具 schema 或消息 token。状态探测不发送上游模型请求，也不产生计费模型调用。

#### KV Cache 影响

服务不改写模型请求前缀，也不添加缓存内容。上游缓存行为取决于所选提供方和代理；此服务不保证代理重启后仍保留缓存。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 通过配置的提供方 id 和模型前缀识别路由，不检查任意提供方的 base URL。
- ZCode 仅对由此 Host 启动的子进程使用 `/v1/models` 返回 HTTP 200/401 判断就绪。由于此检出目录没有 ZCode 的唯一健康端点，非本 Host 拥有的 ZCode 监听进程显示为 `port-in-use`，既不复用也不停止。
- 代理配置和认证必须已存在。此页面不能安装缺失的 ZCode 源码。
- 通用插件配置修改会影响后续请求路由；需要立即停止受管进程时使用 `setEnabled`。
- 受管启动路径相对于检出目录；打包安装需要在安装根目录提供代理脚本。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
