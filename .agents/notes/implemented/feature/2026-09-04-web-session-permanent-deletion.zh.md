# Agent Note: Web 会话永久删除

Status: implemented

[English](2026-09-04-web-session-permanent-deletion.md) | 中文

## 问题

Web Session 菜单可以重命名、fork 或归档对话，却无法永久移除其已存储历史。Archive 有意保留日志与 Workspace 记账，Workspace 删除则只移除项目注册记录。对于希望移除一条可见对话、同时保留项目文件的用户，两者都不满足需求。

破坏性路径还必须尊重 live Agent 所有权。关闭由另一 carrier 持有的 Agent、独立删除 subagent、移除项目 `cwd`，或在写入方活动时删除日志，都会跨越既有所有权边界或损坏数据。

## 决策

可见 Session 行菜单除 Archive 外还提供 **Delete session**。它会打开确认框，明确说明历史不可恢复、运行中任务将停止、项目文件保留。请求进行中时控件保持禁用；失败会保留对话框并显示错误。

`SessionPersistence.delete(id, options?)` 是规范存储原语。JSONL 后端取得与写句柄相同的单写者认领，活动写入方存在时拒绝，只移除配置 root 下编码后 Session 自有目录，id 不存在时返回 `false`，每条退出路径都会释放认领，并允许日后复用该 id。它绝不移除 header 的 `cwd`。

`session.delete` 按 id 串行请求。持久日志或 live Agent 任一存在即可使该身份可删除。`ApiSessionAgentController` 仅在自己保留了完全相同的 `AgentHandle` 时销毁 live Agent；外部所有者与 subagent 身份返回 `session/agent-busy`。因此，由 Web 持有的空白 Session 即使延迟实体化日志尚未落盘，也可以删除。

Agent 销毁后，Host 先调用 `WorkspaceRegistry.forgetSession(id)`，从所有 Workspace 记账与全局归档集合中摘除该 id，再删除持久日志。先清理可以避免 cleanup 失败后，耐久 Workspace 元数据仍指向已删除 id；如果日志删除失败，历史仍可用于重试。成功会发出 `api-session/removed`，发起请求的 Client 也会立即应用同一删除，无需等待自己的 stream 回声。

删除权威只拥有规范 Session 日志与 Workspace 引用。项目文件保留。消息反馈 sidecar 与工具输出 spill 的保留策略由各自后端拥有，因此本操作不宣称对每条派生或辅助记录进行安全擦除；复用 id 时，header 身份匹配会阻止陈旧消息反馈被继承。

## 考虑过的替代方案

**只保留 Archive 这一种 Session 移除手势。** 不予采纳，因为 Archive 的设计目标是保留存储、允许日后恢复，即使当前 UI 还没有取消归档界面；它不满足永久移除历史的需求。

**从 Workspace 删除级联。** 不予采纳，因为 Workspace 注册记录不拥有其 Session 或源码目录。Workspace 删除继续把历史保留在 Ungrouped 下。

**先删日志，再清理 Workspace。** 不予采纳，因为 cleanup 失败会让耐久 membership 或归档状态继续指向不存在的 id，日后复用 id 时还可能继承这些状态。

**销毁任何具有相同 id 的 live Agent。** 不予采纳，因为 ACP、SDK 或另一 carrier 可能持有该 handle。只有保留精确 handle 的 Web controller 才能停止它。

**引入通用事务式 cleanup participant 框架。** 本能力不采用，因为规范日志与 Workspace 元数据无需新抽象即可通过顺序保证安全。只有辅助存储需要协调擦除、不能继续使用现有保留与 reconciliation 策略时，才增加 participant 约定。

## 后果

Session 删除在产品界面不可恢复，但文件系统边界狭窄且不会伤及项目。失败请求可能在重试前让保留的 Session 变为 Ungrouped 或取消归档；Workspace cleanup 失败后不会报告成功。Persistence contract 测试固定幂等、活动写入方排除、取消、目录边界与 id 复用；controller、Client、Workspace 与 UI 测试固定所有权、空白 Session 删除、提交顺序、投影移除、确认交互与文件保留。
