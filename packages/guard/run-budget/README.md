---
description: "Run-budget guard plugin: denies new tool calls once the token or wall-clock budget is exhausted, for users composing bounded autonomous runs"
kind: "package-reference"
---

# run-budget

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-run-budget` is the enforcement half of the Dead Mode budget requirement ("งบใกล้หมด: จบด้วยรายงาน partial แทน loop ไม่จำกัด"). It wraps the tool-call pipeline: once the measured token total reaches `maxTotalTokens` — folded from the durable log by `@deepseek-ai/dsh-token-meter`, never estimated here — or `maxWallMs` pass since the first observed call, every further tool call is refused. The refusal reaches the model as a failed result telling it to stop and produce the partial report now — the denial is the wrap-up trigger. Direct `ctx.tools.execute()` calls carry no agent and are never budgeted; the plugin adds no model-visible content under the ceilings.

## Table of Contents

- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="config"></a>
## Config

| Field | Default | Meaning |
|---|---|---|
| `maxTotalTokens` | `0` | Token ceiling measured by the token meter; `0` disables |
| `maxWallMs` | `0` | Wall-clock ceiling since the agent's first observed call; `0` disables |

Mounting with both ceilings at `0` is a misconfiguration and throws at load, as does a negative or fractional value. Setting `maxTotalTokens` without the token-meter service mounted also fails loud — a budget that cannot be measured never silently disables.

<a id="model-experience"></a>
## Model Experience

### Run budget enforcement

#### What the model sees

The first denial replaces the tool result with `Error: run budget exhausted (totalTokens=<n> [wallMs=<ms>]): stop making tool calls and produce the partial report now`; every later call is denied the same way, and the durable projection retains that text (structured `error.info` is not echoed into the log).

#### Token effect

Zero tokens while the run is under budget: one `tools/execute` listener delegates untouched, so denial costs no model request beyond the tool result already in flight.

#### KV Cache effect

None. The guard registers no prompt sections and rewrites no history; the retained denial text is already part of the logged tool result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **The wall clock starts at the first observed call, not session boot** — idle time before the agent's first tool call is not counted. A boot-anchored clock needs a session-lifecycle anchor and is deferred until a consumer needs it.
- **No live spend display** — enforcement lives here; surfacing `totalTokens`/`wallMs` in a host UI card belongs to the host presenter that already reads token-meter snapshots.
- **Denial is the wrap-up trigger, not a hard stop** — the model is instructed to finish with a partial report; a run that keeps calling tools keeps drawing denials (the repeat-call reminder then flags the loop).

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
