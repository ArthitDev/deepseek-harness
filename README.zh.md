# Shield Break Harness

[English](README.md) | 中文

Shield Break Harness 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）面向安全测试的分支 —— 一个构建于 [Cordis](https://github.com/cordiverse/cordis) 之上的"一切皆插件"智能体框架。

**Important:** 本检出为自定义 `shield-break-agent-v2` 分支。运行 Recon 或渗透测试工作流之前，请先阅读 [Shield Break Agent 修改与负责任使用指南](README.SHIELD-BREAK.md)；运行项目本身之前，请阅读[安全须知](SAFETY.zh.md)。

<a id="run"></a>
## 使用界面

| 界面 | 命令 | 说明 |
|---|---|---|
| **Web GUI** | `pnpm dsh web` | `http://127.0.0.1:3080`，完整仪表盘（Runs、Recon、设置、Preset） |
| **TUI** | `pnpm dsh tui` | 全屏终端智能体 —— 命令见下 |
| **桌面版** | `pnpm dev:desktop` | 同一 Web UI 的 Electron 外壳 |
| **Headless** | `pnpm dsh --profile headless "task"` | 单次任务，无界面 |

<a id="run-from-source"></a>
## 构建

```sh
pnpm install            # node ^22.19 || >=24
pnpm run build          # dev profile: lib + web bundles (292 artifacts)
pnpm run build:official # release profile
pnpm run typecheck      # host + client faces
pnpm run test           # unit tests
pnpm run dev:web        # web shell + client-bundle watcher
```

两个 profile 都会重建所有包的 lib；`dsh` 通过 tsx 从源码启动。

## Web

```sh
pnpm dsh web --no-open --trusted-host <host>.ts.net
```

- 服务器绑定 `127.0.0.1:3080`；远程访问经 Tailscale：`tailscale serve --bg http://127.0.0.1:3080`，并配合 `--trusted-host` 声明你的 `*.ts.net` 主机名。打印出的 URL 带一次性 token 门禁。
- `~/.dsh/cordis.patch.yml` 是 **home patch**：其中的行作用于所有 profile（web/tui/headless）—— 共享的 LLM provider、沙箱姿态以及其他部署级覆盖都放这里。

## TUI

```sh
dsh tui                       # default preset
dsh tui --preset              # pick from the roster
dsh tui --machine kali        # run the session on a saved SSH machine
dsh tui --resume              # reopen a persisted session
```

命令：`/new` `/fork` `/resume` `/rename` `/export` `/tree` `/agents` `/jobs` `/sessions` `/model` `/preset` `/thinking` `/providers` `/key` `/provider` `/memory` `/queue` `/rewind`（或 **Esc Esc**）`/clear` `/runs` `/recon` `/machines` `/skills` `/copy` `/retry` `/expand-all` `/hotkeys` —— 以及官方 dsh 命令（`/compact`、`/goal`、`/plan`、`/feedback`）。

粘贴经 bracketed paste 生效（Windows Terminal / conhost 中右键，或 Ctrl+V）。空编辑器上按 **Esc Esc** 可回退到更早的 prompt。

## Provider、模型与机器的映射

**Provider 与模型**来自同一份共享文档 —— home patch（`~/.dsh/cordis.patch.yml`）中的 `llm-pi-ai.providers` 段。所有 profile 与两个界面读取相同的路由和凭据引用：

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      my-provider:
        displayName: My Provider
        apiKeyEnv: MY_PROVIDER_API_KEY   # credential reference, resolved per request
        api: openai-completions          # or openai-responses / anthropic-messages
        baseURL: https://host/v1
        models:
          - id: model-id
            name: Display Name
            contextWindow: 1000000
            maxTokens: 65536
```

Key 本体存放在 `~/.dsh/.credentials.yaml`（TUI 中 `/key <REF>`，或 web 的 Models 页），逐请求解析 —— 绝不存进 profile。

**Preset** 是 `~/.dsh/.agent-presets/` 下的目录（`preset.yml` 提供名称）。TUI 隐藏上游自带名册（其 patch 中 `includeShippedRoot: false`）并默认 `shield-break-agent`；web 选择器保留完整名册。

**机器** 是已保存的 SSH profile（web → Remote machines 设置，存于共享设置文档）。TUI 中 `/machines list|probe|open`，或启动时 `--machine <id>`，会把会话工作目录放进 `/__dsh_ssh__/<machine>/…`，shell 与文件工具随即在该机器上运行。

**Antigravity**（Google 账号的 Gemini/Claude 模型）通过内置本地代理接入 —— 见 TUI 包 README 的 [Connect Antigravity](packages/experimental/pi-tui/README.zh.md#connect-antigravity)。 端点经 `node packages/experimental/pi-tui/tools/antigravity-proxy/install-autostart.mjs` 于登录时自动启动。

## 渗透测试面

Runs 仪表盘（web）与 `/runs` `/recon`（TUI）驱动同一套有界的 Supervisor/Executor 控制面：确定性 recon 工具、带尝试预算的任务租约、N-loop 台账。范围、授权与负责任使用规则见 [README.SHIELD-BREAK.md](README.SHIELD-BREAK.md)。

## 社区与开发

- 上游文档：<https://deepseek-harness.github.io/deepseek-harness/>
- 开发指南：[docs/development.md](docs/development.zh.md)，架构：[docs/architecture.md](docs/architecture.zh.md)，agent 规则：[AGENTS.md](AGENTS.md)
- `pnpm run doc-sync` 把守文档门；`pnpm run test:docs` 运行快速检查。

## 许可

[MIT](LICENSE) —— 第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
