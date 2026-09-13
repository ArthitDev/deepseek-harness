# Agent Note: 模型路由可以选择 agent preset

Status: implemented

[English](2026-09-11-model-preset-bindings.md) | 中文

## 问题

模型选择与 agent 组装彼此独立，但用户通常把两者作为一种运行模式来选择。为每个新会话重复做出两次选择没有必要，而把组装配置存入 provider 配置会让模型适配器拥有 agent 的工具与提示词。

## 决策

`agent-presets` settings 命名空间在 `models.<provider>.<model>` 下存储可选的 preset id。准确的模型绑定会为新会话选择 preset，也会在空白会话选择该模型时重新组装。创建会话时显式传入的 `agentPreset` 优先；未绑定的路由继承当前默认 preset。

绑定只选择组装配置。provider、model 与 reasoning 设置仍由模型路由负责。已开始的会话仍可更换模型，但 `agent-preset/locked` 会保持其组装配置不变，使已记录的工具调用继续有效。

Web 设置分区在当前模型路由旁列出健康 preset，并且每次只写入一条绑定路径。移除绑定会立即重新采用默认 preset；删除自定义 preset 会清除所有指向它的绑定。

## 考虑过的替代方案

**把 preset 存入每个 provider 的模型配置。** 这种做法会让每个模型适配器的 schema 与编辑器依赖 agent 组装，而且移除 provider 时可能遗留无法管理的 preset 偏好。preset 领域改为拥有一个与 provider 实现无关的映射。

**绑定更改时重新组装所有运行中的会话。** 运行中的记录可能包含替代 preset 无法执行或呈现的工具调用。因此，绑定只影响未来会话或空白会话的组装。

## 后果

用户无需重启 Host 或编辑 provider 配置即可更改模型绑定。准确的 provider 与 model 键可避免不同 provider 使用同一 model id 时发生冲突。运行中的会话保持稳定的工具与提示词，因此绑定更改可能不会在当前对话中体现。
