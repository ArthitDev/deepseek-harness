# 在 Kali WSL 中运行攻击工具链

[English](kali-wsl.md) | 中文

这两份**默认关闭的参考配置**把 agent 的执行世界一分为二：Windows 宿主 shell 继续负责检出中的 node、pnpm 与 git，而 `kali-linux` WSL 发行版承载 Linux 攻击工具链（nmap、sqlmap、hydra、john、hashcat、impacket 等全套 Kali 软件包）。第一份配置接通交互式 shell；第二份添加逆向工程 MCP 桥。

## DSH 做什么

`kali-wsl` 覆盖层注册第二个本地 PTY 后端，启动 `wsl.exe -d kali-linux`，并把它暴露给 TUI 的 `/shell kali` 命令与 Web 终端选择器。共享 shell 是一个 owner 作用域的会话（`shared-kali`）：操作者在覆盖层或浏览器面板中输入，同时模型的 `terminal_open`/`terminal_send`/`terminal_read`/`terminal_list` 工具寻址同一会话，因此状态、工作目录与环境变量对双方一致。DSH 不安装发行版、软件包或 `wsl.exe`，也不翻译命令——在部署策略（见下）的辅助下，由模型负责经 WSL 路由。

## 前置条件

| 组件 | 要求 |
|---|---|
| WSL 发行版 | 已安装并可启动的 `kali-linux`（任何发行版名都可以——自行调整行内名称） |
| Kali 软件包 | 任务所需工具集；`wsl -d kali-linux -- bash -lc 'apt update && apt install -y …'` 可按需安装 |
| Kali 中的 Python | 供需要联网的 skill 脚本使用的 `python3-requests`（`apt install -y python3-requests`） |
| Web 终端 | `terminal-controller`（已在 web bundle 中）从覆盖层读取额外候选 |

## 启用

```sh
dsh web --patch "$PWD/apps/cli/config/examples/kali-wsl/cordis.patch.yml"
dsh tui --patch "$PWD/apps/cli/config/examples/kali-wsl/cordis.patch.yml"
```

要在多次运行间保留选择，把行合并进 `$DSH_HOME/cordis.patch.yml`（所有 profile）或该 profile 自己的 patch。`terminal-controller` 条目会整体替换该行的 `shellCandidates` 列表——请重列你想保留的默认项。

## 让模型把命令路由进 Kali

没有策略时模型只能猜测工具链在哪里。一个小的 home 插件在每个回合注入一条持久策略消息：

1. 把以下内容保存为 `$DSH_HOME/kali-exec.mjs`（按你的机器调整发行版名与工作区挂载）：

```javascript
import { createUserMessage } from 'file:///<absolute-path-to-this-checkout>/packages/llm/llm/lib/index.js'

export const name = 'kali-exec-policy'
export const inject = ['agents']
export const policyName = 'kali-exec-policy'

const policyText = `Kali Linux execution policy.

The offensive-security toolchain lives in the kali-linux WSL distro, NOT in the
Windows shell. Run it through:

  wsl -d kali-linux -- bash -lc '<command>'

Single-quote the whole Kali command; use double quotes inside. The Kali shell
runs as root already. Windows drives mount under /mnt (E:\\x -> /mnt/e/x). Keep
pure Windows work in the normal shell. A missing tool is installed inside Kali
with apt, not substituted from Windows.`

export function apply(ctx) {
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const message = createUserMessage({
      content: [{ type: 'text', text: 'Deployment execution policy.\n\n' + policyText }],
      source: { kind: 'skill-invocation', name: policyName, form: 'instructions' },
    })
    return { ...decision, messages: [...decision.messages, message] }
  })
}
export default { name, inject, apply }
```

2. 在 `$DSH_HOME/cordis.patch.yml` 注册一次：

```yaml
- insert:
    - id: kali-exec-policy
      name: 'file:///C:/Users/<you>/.dsh/kali-exec.mjs'
```

`file://` 导入必须指向本检出的 `packages/llm/llm/lib/index.js` 构建产物；移动检出后请重新构建。上面的最小版本每回合都会重发策略；提取本示例的部署额外做了相邻重复副本的去重，并遵循提示词抑制开关。

## 验证

```sh
dsh tui --dump-config
```

输出必须包含 `terminal-kali` 行；Web 侧则是 `kali` shell 候选。TUI 中 `/shell kali` 打开发行版 shell，`/exec` 列出带 `KALI` 或 `WIN` 标记的已执行命令。Web 中新建终端的选择器会列出 `kali`。

## 逆向工程 MCP 桥

[`reverse-mcp/cordis.patch.yml`](../../../apps/cli/config/examples/reverse-mcp/cordis.patch.yml) 添加 IDA Pro（Streamable HTTP `127.0.0.1:13337`，由 `ida-pro-mcp` 插件在 IDA 运行时托管）与 x64dbg（FastMCP stdio 桥，代理插件在 8888 端口的 HTTP 服务器）。宿主应用未运行时桥处于离线状态；`failOnStartupError: false` 保证 profile 在没有它们时照常启动，工具逐次调用失败。这些第三方配置仅作为互操作示例提供；其收录不构成背书或持续支持承诺。
