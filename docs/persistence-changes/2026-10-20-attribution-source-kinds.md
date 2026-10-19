---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-20-attribution-source-kinds

English | [中文](2026-10-20-attribution-source-kinds.zh.md)

## Summary

Adds the qualified attribution source kinds session-edit, pi-tui, and knowledge-context to user and developer message source slots, plus the ordinary knowledge/status event.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing records remain valid: all three kinds are @persistenceAttribution-qualified, so readers without their producers preserve each kind and its JSON metadata and derive recorded messages without that projection. No reader validates, requires, or grants authority by these kinds: session-edit developer markers derive no model input and are exempt from the open-step invariant, pi-tui notices are inspected only by the producing TUI, and knowledge-context carries only a guidance digest. knowledge/status is a new ordinary event; readers whose known-event vocabulary predates it refuse the log under the required-on-read contract rather than silently dropping it, and current readers lose nothing because the event carries only UI library availability.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/pi-tui/tests/session.spec.ts packages/experimental/pi-tui/tests/chat.spec.ts packages/fs/tool-fs-search/tests/: 310 tests passed, 2 skipped.

<a id="dev-note"></a>
## Dev Note

None.
