# Agent Note: Bounded output continuation

Status: implemented

English | [中文](2026-09-08-bounded-output-continuation.zh.md)

## Problem

Local models can exhaust their output allowance while a coding task is still unfinished. Input compaction cannot repair a truncated output, and silently stopping makes this failure hard to distinguish from completion.

## Decision

The [basic compaction plugin](../../../../packages/compaction/compaction-basic/README.md) owns optional bounded output recovery alongside input-budget recovery. With automatic handling enabled, `maxOutputContinuations` permits two follow-up turns by default. The latest request must end with `max-tokens`; cancellation and pending input take priority. Plugin notices are durable model-visible messages. Counting those messages since the latest user input prevents compaction or session resume from replenishing the budget.

## Alternatives considered

**Gateway continuation.** The gateway does not own tool execution or the client's session log. Reissuing there could hide truncation and lose tool ordering.

**Continue within the same turn.** The loop deliberately preserves a `max-tokens` turn outcome after any truncated step. Separate follow-up turns retain that evidence while allowing a recovered response to finish normally.

**Unlimited continuation.** Repeated reasoning-only output can consume the entire context without progress. A finite configurable allowance bounds automatic cost.

## Consequences

The existing compaction status, output-limit notice, and plugin notice renderers expose progress without new UI events. Truncated tool calls remain unexecuted. A token cap cannot prove semantic incompleteness; the follow-up explicitly permits a brief final answer when the task is complete. Each continuation incurs another model request. An explicit summarization override remains supported; the default summarizer follows the latest durable provider/model route.

## Verification

Focused real-loop tests cover normal completion, recovery, exhaustion, new user input, cancellation, queued work, disabled automation, plugin disposal, and truncated tool calls. A Loader composition verifies the YAML setting and durable follow-up. Existing compaction tests cover routed-model selection and history preservation on failure.
