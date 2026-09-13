---
description: "在 Web 中选择 Agent preset 和新任务默认值，并查看各模式的说明。创建与修改引导至创造模式。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-preset

[English](README.md) | 中文

## 概述

在 Web 中选择 Agent preset 和新任务默认值，并查看各模式的说明。创建与修改引导至创造模式。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

设置页显示内置与自定义卡片分组、默认项高亮和点击卡片选择；没有 preset 的分组不显示，但自定义分组会保留其创造入口。本页不编辑任何内容：该入口启动一个创造模式任务，以 bundle 形式创建或覆盖 preset；当 `cordis` preset 在列表中且存在会话流程时提供。

「新任务可选择模式」开关控制保存的用户默认值是否生效。关闭时使用部署默认值，重新开启则恢复用户偏好。选择健康定义作为默认值也会同步当前新任务页面的空白会话。Creator 入口开启一个使用 `cordis` preset 的新任务。新会话选择器还要求通用设置开启开发者工具。

设置分区把名单呈现为卡片：复制对话框创建 preset，随后在原生文本区域编辑该自定义 preset 的 `agent.cordis.yml`；每张自定义卡片仍保留一个位置动作，用于打开元数据、skill 与资产。保存只发送 preset id 与文本，失败时保留草稿，并只影响后续会话，不改变已经组装的会话。默认值可在任一表面设置；删除会移除 preset 目录，而已据其组装的会话继续运行。随附 preset 在只读查看器中打开，不提供编辑、位置或删除。名单行携带 `broken` 时渲染为标记卡片，其主体与复制均被禁用，因为损坏 preset 的副本只是另一个损坏 preset；损坏的自定义行保留位置与删除动作，以便修复文件、清掉幽灵目录。卡片正面仍显示 preset 自己的描述——在选择器里，一个包说明符不足以让人采取行动——宿主给出的原因作为提示条挂在徽标上，另有一个视觉隐藏的 alert 把它送达辅助技术，而被禁用的卡片主体做不到这一点。

「模型绑定」列表把 Host 当前的模型目录与 preset 名单合并。每个模型都可选择一个健康 preset 或「默认 preset」；选择「默认 preset」会移除该路由的覆盖值。绑定更改适用于新会话，也适用于选择该模型的空白会话；已经开始的会话保留当前 preset。

### 对话式入口

名单携带自指的 `cordis` preset 时，一张虚线添加卡会暂存它并开启新会话——分区关闭设置面板，新建会话 chip 自己的应用器负责组装工作区流程产出的空白会话。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`agentPresets/list` 提供列表和选择器策略；默认值与可见性的修改写入 `agent-presets` settings 命名空间。选择器、空白会话同步和只读会话标签使用记录的 preset 标识。连接重置和设置更新会刷新列表。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Scope](../../core/scope/README.zh.md) — 注册隔离。
- [Agent](../../core/agent/README.zh.md) — 会话运行时。
- [Cordis](../../../docs/cordis-primer.zh.md) — 插件配置与生命周期。

<a id="model-experience"></a>
## 模型体验

通过选定的 preset 间接影响模型，其插件拥有模型可见能力。

#### KV Cache effect

选择变更只影响之后的任务，已有插件与提示词保持不变。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- Web 不创建也不编辑 preset：通过创造模式安装的 bundle 声明新 preset，或按行 id 覆盖内置 preset，覆盖会替换整个子插件列表。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

**运行时不变量：** 不发布 companion；状态由 Host 注册表拥有，客户端展示与选择行为由组件测试验证。
