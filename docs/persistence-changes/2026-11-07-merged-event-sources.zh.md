---
description: "记录一次持久化类型变迁及其兼容性确认。"
kind: persistence-change
---

# 2026-11-07-merged-event-sources

[English](2026-11-07-merged-event-sources.md) | 中文

## Summary

确认合并后的来源谱系进入事件词汇表：四个用户与开发者消息路径事件采用合并树的 source 联合类型，四个 experimental-team 事件作为实验版 Agent Teams 变体的独立持久化范围加入，仅 fork 使用的 web-search/mode 事件退出词汇表。

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

消息路径联合类型描述合并树的生产方 kind，其中包括先前记录已约束的带 @persistenceAttribution 限定的 kind，因此没有对应生产方的读取器会原样保留每条记录，并在缺少该投影的情况下派生已记录消息。experimental-team 事件是仅由 `@deepseek-ai/dsh-experimental-agent-team` 写入的新普通范围；已知事件词汇表早于它们的读取器会按 required-on-read 契约拒绝日志，而不是静默丢弃，稳定的 `team/*` 范围保留自己的声明与读取器。web-search/mode 记录只存在于合并前 fork 谱系写入的会话中；合并树不再声明该事件，因此携带它的日志会按同一 required-on-read 契约被拒绝，而不是以猜测的载荷被读取。

<a id="verification"></a>
## Verification

`pnpm run gen-persistence-catalog` 从合并后的源重新生成目录且 `pnpm run verify-persistence-catalog` 通过；`pnpm run verify-persistence-changes` 以这些摘要接受线性化后的链条。

<a id="dev-note"></a>
## Dev Note

`2026-09-29-v5-message-sources` 与 `2026-10-20-attribution-source-kinds` 的 fork 时代快照是针对合并前树编写的；其消息路径前驱现在链接到合并后的 v4 时代末端，本记录对照当前源闭合该链条。
