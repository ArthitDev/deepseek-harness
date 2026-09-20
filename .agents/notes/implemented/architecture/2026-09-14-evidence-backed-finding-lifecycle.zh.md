# Agent Note：基于 evidence 的 finding 生命周期

状态：已实现

[English](2026-09-14-evidence-backed-finding-lifecycle.md) | 中文

## 问题

规范 schema 有 findings 表，但没有经过验证的写入路径。Executor 输出无法跨全新 Session 创建、去重或推进 finding。

## 决策

为 `pentest_submit_result` 增加类型化 finding update。每个 update 引用同一结果中的 evidence tool-call ID。新 finding 根据 run、target 和规范化 title 获得确定性 ID。现有 finding 遵循受检生命周期 transition。任务可以携带 basis finding ID；租用引用 suspected 或 inconclusive finding 的任务时，会在执行前把它标记为 validating。

Manager 在写入 episode child record 前验证所有 finding update。Verified finding 必须保留规范 evidence。有界 Supervisor 视图包含近期 finding record。

## 已考虑的替代方案

**让模型以散文复述 finding，并在提交时做差异比对。** 否决：自由文本比较使去重变成概率性的，而且模型可以不指向观察到的 evidence 就声称回归或验证。

**用向量 embedding 相似度做去重。** 否决：规范 identity 必须保持确定且可解释；按 run、target、规范化 title 做哈希是可复现的，语义相似度属于可选检索层，不属于状态存储。

**让 Executor 直接访问 finding 表。** 否决：生命周期 transition 属于工作流权威；run manager 必须检查每一次 transition，防止全新 episode 跳过 validating 或复活已报告的 finding。

## 后果

finding 跨 Session 丢失保留 evidence 合并后的 identity，每个 verified claim 都能追溯到规范 evidence ID。无效 transition 和没有证据支撑的 verified 会在写入任何 episode child 之前被拒绝。一次以 commit 之外方式结束的 lease 现在会把被占用的 basis finding 释放回 suspected，没有任何 finding 会因为一次从未发声的尝试而停留在 validating。

## 验证

聚焦测试覆盖类型化工具输出、controller commit、suspected 到 validating 再到 verified 的 transition、evidence 合并、确定性去重，以及拒绝无效更新时不留下 partial episode 或 evidence record。

## 延后

工具 trace 保留 hash 与规范 reference，但不保留原始结果正文。Raw artifact retention 需要有界且由 host 管理的 facility。
