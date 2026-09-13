# Agent Note: 模型探测携带推理等级

Status: implemented

[English](2026-09-11-model-discovery-reasoning-efforts.md) | 中文

## 问题

自定义 OpenAI 兼容提供方可以列出模型 ID 与容量，但探测链路会丢弃推理能力元数据。因此，即使端点描述了支持的等级，通过探测获取的模型也没有推理等级菜单。

## 决策

`LlmDiscoveredModel` 携带一个可选映射，把 Harness 推理等级 ID 映射到端点使用的值。pi-ai 探测解析器读取 OpenRouter 的 `reasoning.supported_efforts`，也读取 LiteLLM 与 Codex 公布的 `supported_reasoning_efforts` 数组。它接受字符串和对象条目，把 `none` 映射为 `off`，忽略未知等级，并且只有至少一个有效思考等级时才公布推理能力。

LLM 服务在 Remote 边界保留该映射。用户采纳探测结果时，模型页把它存入所选模型已有的 `reasoningEfforts` profile 字段。具有新公布推理元数据的已配置模型会默认选中；采纳时会填入原本缺失的字段，而已存储的每个字段都优先于端点返回值。手动录入的模型与省略该元数据的端点保持提供方默认行为，也不显示推理等级菜单。

## 考虑过的替代方案

**硬编码已知自定义提供方。** 未采用，因为每个新网关或模型别名都会要求发布新 Harness 版本，而且提供方 ID 属于部署配置，不属于产品。

**根据模型名称或通用 `reasoning_effort` 参数标志推断。** 未采用，因为支持该参数并不能说明有效等级，也不能说明关闭推理时使用的拼写。

**在每个模型行中加入推理控件。** 未采用，因为探测可以填写已有 profile 字段，无需扩大常用表单。当端点不公布能力时，仍可手动配置 `settings.yaml`。

## 影响

公布受支持推理等级的提供方无需内置目录条目即可填充 Harness 选择器。省略该信息的提供方行为不变。探测只信任 Harness 已知的等级 ID，因此提供方专用词汇仍需显式配置 `reasoningEfforts` profile 映射。

聚焦的探测、LLM 服务与模型页面测试分别固定了解析、Remote 保留和采纳行为。
