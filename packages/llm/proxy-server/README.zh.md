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
- [设置和使用内置代理](#set-up-and-use-the-bundled-proxies)
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

可动态更新的 `zcodeEnabled`、`antigravityEnabled` 和 `sbEnabled` 字段分别保存独立偏好。端口默认取 `ZCODE_PORT` 或 18080、`ANTIGRAVITY_PORT` 或 18877、`SB_PORT` 或 18899。`startupTimeoutMs` 默认 15000。提供方列表分别默认为 `zcode-direct`/`zcode-glm`、`antigravity`、`sb`/`sb-proxy`。两个 ZCode 路由在分发前启动本地后端，包括通过 9router 的 Starter。只有配置的提供方 id 会选择代理；其他路由器提供方上的 `zcode/` 等模型前缀不会选择本地辅助代理。其他模型路由保持委托行为。

`externalProxies` 默认为空列表。由 Docker Compose 等其他服务管理器负责的代理可列为 `zcode`、`antigravity` 或 `sb`。Harness 在 `startupTimeoutMs` 内等待验证就绪状态并显示 `external`，不会启动或停止它们；使用开关仍会阻止新的匹配模型请求。外部服务不可用时返回启动失败，不回退到本地进程。外部 ZCode 必须在 `/v1/models` 响应中返回 `x-dsh-proxy-service: zcode-proxy`；通用 HTTP 200/401 不足以确认身份。外部服务不要求本地代理源码。

对于由 Harness 管理的代理，ZCode 需要 Bun、已构建的 worker bundle，以及 `ZCODE_DIR` 或 `third-party/zcode-api` 中已有的 `config.yaml`。三个代理都要求 `PATH` 中存在 Bun；Antigravity 和 SB 通过 `bun --no-env-file` 运行内置 JavaScript，保留 Host 传入的环境，不额外加载 `.env` 文件。Harness Host 仍使用 Node.js。服务不创建凭据，不执行登录、OAuth 设置或上游模型请求。设置失败和缺失的本地配置会报告给操作者。

<a id="set-up-and-use-the-bundled-proxies"></a>
## 设置和使用内置代理

这些步骤适用于 Windows 和 Linux 上已安装的源码检出。设置和运行 Web/TUI 时请使用相同的系统账户及 Harness home。服务器服务账户有独立的登录状态；Windows 登录不会使 Linux 登录。运行设置前先安装仓库依赖并构建 Harness。Node.js 必须满足根 `package.json` 的版本要求，运行账户的 `PATH` 中必须有 Bun。

| 后端 | 默认本地端点 | 认证 | 来源 |
|---|---|---|---|
| SB transport | `http://127.0.0.1:18899` | Harness 运行时 CONNECT 密钥 | 本仓库维护 |
| ZCode Direct | `http://127.0.0.1:18080/v1` | ZCode 账户及本地代理 API key | [TriDefender/zcode-api](https://github.com/TriDefender/zcode-api) |
| Antigravity | `http://127.0.0.1:18877/v1` | 内置代理自己的 Google OAuth 登录 | 本仓库维护 |

ZCode Proxy 位于 [`third-party/zcode-api`](../../../third-party/zcode-api)。其[上游记录](../../../third-party/zcode-api/UPSTREAM.json)标明源版本和 Harness 修改；其 [CC-BY-NC-SA-4.0 许可证](../../../third-party/zcode-api/LICENSE)仍然适用。Harness 增加提供方注册、凭据导入、生命周期管理和 SB 路由。内置 ZCode Direct 和 Antigravity 均不需要 9router 或单独安装的 CLIProxyAPI。已有路由器提供方仍是独立选项。

### 准备 ZCode Direct

1. 在 Harness 根目录运行 `pnpm zcode:setup`。它在缺失时安装内置后端声明的依赖、构建 worker，在不存在时创建本地 `third-party/zcode-api/config.yaml`，并将本地代理密钥导入为 `ZCODE_DIRECT_API_KEY`。后端或 Bun 相关更新后再次运行设置；已有账户配置会保留。
2. 在本机以运行账户完成 ZCode 认证。在 `third-party/zcode-api` 目录运行 `bun run src/index.ts auth login zai` 登录 Z.ai，或为相应账户使用 `bigmodel`。账户所有者完成上游登录流程。`bun run src/index.ts --help` 列出登录命令。已有官方 ZCode 登录可以通过上游 `auth login <provider> --import` 流程导入；不要将令牌粘贴到聊天或 README 中。
3. 保持后端 `config.yaml` 中的 `provider`、`plan` 和 `models` 与账户一致。Harness 模板使用 `provider: zai`、`plan: start-plan` 及 `glm-5.3` / `glm-5.3-flash` 模型 id。列出的模型仍需上游账户的配额和访问权限。
4. 设置修改后重启 Harness。在 TUI 中选择 `/model zcode-direct/glm-5.3-flash` 或 `/model zcode-direct/glm-5.3`。在 Web 模型选择器中选择 **zcode(starter-direct)**。发送简短消息验证真实生成。`zcode-glm` 提供方显示为 **zcode(starter-9router)**，通过 9router 使用相同后端；两个路由都在首次使用时启动它。Coding Plan 和 Pay-G 仍是独立的上游 API 路由。

### 准备 Antigravity

1. 在源码根目录运行 `pnpm antigravity:setup`。需要手动浏览器交接时运行 `pnpm antigravity:setup --no-browser`，或用 `--dry-run` 预览而不修改配置。在远程机器上，通过已有 SSH 工作流使浏览器能访问其回环登录端点；设置不会公开服务。
2. 在设置等待窗口内完成 Google 登录。设置仅在需要时启动临时内置代理。登录未完成时，它关闭自己启动的子进程并保留原提供方路由。令牌存在状态不能证明配额有效或刷新成功。
3. 认证后，设置备份并替换 home 和已安装 profile patch 中的 Antigravity 路由，对齐管理器端口，并将 Antigravity 从 `externalProxies` 删除。它保留其他提供方、凭据及独立代理开关，不导入其他应用的 Google 令牌，也不停止其他应用的进程。
4. 重启 Web/TUI，选择 **Antigravity (Google)** 提供方及内置 Google 模型，然后发送简短消息。成功响应可验证当时的上游认证和该模型。此前 CLIProxyAPI 提供的模型，包括 Claude 或 GPT 路由，不会自动成为此后端支持的模型。新增未继承共享 Antigravity 路由的 profile 后再次运行设置。

Google 状态默认位于 `~/.gemini/antigravity-proxy-token.json`。设置不安装系统自启动服务；正常模型请求由 Harness 启动内置子进程，Host 释放会等待其退出。早期设置安装的旧启动项不会自动删除。`--configure-only` 明确跳过登录检查，可能创建尚不能生成的路由；仅在分开准备配置时使用。协议说明见 [Antigravity 设置](../../experimental/pi-tui/README.zh.md#connect-antigravity)。

内置代理在 Google 项目发现和生成请求中发送 `antigravity/hub/2.29.0` 客户端标识，并包含运行时操作系统及架构。Harness 进程环境中的 `ANTIGRAVITY_USER_AGENT` 可覆盖完整请求头。代理不会自动更新此版本；如果 Google 拒绝不受支持的客户端版本，请使用已验证兼容的标识，重启 Harness，然后再次测试生成。

### 启用路由并检查状态

在 Web 中打开 **Settings → Proxy Server**，查看端点、路由提供方 id、使用偏好和进程归属。启用需要的代理。读取页面不会启动进程或登录账户。外部状态变更后刷新或重新打开页面。首次匹配请求前 sidecar 处于停止状态是正常现象；进程运行不等于账户有访问权限。

在生效的 `proxy-servers` 配置中设置 `routeAllModels: true`，使主 agent 和本地子 agent 的模型调用使用 SB。内置路径为 `Harness → SB CONNECT → ZCode Proxy → ZCode` 和 `Harness → SB CONNECT → Antigravity → Google`；其他选中提供方经 SB 保留其目标。提供方 URL 必须与管理器端口对齐。已有 home patch 优先于 profile 值；诊断优先级时在本机查看 `dsh --profile web --dump-config` 或 `dsh --profile tui --dump-config`。输出可能包含私有配置，不要公开。

| 现象 | 检查或恢复 |
|---|---|
| 使用前内置端口停止 | 发送匹配的模型请求，或在 Proxy Server 设置中启用。 |
| Antigravity 仍指向 `8317` | 完成 `pnpm antigravity:setup` 并重启两个客户端；仅 bundle 不会替换已有覆盖。 |
| ZCode 返回 401 | 检查 `config.yaml` 密钥是否匹配 `ZCODE_DIRECT_API_KEY`；本地密钥变更后再次运行 `pnpm zcode:setup`。 |
| Google 登录或生成失败 | 查看 `$DSH_HOME/logs/antigravity-proxy.log`，重新登录后测试一个模型。静态 `/v1/models` 响应不能证明登录成功。 |
| Google 报告 Antigravity 版本不受支持 | 按上述说明更新客户端标识；仅重新登录不会改变请求头。 |
| 代理启动报告端口被占用 | 确认监听进程及其归属，不要停止其他项目的进程。明确声明有意使用的外部后端，或选择空闲且对齐的端口。 |
| SB 不可用 | 启用 `routeAllModels: true` 时，模型请求在分派前被阻止。恢复 SB 后重试；不会直连回退或重放。VPN 强制策略仍独立适用。 |
| 需要撤销迁移 | 停止 Harness，读取打印的备份目录中的 `manifest.json`，将各备份 patch 恢复到列出的 `file`，然后重启。`existed: false` 表示迁移创建的文件。备份包含私有配置，必须保持私密。 |

### 所有模型优先使用代理

CONNECT 要求使用存于 `$DSH_HOME/run/sb-connect.key` 的 256 位运行时凭据，该文件以排他创建方式和仅拥有者可访问的权限生成。主级和子级调用共享此凭据；受管 SB 接收同一 Harness home。它不会进入提供方授权信息或提示词。外部 SB 服务也必须使用该 home。请保密此密钥，轮换后同时重启 Harness 和 SB。

设置 `routeAllModels: true`，可通过 `sbPort` 上的 SB 隧道转发主智能体和本地子智能体的模型流，并保留所选提供方、模型、URL、授权信息和载荷。默认值为 `false`。每次请求前（包括切换模型后），生命周期管理器等待 SB 的 `/health` 标识自身并返回 `supportsConnect: true`。这适用于 Windows 和 Linux 上的受管子进程及外部服务。`startupTimeoutMs` 限制每次启动或就绪等待（含探测）的总时间；`routingProbeTimeoutMs` 限制每次 SB 探测时间，默认为 1000。取消会停止等待，不分发模型请求。

SB 无法启动、被禁用或未通过本地探测时，该次调用在分派前返回 `proxy-server/start-failed`，不会直连回退。VPN 强制执行仍独立生效，且必须允许出站。提供方 HTTP 错误或分发后失败的流绝不会触发直连重放。若 SB 在探测成功后退出，当前尝试失败；下次尝试重新探测。Bedrock 接收单次调用的代理环境，Codex Responses 在路由生效时使用 SSE。其他 fetch 保留原有 dispatcher。外部智能体进程不受本进程模型传输控制；设置 [`subagent.localAgentPolicy: parent`](../../subagent/subagent/README.zh.md#child-presets)，可要求本地子级使用父方的 preset 和模型路由。

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
