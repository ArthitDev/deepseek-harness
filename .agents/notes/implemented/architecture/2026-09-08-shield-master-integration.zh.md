# Agent Note: Shield Break Agent upstream integration

Status: implemented

[English](2026-09-08-shield-master-integration.md) | 中文

## 问题

Shield Break Agent 增加预设编写、Session 永久删除、主题控件、Tailnet 设置访问、插件启停和有界输出续写。上游更改文件 Sidebar、Inbox API、Assistant 流和持久化 Session 世代。整文件选择任一方会丢弃功能或恢复不兼容的 API。

## 决策

Persona 配置仅在缺少 `prefix` 时接受旧字段 `text`。编辑器写入 `prefix`，同时保留后缀与能力。输出续写及技能加载快照工作区有独立项目标记，避免祖先目录的指令和技能进入日志。

保留 fork 的用户功能并适配上游 API。Session 行同时传递删除与搜索定位回调。预设编辑在上游标签旁保留编辑按钮。插件开关和实时状态使用更新后的基础控件。输出续写读取紧凑 Assistant 记录并检查两个待处理 Inbox 列表。永久删除使用与写打开相同的跨进程 writer lease，并移除所选 Session 的全部世代。

## 考虑过的替代方案

**所有冲突文件都优先选 ours。** 不采用，因为旧持久化和流假设与新包组合后会编译失败或行为错误。

**以上游替换 fork。** 不采用，因为这会移除用户要求的定制和编写控件。

## 后果

Windows 验证覆盖构建、真实浏览器中的预设编写、设置和工作区流程、持久化互斥及输出上限重放。skill-load 正文刷新后匹配；共享 Bash 请求头仍与 Windows PowerShell 工具目录不同，声明跨平台快照覆盖前仍需 POSIX 重放。

合并源码不会迁移用户的 Harness home。测试使用临时存储；部署时，在新运行时首次写入前需要单独备份配置与历史。合并前源码保留在 `backup/shield-break-agent-before-master-20260908`。上游归档记录保留封存内容，fork 新增能力由当前功能记录说明。
