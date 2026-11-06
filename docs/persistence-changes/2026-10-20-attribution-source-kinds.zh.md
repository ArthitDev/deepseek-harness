---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-20-attribution-source-kinds

[English](2026-10-20-attribution-source-kinds.md) | 中文

## 概述

向 user 与 developer 消息的 source 槽位新增三个带 @persistenceAttribution 限定的来源 kind（session-edit、pi-tui、knowledge-context），并新增普通事件 knowledge/status。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-20-attribution-source-kinds
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-29-v5-message-sources"
    after: "4fa4a673fd3d2d83dcf3e4746ac3f0992ead2d5da3b07b9af3d332334efddccb"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-29-v5-message-sources"
    after: "3e2e74fccf9ec101d538404715de1b84bad246965f3f615b7422bfc840633e63"
    decision: same-version
  - root: "event:knowledge/status"
    previous: null
    after: "905069648e22d3e312f4e29f3bd4238e1f8b5f63432ef494f9c42b9877f0ea85"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-29-v5-message-sources"
    after: "4e33d7f4309b06fdba26fd5b6110e2f1f6e2fc65d337bd416eee12f0f8443bfa"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-29-v5-message-sources"
    after: "5f28245d0dfbc9418e93bac7a486b4b850bff11c1febed6a2b414f8813a7c6d4"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效：三个 kind 均已用 @persistenceAttribution 限定，缺少对应生产者的读取器会保留该 kind 及其 JSON 元数据，并在不依赖该投影的情况下派生已记录的消息。没有任何读取器依据这些 kind 进行校验、强制或授权：session-edit 开发者标记不派生模型输入，并豁免于 open-step 不变量；pi-tui 通知仅由产生它的 TUI 自行检查；knowledge-context 只携带指引摘要。knowledge/status 是新增普通事件；已知事件词表较旧的读取器会按 required-on-read 约定拒绝该日志，而不是静默丢弃；当前读取器不丢失任何内容，因为该事件只携带界面所需的库可用性。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/pi-tui/tests/session.spec.ts packages/experimental/pi-tui/tests/chat.spec.ts packages/fs/tool-fs-search/tests/：310 个测试通过，2 个跳过。

<a id="dev-note"></a>
## 开发备注

无。
