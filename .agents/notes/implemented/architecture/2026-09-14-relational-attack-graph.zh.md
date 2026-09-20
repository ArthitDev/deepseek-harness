# Agent Note：关系型 attack graph

状态：已实现

[English](2026-09-14-relational-attack-graph.md) | 中文

## 问题

Task tree 记录了工作，但全新 episode 没有规范表示来保存 asset、service、endpoint、identity、credential、finding 与 evidence 之间发现的关系。

## 决策

在现有 `pentest_run` 关系型 domain 中保存类型化 graph node 与有向 edge。Executor 结果使用 episode-local node reference，并引用 evidence tool-call ID。Manager 在写入前验证完整 graph update、分配确定性 ID、在重复观察时合并规范 evidence，并向每个全新 Supervisor 公开有界 graph 投影。

## 已考虑的替代方案

**现在就引入图数据库。** v0.1 阶段否决：没有测得的 path query 需要它，而第二个存储底座会在查询负载证明必要性之前分裂规范真相。

**让每个 episode 持有私有 graph，完成时合并。** 否决：跨 episode 的关系正是 graph 的意义所在；episode-local ref 应在单次经过验证的 commit 内解析为规范 identity。

**用自由格式端点标签保存 edge。** 否决：按 run、kind、label 做 identity 哈希，才能让重复观察确定地合并到一个 node 或 edge 上，而不是产生影子副本。

## 后果

关系像其他规范记录一样在 Session 丢失与重启后保留，重复观察会把 evidence ID 累积到同一个 node 或 edge 上，而不是创建影子副本。投影对 Supervisor 保持有界，未解析的 edge 端点会在写入任何 episode child 之前被拒绝。

## 验证

聚焦测试覆盖 graph 结果 schema、规范提交、确定性 node 与 edge 去重、evidence 合并、SQLite 重启、Supervisor 可见性，以及拒绝未解析 edge 时不留下 partial episode write。

## 延后

当前不引入 graph database。只有在测得 path query 无法由有界关系型投影支持时才增加。
