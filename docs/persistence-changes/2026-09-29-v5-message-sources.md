---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-29-v5-message-sources

English | [中文](2026-09-29-v5-message-sources.zh.md)

## Summary

Adds new read-side message source kinds to the logged message-source union.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing events remain byte-identical and readable; the union only widens with the new kinds output-limit-continuation, pentest-executor, pentest-supervisor, and recon-engine. The change is written by format 5, so the record carries the 4-to-5 writer transition and readers accept both unions.

<a id="verification"></a>
## Verification

packages/session/session-format-v4-to-v5: 24 tests passed; gen-persistence-catalog and verify-persistence-catalog pass.

<a id="dev-note"></a>
## Dev Note

None.
