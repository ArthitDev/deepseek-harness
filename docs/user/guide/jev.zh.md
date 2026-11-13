# 使用 Jev 审查证据

[English](jev.md) | 中文

## 概述

Jev 可以通过现有的 [MCP 客户端](../../../packages/mcp/mcp-client/README.zh.md)对侦察观察结果分类和排序、依据证据核对声明，并审查拟议变更。它是可选的第三方服务：Harness 随附配置不安装或启用它。调用会将提供的文本发送给所配置的提供方，并消耗该账户的配额。

## 目录

- [配置 Linux 宿主机](#configure-a-linux-host)
- [选择何时调用 Jev](#choose-when-to-call-jev)
- [验证与恢复](#verify-and-recover)

<a id="configure-a-linux-host"></a>
## 配置 Linux 宿主机

Linux 参考部署使用 `@jkudish/jev-mcp@0.14.7`，预先安装在 `/opt/dsh-jev/0.14.7` 下，安装时禁用 npm 生命周期脚本。该外部包要求 Node 22 或更新版本；经测试的 Harness 部署使用 Node 26.13.0。提供方配置与工具 schema 以其[上游文档](https://github.com/jkudish/jev-mcp)为准。安装不代表 DeepSeek 的认可或持续支持承诺。

1. 启用 MCP 配置项前先安装固定版本的包。运行时和启动脚本应由管理员拥有，并允许 Harness 服务账户读取。不要在每次启动时下载包。
2. 为每个运行 Harness 的账户将现有 TypeSafe 凭据配置到 `$HOME/.config/typesafe/key`。使用服务实际的 `HOME`，它可能与终端用户的主目录不同。凭据目录权限应为 `0700`，密钥权限应为 `0600`，所有者均为该账户。不要将凭据放入 Git、YAML、命令参数或日志。
3. 将以下启动脚本保存为 `/opt/dsh-jev/launcher.mjs`。MCP 桥接器移除名称类似凭据的环境变量后，脚本才加载凭据。密钥缺失、为空或含空白字符时，子进程输出固定诊断并退出。

```js
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

try {
  const key = readFileSync(path.join(homedir(), '.config/typesafe/key'), 'utf8').trim()
  if (!key || /\s/.test(key)) throw new Error('invalid credential')
  process.env.TYPESAFE_API_KEY = key
  process.env.JEV_PROVIDER = 'typesafe'
  process.env.JEV_FILE_ROOTS = 'off'
  process.env.JEV_MCP_TRANSPORT = 'stdio'
} catch {
  console.error('[jev-mcp] missing or invalid TypeSafe credential in service home')
  process.exit(1)
}

await import('file:///opt/dsh-jev/0.14.7/node_modules/@jkudish/jev-mcp/dist/index.js')
```

4. 备份现有配置，然后将此配置项合并到 `$DSH_HOME/cordis.patch.yml`，供 Web、TUI 和无头配置共享。若已有 `mcp-jev` 行，应替换它而非重复添加；移除该行中的 Windows 专用 `disabled` 表达式及 Windows 可执行文件路径。保留其他补丁。

```yaml
- insert:
    - id: mcp-jev
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: jev
        transport: stdio
        command: !!js process.execPath
        args:
          - /opt/dsh-jev/launcher.mjs
        startupTimeoutMs: 15000
        toolCallTimeoutMs: 60000
        closeTimeoutMs: 5000
        failOnStartupError: false
```

桥接器启动本地 stdio 子进程；此配置不添加 HTTP 监听器。若 Web 服务和交互式 TUI 使用不同主目录，两者各自需要配置和凭据。等待活动轮次及任务结束后，重新加载配置或重启 Harness。验证成功前保留备份；激活失败时恢复备份并重新加载。

<a id="choose-when-to-call-jev"></a>
## 选择何时调用 Jev

固定版本的服务器以 `mcp__jev__jev_*` 名称提供十二个语义工具。参数以公布的 schema 为准；这些工具判断所提供的文本，不执行扫描或控制浏览器。

| 任务 | 工具 |
|---|---|
| 对侦察观察结果分组并确定优先级 | `jev_classify`, `jev_rerank`, `jev_find` |
| 根据证据核对发现并比较文本段落 | `jev_verify`, `jev_compare` |
| 筛查不可信文本并验证提取字段 | `jev_screen`, `jev_extract`, `jev_audit` |
| 判断范围明确的命题或基于证据的选择 | `jev_noul`, `jev_decide` |
| 审查补丁及其完成声明 | `jev_review`, `jev_gate` |

按以下顺序使用：确定性侦察、批量分类或排序、直接调查，最后在报告前依据证据核验。保留来源标识符，只发送必要且已获授权的摘录。缺乏支持、相互矛盾、格式错误或低置信度的判断需要进一步检查。语义判断不能确定漏洞可利用性，也不能证明某条命令实际运行过。

若希望模型自动选择工具，请将此用法说明加入部署的模型指令。参考部署通过现有的已记录钩子注入私有 `ACTION-POLICY.md`；本仓库不随附这些文件。仅安装 MCP 服务器不会安装该钩子，也不会强制模型调用工具。在调查与报告节点批量调用，而非每次请求或轮询时都调用。目标范围、授权和 VPN 流量检查仍使用确定性机制。用户明确要求停止使用 Jev 时，也应停止使用其 MCP 工具；模型指令是行为指导，并非强制执行的工具访问开关。

Jev 语义工具与 Jev 浏览器或原生自动化路由彼此独立。此 Linux 设置不安装 Windows 桌面桥接器。继续使用部署中已安装的无头浏览器执行器。

<a id="verify-and-recover"></a>
## 验证与恢复

分别检查工具发现和实际结果。在新的 Web 或 TUI 会话中，要求 agent（智能体）使用以下模拟输入调用一次 `mcp__jev__jev_verify`，并报告实际判定：

```json
{
  "claims": ["TCP port 443 is open.", "TCP port 22 is open."],
  "evidence": "Synthetic test scan: TCP port 443 is open; TCP port 22 is closed."
}
```

检查已记录的工具调用及结果：预期判定为 `verified` 和 `contradicted`。仅凭模型成功回复或列出十二个名称，不能验证推理（inference）成功。Linux 参考部署已通过 Harness 桥接器实际调用全部十二个工具，并通过普通 Web 聊天调用和 TUI 配置检查；未测试交互式 TUI 屏幕或服务器重启。

若启动时报告凭据缺失，请检查服务账户的主目录及权限，不要打印密钥。提供方认证、配额和网络错误需要分别修复。设置 `failOnStartupError: false` 时，Jev 不可用并不妨碍 Harness 继续提供服务；请检查 MCP 诊断和[连接恢复行为](../../../packages/mcp/mcp-client/README.zh.md)。调用失败后不要声称验证已完成。若返回用量则记录它；仅凭 token 数量不能确定实际费用。

## 开发备注

无。
