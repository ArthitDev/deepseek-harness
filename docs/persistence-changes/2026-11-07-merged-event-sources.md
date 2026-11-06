---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-07-merged-event-sources

English | [中文](2026-11-07-merged-event-sources.zh.md)

## Summary

Acknowledges the merged source lineages in the event vocabulary: the four user and developer message-path events adopt the merged tree's source unions, four experimental-team events join as the experimental Agent Teams variant's distinct persisted scope, and the fork-only web-search/mode event leaves the vocabulary.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-07-merged-event-sources
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-20-attribution-source-kinds"
    after: "356024d881eb1ebd596b1fdc5a38f28e776e36160665b6e2962f8396c73dcada"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-20-attribution-source-kinds"
    after: "85977d2797ee7ad98b093d682918638b98123e5574fe609ad16e6fbd17894540"
    decision: same-version
  - root: "event:experimental-team/member"
    previous: null
    after: "6645d16f83cf01dbba5ba48e9a77964a2643c2a5bb7aaae671927556d29ebe4a"
    decision: same-version
  - root: "event:experimental-team/task"
    previous: null
    after: "8a66c685e096330ada3ae5b7dce8a20dd0e73e8ab5885d450d55cf3bdc21098a"
    decision: same-version
  - root: "event:experimental-team/message/queued"
    previous: null
    after: "47fc39988c794c684c3dfdc54312e98c316b9ca99c0e04f0c852b71f404f9be2"
    decision: same-version
  - root: "event:experimental-team/message/delivered"
    previous: null
    after: "8353614cbe393db6c16c183d95891d95087f730e5e77a17d6a39b70df644bf3a"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-20-attribution-source-kinds"
    after: "e752f31403aace130fa3e6a25c533274ac670acabc7e004b8d25b8202dc4729d"
    decision: same-version
  - root: "event:web-search/mode"
    previous: "2026-09-29-v5-message-sources"
    after: null
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-20-attribution-source-kinds"
    after: "456a972818cbf26142bfaca7495bfa75e1485135179e2e0d01d30c6060ccee7f"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The message-path unions describe the merged tree's producer kinds, including the attribution-qualified kinds earlier records already govern, so readers without a producer preserve each record and derive recorded messages without that projection. The experimental-team events are a new ordinary scope written only by `@deepseek-ai/dsh-experimental-agent-team`; readers whose known-event vocabulary predates them refuse the log under the required-on-read contract rather than silently dropping them, and the stable `team/*` scope keeps its own declarations and readers. web-search/mode records exist only in sessions written by the pre-merge fork lineage; the merged tree declares no such event, so a log carrying one is refused under the same required-on-read contract instead of being read with a guessed payload.

<a id="verification"></a>
## Verification

`pnpm run gen-persistence-catalog` regenerated the catalog from the merged source and `pnpm run verify-persistence-catalog` passes; `pnpm run verify-persistence-changes` accepts the linearized chain with these digests.

<a id="dev-note"></a>
## Dev Note

The fork-era captures of `2026-09-29-v5-message-sources` and `2026-10-20-attribution-source-kinds` were authored against the pre-merge tree; their message-path predecessors now chain through the merged v4-era tips, and this record closes the chain against the current source.
