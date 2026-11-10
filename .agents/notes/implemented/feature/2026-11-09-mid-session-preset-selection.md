# Agent Note: Mid-session preset selection

Status: implemented

English | [中文](2026-11-09-mid-session-preset-selection.zh.md)

## Problem

The first-turn lock prevents changing an Agent's behavior while continuing the same task. Forking to bypass the lock changes session identity and strips instruction history.

## Decision

The preset registry selects a new composition between turns under the Agent's existing maintenance mechanism. Inputs arriving during acquisition wait for maintenance to finish. Selection retains the Session, its complete event prefix and compacted history, and records the new preset through the existing `agent-preset/selected` event. The next request assembles the selected composition's prompt and tools. Active turns remain excluded; invalid definitions and cancellation before binding leave the old composition intact.

TUI `/preset` and model-bound preset changes use this operation directly. Web reuses its picker in the session header, disabling it during work. Explicit choices may change started Sessions; automatic staged choices and new-task default synchronization still target blank Sessions only.

## Alternatives considered

**Keep the first-turn lock.** It prevents the requested behavior change even when no request or tool is active.

**Fork and reset instructions.** It retains conversational content but replaces session identity and removes prior model-visible context, contrary to the requested continuity.

## Consequences

Changing a preset can invalidate the next request's cached prefix. Existing answers, injected context and summaries remain part of history and can still influence behavior. Model protocols that preserve system updates in history retain earlier system messages alongside the new one. This operation does not rewrite history or guarantee model compliance.

Real-loop Loader tests cover both system-update protocols, unchanged history, new prompt/tools, refused definitions, deferred inputs and cancellation before binding. TUI and Web tests cover their existing-session selection paths.
