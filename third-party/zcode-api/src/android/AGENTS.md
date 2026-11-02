# src/android/ — loopback 控制协议（Kotlin 对端）

> 维护基线：2026-10-20，工作区基于 e025baa（4.8.2）。Kotlin 侧见 Android-APP/AGENTS.md。

## FILES
| 文件 | 角色 |
|---|---|
| control.ts | `dispatch` 10 命令表 + `createControlDispatcher` 状态机 + `startControlListener` node:http 监听 + `LogBuffer` |
| control.test.ts | 协议回归 |

## 契约
- 双消费者：index.ts `android` 模式起监听（`ZCODE_CONTROL_PORT`）；server/panel.ts **进程内**复用 `createControlDispatcher`（浏览器对 loopback POST `/api/control`——无第二控制端口）。
- 命令面：start/stop/status/logs(since 游标增量)/quota(双平面快照)/login/logout/provider/plan/update——**无 shutdown**（Kotlin ControlClient 不发；面板 shutdown 走自身命令链，先应答再 50ms grace）。
- 错误语义：HTTP 200 带内 `{ok:false, error}`（Kotlin 端不检非 200 状态码）。
- **监听永不绑非回环**：bind 恒 127.0.0.1 + 每请求 remoteAddress 复查（双保险，根 ANTI-PATTERNS）。
- quota 命令直连 routes-quota 双平面；上游 billing 限频——仅手动/进屏触发，永不定时轮询。

## WHERE TO LOOK
| 任务 | 位置 |
|---|---|
| 加/改命令 | control.ts `dispatch` 表 + Android-APP ControlClient.kt **同步改**（跨仓契约） |
| 面板命令接线 | server/panel.ts（token 门控先于 dispatcher） |
| 日志游标 | control.ts `LogBuffer`（环形 + since cursor） |
