---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-10-web-search-mode

[English](2026-11-10-web-search-mode.md) | 中文

## 概述

新增带有 always 布尔值的 web-search/mode 事件，保留操作者为每个 Session 选择的网页搜索模式。Session 格式版本保持不变。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-10-web-search-mode
baseline: false
changes:
  - root: "event:web-search/mode"
    previous: "2026-11-07-merged-event-sources"
    after: "20a765f6ff6ae356224bcdb0b18e9547c6f9d6e2f39b6f4e5e07de076d5579fd"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有日志不含此事件，因此模式投影保留 false 默认值，继续自动决定是否搜索网页。新读取方恢复最后记录的布尔值；此仅日志事件不添加模型消息。不认识此必需事件的旧读取方在解释日志或通过持久化提供方追加之前拒绝日志，不会静默丢弃选择。未知必需事件的准入检查在拒绝时保留存储字节。已有事件载荷和头部保持不变。

<a id="verification"></a>
## 验证

rtk proxy pnpm exec vitest run packages/web/tool-web/tests/tool-web.spec.ts packages/session/session-persistence-jsonl/tests/current-event-admission.spec.ts --maxWorkers=2：2 个测试文件、104 个测试通过。模式测试覆盖无历史、启用模式和切回自动模式，均不添加模型消息。准入测试覆盖读写未知必需事件时的拒绝，且不截断存储字节。源码检查确认 web-search/mode 已列入已知事件目录，其写入方未将其标记为 ignorable。

<a id="dev-note"></a>
## 开发备注

无。
