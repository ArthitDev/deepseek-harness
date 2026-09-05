# Agent Note: 从 system prompt 直接创建 preset

Status: implemented

[English](2026-09-06-direct-preset-creation.md) | 中文

## 问题

设置页面要求用户先复制 preset，再编辑其 system prompt。这个流程暴露了实现步骤，而不是“命名 agent 并填写指令”这一常见任务。

## 决策

自定义 preset 分组提供“新建预设”对话框，收集 id、可选显示名与 system prompt。浏览器读取健康的默认 preset，只替换 persona 文本，并把来源 id 与完整组装发送给一次经过认证的 `agentPresets/create` 操作。

Host 复制来源目录，使新 preset 保留工具、skill、资产与元数据。Host 在复制事务内写入替换组装；复制、权限、元数据或组装写入任一步失败都会删除目标目录。id 继续受到路径约束，随附 preset 继续只读。

需要所选 preset 原样副本的用户仍可使用复制。需要修改 system prompt 之外插件或工具的组装仍可使用 Creator mode。

## 考虑过的替代方案

- 创建仅含 persona 的组装：否决，因为生成的 agent 会悄然失去默认 preset 的工具与 skill。
- 让浏览器分别调用 `copy` 与 `write`：否决，因为两者之间断线会留下仍携带来源 prompt 的可见 preset。
- 完全取代复制：否决，因为完整副本与复制的资产仍有用途。

## 后果

创建以 prompt 为主的 preset 只需一个对话框，并产出完整 preset。默认 preset 决定初始能力；需要不同工具集时使用“复制”或 Creator mode。组装文本仍是高权限输入，受既有认证连接与可写根目录检查保护。
