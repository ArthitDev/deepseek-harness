# Agent Note: 在空 Session 中先选择机器再选择 Workspace

Status: implemented

[English](2026-09-13-machine-first-workspace-picker.md) | 中文

## Problem

空 Session 的 Workspace 选择器把本地与远程 Workspace 放在同一列表，并用通用文案标记本地组。删除当前 Session 后，选择器会跳过执行机器选择，还可能显示 `This computer` 而不是 Host 主机名。

New Session 与 Workspace 的 `+` 也共用会复用已有空白 Session 的连接流程，因此点击后可能仍停留在同一个 Session。ui-workspace 插件还调用了 `ctx.layout`，却没有在 inject 列表声明 `layout`。Cordis 会在 `sessions.create` 之前拒绝访问，所以两个按钮都不会发出请求。

## Decision

空 Session 选择器把本地 Host 和每台已保存远程机器显示为父菜单项。打开父项后只显示该机器的 Workspace；本地父项还包含已组合的添加 Workspace 操作。本地项优先使用 Host 主机名，侧边栏原有的分组浏览器保持不变。

New Session 和每个 Workspace 的 `+` 直接调用 `sessions.create({ workspaceId })`，因此即使 Workspace 已有可复用空白 Session，每次操作仍会创建新的 Session。普通 Workspace 选择继续复用空白 Session。导航取消机制会阻止较慢的旧创建结果覆盖后续选择。

ui-workspace 插件现在把 `layout` 声明为运行时依赖。apply 测试通过真实 Cordis 插件上下文调用共享 New Session 操作，因此删除该声明时，测试会在与浏览器故障相同的边界失败。

## Alternatives considered

**保留平铺列表并添加标题。** 不采用，因为标题没有明确要求选择执行机器，而且会遗漏尚无 Workspace 的已保存机器。

**在 Workspace 选择器旁再创建一个机器选择器。** 不采用，因为两个控件可能表达冲突目标，也会重复 Menu primitive 已支持的层级。

**让 New Session 继续复用空白 Session。** 不采用，因为这违背按钮名称和用户预期，也会让两个独立操作落到同一 Session identity。

## Consequences

从空 Session 开始时，必须先选机器再选 Workspace。没有 Workspace 的已保存机器仍可见但不可用；创建远程 Workspace 继续通过负责 SSH 信任和认证的远程机器连接控件完成。连续点击 New Session 会按设计创建多个空白 Session，但只有最后一个未被后续导航取代的结果会打开。
