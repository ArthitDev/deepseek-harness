---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-10-web-search-mode

English | [中文](2026-11-10-web-search-mode.zh.md)

## Summary

Adds the web-search/mode event with an always boolean to retain the operator's per-session web-search choice. The Session format remains unchanged.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing logs contain no such event, so the mode projection retains its false default and automatic web search. New readers restore the last recorded boolean; this log-only event adds no model message. Older readers that do not recognize this required event refuse the log before interpretation or provider append rather than silently dropping the choice. Unknown-required-event admission preserves the stored bytes on refusal. Existing event payloads and headers are unchanged.

<a id="verification"></a>
## Verification

rtk proxy pnpm exec vitest run packages/web/tool-web/tests/tool-web.spec.ts packages/session/session-persistence-jsonl/tests/current-event-admission.spec.ts --maxWorkers=2: 2 suites and 104 tests passed. Mode tests cover absent history, enabled mode, and switching back to automatic without adding model messages. Admission tests cover read/write refusal of unknown required events without truncating stored bytes. Source review confirms web-search/mode is in the known-event inventory and its producer does not mark it ignorable.

<a id="dev-note"></a>
## Dev Note

None.
