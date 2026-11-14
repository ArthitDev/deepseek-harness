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

可动态更新的 `zcodeEnabled`、`antigravityEnabled` 和 `sbEnabled` 字段分别保存独立偏好。端口默认取 `ZCODE_PORT` 或 18080、`ANTIGRAVITY_PORT` 或 18877、`SB_PORT` 或 18899。`startupTimeoutMs` 默认 15000。提供方列表分别默认为 `zcode-direct`、`antigravity`、`sb`/`sb-proxy`。只有这些配置的提供方 id 会选择代理；路由器提供方上的 `zcode/` 等模型前缀不会选择本地辅助代理。其他模型路由保持委托行为。

`externalProxies` 默认为空列表。由 Docker Compose 等其他服务管理器负责的代理可列为 `zcode`、`antigravity` 或 `sb`。Harness 验证就绪状态并显示 `external`，不会启动或停止它们；使用开关仍会阻止新的匹配模型请求。外部服务不可用时返回启动失败，不回退到本地进程。外部 ZCode 必须在 `/v1/models` 响应中返回 `x-dsh-proxy-service: zcode-proxy`；通用 HTTP 200/401 不足以确认身份。外部服务不要求本地代理源码。

对于由 Harness 管理的代理，ZCode 需要 Bun、已构建的 worker bundle，以及 `ZCODE_DIR` 或 `third-party/zcode-api` 中已有的 `config.yaml`。三个代理都要求 `PATH` 中存在 Bun；Antigravity 和 SB 通过 `bun --no-env-file` 运行内置 JavaScript，保留 Host 传入的环境，不额外加载 `.env` 文件。Harness Host 仍使用 Node.js。服务不创建凭据，不执行登录、OAuth 设置或上游模型请求。设置失败和缺失的本地配置会报告给操作者。

### 所有模型优先使用代理

CONNECT 要求使用存于 `$DSH_HOME/run/sb-connect.key` 的 256 位运行时凭据，该文件以排他创建方式和仅拥有者可访问的权限生成。主级和子级调用共享此凭据；受管 SB 接收同一 Harness home。它不会进入提供方授权信息或提示词。外部 SB 服务也必须使用该 home。请保密此密钥，轮换后同时重启 Harness 和 SB。

设置 `routeAllModels: true`，可通过 `sbPort` 上的 SB 隧道转发主智能体和本地子智能体的模型流，并保留所选提供方、模型、URL、授权信息和载荷。默认值为 `false`。SB 的 `/health` 必须标识自身并返回 `supportsConnect: true`；Harness 通过同一生命周期管理器启动或探测它。`routingProbeTimeoutMs` 限制能力探测时间，默认为 1000。此模式支持 Windows 和 Linux。

SB 无法启动、被禁用或未通过本地探测时，该次调用在现有网络策略下使用原始提供方传输。VPN 强制执行仍独立生效，且必须允许出站。提供方 HTTP 错误或分发后失败的流绝不会触发直连重放。若 SB 在探测成功后退出，当前尝试失败；下次尝试重新探测。Bedrock 接收单次调用的代理环境，Codex Responses 在路由生效时使用 SSE。其他 fetch 保留原有 dispatcher。外部智能体进程不受本进程模型传输控制；可用[子智能体 preset 继承](../../subagent/subagent/README.zh.md#child-presets)要求本地子级。

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

- 当 `routeAllModels: false` 时，通过配置的提供方 id 和模型前缀识别路由，不检查任意提供方的 base URL。
- 未在 `externalProxies` 中明确声明的非本 Host 拥有的 ZCode 监听进程仍显示为 `port-in-use`，既不复用也不停止。集成身份响应头仅标识部署，不授权模型请求，也不证明上游账号配额。
- 代理配置和认证必须已存在。此页面不能安装缺失的 ZCode 源码。
- 通用插件配置修改会影响后续请求路由；需要立即停止受管进程时使用 `setEnabled`。
- 受管启动路径相对于检出目录；打包安装需要在安装根目录提供代理脚本。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
