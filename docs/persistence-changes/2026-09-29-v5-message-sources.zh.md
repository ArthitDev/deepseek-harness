---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-29-v5-message-sources

[English](2026-09-29-v5-message-sources.md) | 中文

## 概述

为日志消息来源并集新增读取侧来源类型。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-29-v5-message-sources
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "22c6899a78214dd841c266348ae997027ef391174ddb21127f1b71dc1b362824"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "bfe81731c910941e7d570fb5d685bf1f73a1f85083ac0f386a89dafcf7cdc274"
    decision: version-bump
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "006ee1adcd84ffc4eaf4427ee9bd183b76e30027358caf14db1b2ebc85beef53"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "bbe8dd6dc5965b080f86cc29d404032b1afe51c3b93184942a4bf71c3be21049"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "8dee047122fe20a6f3e76cb8dcfe8f3b54cc4945b5d728fd8be35d1b3042ffe9"
    decision: version-bump
  - root: "event:web-search/mode"
    previous: null
    after: "20a765f6ff6ae356224bcdb0b18e9547c6f9d6e2f39b6f4e5e07de076d5579fd"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

既有事件逐字节不变且可读；并集仅扩展了 output-limit-continuation、pentest-executor、pentest-supervisor 与 recon-engine 等新来源。该变更由格式 5 写入，因此记录携带 4 到 5 的写入方迁移，读取方同时接受两个并集。

<a id="verification"></a>
## 验证

packages/session/session-format-v4-to-v5：24 个测试通过；gen-persistence-catalog 与 verify-persistence-catalog 通过。

<a id="dev-note"></a>
## 开发备注

无。
