---
kind: upgrade-guide
description: "启用 routeAllModels 后，SB 不可用时模型请求会失败，不再回退到直连传输。"
---

# 必须经 SB 的模型路由

[English](guide.md) | 中文

## 变更

`proxy-servers.routeAllModels: true` 要求主 agent 和本地子 agent 的模型调用经过 SB CONNECT。SB 不可用、被禁用或不健康时，在分派给提供方之前返回 `proxy-server/start-failed`。较早版本可能在启动或就绪探测失败后直连分派。已经分派的请求绝不通过直连重放。

## 迁移

1. 在生效的 `proxy-servers` patch 中保留 `routeAllModels: true`，以要求 SB。确认运行账号的 `PATH` 包含 Bun、SB 使用开关已启用且配置的端口可用。已有 home patch 优先于 profile 设置。
2. 在生效的 `subagent` patch 中设置 `localAgentPolicy: parent`，以要求本地子级采用主 agent 的 preset 和提供方/模型。采用此模式时移除冲突的固定 `localAgentPolicy` 对象。恢复及父方选择语义见[子级 preset](../../../../packages/subagent/subagent/README.zh.md#child-presets)。
3. 安装更新代码后重启 Web/TUI。用所选模型发送一条短请求，再委派一个本地任务，确认两者记录的请求头使用预期提供方/模型及 preset。
4. 在 Proxy Server 设置中禁用 SB，再发送一条短请求。请求必须失败且不触达提供方。继续前重新启用 SB。VPN 强制策略独立生效；本策略不约束工具启动的任意程序。
