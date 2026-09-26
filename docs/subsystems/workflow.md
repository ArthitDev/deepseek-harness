# Workflow

English | [中文](workflow.zh.md)

The workflow seam lets an agent run a model-written orchestration SCRIPT that starts subagents. Like [subagent](subagent.md) it is **one optional capability**, not part of the agent loop, so its types and operations live here rather than in [core.md](core.md). Like bash, it permits ONE engine implementation per context to provide `ctx.workflowEngine`; there is no named-provider registry (a second engine replaces the first through plugin configuration rather than running beside it).

Service Definition: [dsh-workflow](../../packages/workflow/workflow) (`ctx.workflowEngine` and the vocabulary below). [dsh-workflow-ptc](../../packages/workflow/workflow-ptc) executes the VM and helpers through the shared Node PTC process runtime under the calling Session's file policy. The consumers are [dsh-tool-workflow](../../packages/workflow/tool-workflow) and the opt-in [dsh-tool-ralph](../../packages/workflow/tool-ralph). [Workflow sandbox reuse](../../.agents/notes/implemented/architecture/2026-09-13-workflow-ptc-sandbox-reuse.md) owns execution choices; the [dynamic-workflows decision](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md) owns script semantics.

Sources: browser-safe vocabulary in [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts), Host request and live-run handles in [`runtime-types.ts`](../../packages/workflow/workflow/src/runtime-types.ts).

## The start request

What a caller asks for when starting a run. The ordinary workflow tool builds this from the model's `{ script, meta, args }` call plus the calling agent; specialized consumers may also select one engine-wide `subagentProvider` and lower `maxTotalAgents` for the run, but the script cannot observe or replace either policy. `meta` and `args` are plain JSON DATA (the engine validates `meta` against its schema and rejects loud BEFORE anything runs — no script text is ever evaluated to obtain it). `parent` is REQUIRED — every child the script starts is attributed to it, and cwd, lineage, and depth pass through the [subagent seam](subagent.md).

```ts type-equiv
/**
 * What a caller asks for when starting a workflow run. `meta` and `args` are
 * plain JSON data by the seam contract. `parent` is required because every
 * `agent()` spawned by the script is attributed to that live Agent.
 */
interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  /** Cancels the run when aborted. */
  signal?: AbortSignal
}
```

## The workflow's identity: `WorkflowMeta`

The identity block carried as data on the start request (the tool's `meta` parameter; the field vocabulary matches the Claude Code dynamic-workflows meta block). `phases` is progress vocabulary only: `phase()` calls match titles for observers; no execution structure is implied.

```ts type-equiv
/**
 * The script's identity block, provided as plain JSON data alongside the
 * script body (the model-facing tool carries it as its `meta` parameter) and
 * validated by the engine before the body runs. `name`/`description` are
 * required; the rest is optional annotation. The field vocabulary matches the
 * Claude Code dynamic-workflows meta block.
 */
interface WorkflowMeta {
  /** Short kebab-case workflow name (display + persistence key). */
  name: string
  /** One-line description of what the workflow does. */
  description: string
  /** Optional guidance on when this workflow applies (shown in listings). */
  whenToUse?: string
  /** Optional phase declarations matched by `phase()` calls. */
  phases?: WorkflowPhase[]
}
```

## The terminal result: `WorkflowResult`

The outcome of one run, resolved by `WorkflowRun.result`. `value` is the script's materialized return value — plain host-realm JSON data (`null` when the script returned nothing) — meaningful only for `completed`. `stopReason` is a CLOSED union (engine-owned; consumers may exhaust it): `completed` | `cancelled` | `error`. A non-`completed` reason carries the failure in `error`, and the consumer maps it to an `isError` tool result rather than reporting partial output as success.

```ts type-equiv
/**
 * The outcome resolved by a live workflow run. `value` is
 * the script's materialized return value (plain host-realm JSON data; `null`
 * when the script returned `undefined`) — meaningful only for `completed`.
 * A non-`completed` reason carries the failure in `error`; the consumer maps
 * it to an `isError` tool result rather than reporting partial output.
 */
interface WorkflowResult {
  /** The script's return value (host JSON data; `null` for no return). */
  value: unknown
  /** Why the run settled. */
  stopReason: WorkflowStopReason
  /** The failure message (present iff `stopReason` is not `completed`). */
  error?: string
  /**
   * How many `agent()` calls the run accepted over its whole lifetime. On a
   * graceful settlement this is the script-side count (calls still queued for
   * a concurrency slot included); on a termination path (cancellation or
   * process failure) it degrades to the host-observed count — calls queued
   * inside a terminated script are unknowable then.
   */
  agentsStarted: number
}
```

## A live run: `WorkflowRun`

The consumer awaits `result`, may `cancel` during execution, and must `dispose` on every path. `result` never rejects: script failure resolves with `stopReason: 'error'`, and cancellation with `'cancelled'`. The PTC engine has no overall elapsed deadline; it immediately aborts the managed process when cancelled. Disposal awaits process and child cleanup under their provider contracts, without an independent workflow cleanup deadline.

```ts type-equiv
/**
 * Holder-owned live workflow. `result` never rejects; consumers may cancel
 * and must call idempotent `dispose()` to await script and child quiescence.
 */
interface WorkflowRun {
  readonly id: WorkflowRunId
  /** The validated meta block available before the script body runs. */
  readonly meta: WorkflowMeta
  readonly result: Promise<WorkflowResult>
  /** Cancel the run and its children. */
  cancel(reason?: string): void
  /** Cancel if needed and await script and child cleanup. */
  dispose(): Promise<void>
}
```

## Failure discipline: `WorkflowError.fatal`

Hook misuse inside a script — bad arguments, unknown/deferred `agent()` options, a schema outside the [structured-output subset](../../packages/core/tools/README.md), a tripped cap, a seam start failure, cancellation — throws a `WorkflowError` with `fatal: true`. The `parallel()`/`pipeline()` combinators RE-THROW fatal errors instead of mapping the item to `null`: a typo'd option must kill the script loudly, never dissolve into something that reads as an ordinary child failure. The per-item `null` is reserved for child-run failures (a non-`completed` stop reason) and ordinary in-stage script errors.

## Events

The `workflow/*` events (`workflow/start`, `workflow/phase`, `workflow/log`, `workflow/agent-start`, `workflow/agent-end`, `workflow/end` — see the [events catalog](#cordis-surface)) are **observe-only** emits carrying DATA SNAPSHOTS: every payload starts with `WorkflowRunInfo` (id + meta), never the live `WorkflowRun`, so a subscriber cannot gain `cancel`/`dispose`, and `workflow/end` deliberately omits the result value (a listener observing outcomes must not receive a mutable alias of the caller's result). Every emit is per-listener contained — a throwing subscriber is logged, never propagated, and cannot starve the listeners registered after it — and every listener receives its own payload clone, so mutating it corrupts neither the engine nor other listeners; the containment mirrors `subagent/start`/`subagent/end`.

## Durable Chat records

The top-level `dsh-tool-workflow` consumer projects display facts into its calling parent Session without changing execution ownership. It writes `tool-workflow/run-start` after a run is accepted, pairs member start and end by `runId + seq`, and writes `tool-workflow/run-end` only after the result is known and disposal reaches quiescence. Nested transport calls write no record. The first append failure disables later writes for that run, so the log remains empty or a legal continuous prefix and the tool result is unchanged.

`dsh-tool-workflow/invariant` validates the same protocol before live commit and when a Session is loaded: one start per run, positive unique member sequences, paired member endings, no run ending with open members, and no updates after the run ending. A missing member ending or run ending at the log tail is valid interruption evidence rather than corruption.

`dsh-client-ui-workflow-run` folds the four events through the Conversation Node engine into one `workflow-run` Chat node anchored at the run-start sequence, after the original workflow tool node. Phase groups come only from actual member starts and preserve exact strings, including the distinction between an omitted phase and `''`. Closed Locations turn missing terminal facts into interrupted presentation. The [UI package README](../../packages/client/ui-workflow-run/README.md) owns disclosure, status, and same-parent local navigation behavior.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpentestloop--pentestloopservice"></a>

### `ctx.pentestLoop` — `PentestLoopService`

Owns at most one live background control loop per run and backs the generated `ctx.remote.pentestLoop` namespace. The loop is host-process state: after a process restart the operator restarts it, and canonical state resumes from the database.

```ts cordis-catalog
/**
 * Create one authorized penetration-test run.
 * @param request - Objective, mode, and scope strings captured from the operator.
 * @returns the durable run record.
 */
@Remote create(request: CreatePentestRunRequest): Promise<PentestRunRecord>

/**
 * Start one run's background control loop.
 * @param runId - Run to advance toward completion.
 * @param request - Optional tool restriction and bounded loop limits.
 */
@Remote async start(runId: string, request: PentestLoopStartRequest): Promise<void>

/**
 * Abort one run's live background control loop.
 * @param runId - Run whose loop should stop after the current cycle unwinds.
 */
@Remote async stop(runId: string): Promise<void>

/**
 * List runs whose background control loop is live in this process.
 * @returns run identities with a running loop, most recent start first.
 */
@Remote running(): Promise<readonly string[]>
```

Types: [CreatePentestRunRequest](../../packages/pentest/pentest-run/README.md) · [PentestLoopStartRequest](../../packages/pentest/pentest-executor/README.md) · [PentestRunRecord](../../packages/pentest/pentest-run/README.md)

Source: [`packages/pentest/pentest-executor/src/loop.ts`](../../packages/pentest/pentest-executor/src/loop.ts)

<a id="ctxpentestmodepolicy--pentestmodepolicy"></a>

### `ctx.pentestModePolicy` — `PentestModePolicy`

Host-owned global mode setting and ordinary-session prompt policy.

```ts cordis-catalog
/**
 * Read the selected mode at prompt assembly time.
 * @returns the current global mode setting.
 */
current(): PentestModeSettings
```

Types: [PentestModeSettings](../../packages/pentest/pentest-executor/README.md)

Source: [`packages/pentest/pentest-executor/src/index.ts`](../../packages/pentest/pentest-executor/src/index.ts)

<a id="ctxpentestruncontroller--pentestruncontroller"></a>

### `ctx.pentestRunController` — `PentestRunController`

Host service backing the generated `ctx.remote.pentestRuns` namespace.

```ts cordis-catalog
/**
 * List the durable penetration-test runs for the operator surface.
 * @returns every canonical penetration-test run visible to this host.
 */
@Remote list(): Promise<readonly PentestRunRecord[]>

/**
 * Project one durable run for the operator surface.
 * @param runId - run identity from the Remote caller.
 * @returns the complete canonical run projection.
 */
@Remote snapshot(runId: string): Promise<PentestRunSnapshot>

/**
 * Read one retained raw artifact back through the run's spill backend.
 * @param runId - run identity from the Remote caller.
 * @param artifactId - canonical artifact identity from the run snapshot.
 * @returns the artifact metadata plus its verbatim content.
 */
@Remote loadArtifact(runId: string, artifactId: string): Promise<PentestArtifactContent>

/**
 * Apply an operator-owned run lifecycle transition.
 * @param runId - run identity from the Remote caller.
 * @param request - requested run lifecycle transition.
 * @returns the updated canonical run record.
 */
@Remote control(runId: string, request: ControlPentestRunRequest): Promise<PentestRunRecord>

/**
 * Apply an operator-owned task action.
 * @param taskId - task identity from the Remote caller.
 * @param request - requested operator task action.
 * @returns the updated canonical task record.
 */
@Remote controlTask(taskId: string, request: ControlPentestTaskRequest): Promise<PentestTaskRecord>

/**
 * Replace a run's operator-approved target scope.
 * @param runId - run identity from the Remote caller.
 * @param request - complete replacement authorization scope.
 * @returns the updated canonical run record.
 */
@Remote replaceScope(runId: string, request: ReplacePentestScopeRequest): Promise<PentestRunRecord>
```

Types: [ControlPentestRunRequest](../../packages/pentest/pentest-run/README.md) · [ControlPentestTaskRequest](../../packages/pentest/pentest-run/README.md) · [PentestArtifactContent](../../packages/pentest/pentest-run/README.md) · [PentestRunRecord](../../packages/pentest/pentest-run/README.md) · [PentestRunSnapshot](../../packages/pentest/pentest-run/README.md) · [PentestTaskRecord](../../packages/pentest/pentest-run/README.md) · [ReplacePentestScopeRequest](../../packages/pentest/pentest-run/README.md)

Source: [`packages/pentest/pentest-run/src/remote.ts`](../../packages/pentest/pentest-run/src/remote.ts)

<a id="ctxpentestruns--pentestrunmanager"></a>

### `ctx.pentestRuns` — `PentestRunManager`

Owns canonical penetration-test run state outside Session history.

```ts cordis-catalog
/**
 * Create one active run with an explicit authorized target set.
 * @param request - Objective and scope strings captured from the operator.
 * @returns the durable run record.
 */
createRun(request: CreatePentestRunRequest): Promise<PentestRunRecord>

/**
 * Add one bounded task to an existing active run.
 * @param runId - Owning run identity.
 * @param request - Objective, scheduling values, and prerequisite tasks.
 * @returns the durable task record.
 */
createTask(runId: PentestRunId, request: CreatePentestTaskRequest): Promise<PentestTaskRecord>

/**
 * Lease one runnable task while no other task is active in its run.
 * @param taskId - Task selected by the supervisor.
 * @param request - Explicit deadline for this attempt.
 * @returns The bounded packet for a fresh executor.
 */
leaseTask(taskId: PentestTaskId, request: LeasePentestTaskRequest): Promise<PentestTaskLease>

/**
 * Mark a leased attempt as running.
 * @param leaseId - Current lease identity.
 * @returns The updated task.
 */
startTask(leaseId: PentestLeaseId): Promise<PentestTaskRecord>

/**
 * Complete a running task attempt.
 * @param leaseId - Current lease identity.
 * @returns The terminal task record.
 */
completeTask(leaseId: PentestLeaseId): Promise<PentestTaskRecord>

/**
 * Fail one leased or running attempt and apply its retry limit.
 * @param leaseId - Current lease identity.
 * @param error - Failure diagnostic retained for the supervisor.
 * @returns A ready retry or terminal failed task.
 */
failTask(leaseId: PentestLeaseId, error: string): Promise<PentestTaskRecord>

/**
 * Recover expired active attempts so a restarted controller can continue.
 * @param now - timestamp used as the recovery cutoff.
 * @returns the number of task leases recovered.
 */
recoverExpiredLeases(now: string = new Date().toISOString()): Promise<number>

/**
 * Mark a run complete only after every task is terminal and canonical evidence exists.
 * @param runId - run to complete.
 * @returns the completed canonical run record.
 */
completeRun(runId: PentestRunId): Promise<PentestRunRecord>

/**
 * Apply an operator-owned run lifecycle transition.
 * @param runId - run to control.
 * @param request - requested lifecycle transition.
 * @returns the updated canonical run record.
 */
controlRun(runId: PentestRunId, request: ControlPentestRunRequest): Promise<PentestRunRecord>

/**
 * Resolve a blocked task or change one task before it starts.
 * @param taskId - task to control.
 * @param request - requested operator action.
 * @returns the updated canonical task record.
 */
controlTask(taskId: PentestTaskId, request: ControlPentestTaskRequest): Promise<PentestTaskRecord>

/**
 * Replace operator scope while preserving every still-open task target.
 * @param runId - run whose authorization scope changes.
 * @param request - replacement authorized and excluded targets.
 * @returns the updated canonical run record.
 */
replaceScope(runId: PentestRunId, request: ReplacePentestScopeRequest): Promise<PentestRunRecord>

/**
 * Compile one fresh executor episode into canonical records and release its task lease.
 * @param leaseId - Running lease that produced the episode.
 * @param request - Structured result and secret-free tool traces.
 * @returns every record written by the commit.
 */
commitEpisode( leaseId: PentestLeaseId, request: CommitPentestEpisodeRequest, ): Promise<CommittedPentestEpisode>

/**
 * Read one run's retained artifact back through the configured spill
 * backend. The owner scope is the producing executor episode's session, so
 * a locator is resolvable only inside that session's storage; an expired or
 * swept artifact rejects without touching canonical state.
 * @param runId - Run that owns the artifact.
 * @param artifactId - Canonical artifact identity from the run snapshot.
 * @returns the artifact metadata plus its verbatim content.
 */
loadArtifact(runId: PentestRunId, artifactId: PentestArtifactId): Promise<PentestArtifactContent>

/**
 * Build a complete point-in-time run projection after preceding writes settle.
 * @param runId - Run to project.
 * @returns canonical records belonging to the run.
 */
snapshot(runId: PentestRunId): Promise<PentestRunSnapshot>

/**
 * List canonical runs with the most recently changed run first.
 * @returns every canonical run ordered by most recent update.
 */
listRuns(): Promise<readonly PentestRunRecord[]>
```

Types: [CommitPentestEpisodeRequest](../../packages/pentest/pentest-run/README.md) · [CommittedPentestEpisode](../../packages/pentest/pentest-run/README.md) · [ControlPentestRunRequest](../../packages/pentest/pentest-run/README.md) · [ControlPentestTaskRequest](../../packages/pentest/pentest-run/README.md) · [CreatePentestRunRequest](../../packages/pentest/pentest-run/README.md) · [CreatePentestTaskRequest](../../packages/pentest/pentest-run/README.md) · [LeasePentestTaskRequest](../../packages/pentest/pentest-run/README.md) · [PentestArtifactContent](../../packages/pentest/pentest-run/README.md) · [PentestArtifactId](../../packages/pentest/pentest-run/README.md) · [PentestLeaseId](../../packages/pentest/pentest-run/README.md) · [PentestRunId](../../packages/pentest/pentest-run/README.md) · [PentestRunRecord](../../packages/pentest/pentest-run/README.md) · [PentestRunSnapshot](../../packages/pentest/pentest-run/README.md) · [PentestTaskId](../../packages/pentest/pentest-run/README.md) · [PentestTaskLease](../../packages/pentest/pentest-run/README.md) · [PentestTaskRecord](../../packages/pentest/pentest-run/README.md) · [ReplacePentestScopeRequest](../../packages/pentest/pentest-run/README.md)

Source: [`packages/pentest/pentest-run/src/index.ts`](../../packages/pentest/pentest-run/src/index.ts)

<a id="ctxreconengineoptions--reconengineoptions"></a>

### `ctx.reconEngineOptions` — `ReconEngineOptions`

Deployment-varying limits and scope the engine runs under.

Source: [`packages/pentest/recon-engine/src/engine.ts`](../../packages/pentest/recon-engine/src/engine.ts)

<a id="ctxworkflowengine--workflowengine-abstract-seam"></a>

### `ctx.workflowEngine` — `WorkflowEngine` (abstract seam)

Workflow Service Definition contract. Invalid requests throw before publication; a live run is holder-owned, its result never rejects, and disposal waits for script and child cleanup. Lifecycle listener failures are contained, and `workflow/end` fires exactly once as the result settles.

```ts cordis-catalog
/**
 * Parse and execute a workflow script.
 * @param request - the script, its `args`, the parent agent, and an
 *   optional cancel signal.
 * @returns the live run; its `result` resolves when the script settles.
 */
abstract start(request: WorkflowStartRequest): WorkflowRun
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflow-events"></a>

### `workflow/*` events

<a id="workflowagent-end--emit"></a>

#### `workflow/agent-end` — emit

One `agent()` call settled (clean result, child failure, or run cancellation). Paired with Events['workflow/agent-start'] by `agent.seq`, exactly once per started call on every stop path — on an engine termination path the end is engine-synthesized with outcome `'cancelled'`.

```ts cordis-catalog
/**
 * One `agent()` call settled (clean result, child failure, or run
 * cancellation). Paired with {@link Events['workflow/agent-start']} by
 * `agent.seq`, exactly once per started call on every stop path — on an
 * engine termination path the end is
 * engine-synthesized with outcome `'cancelled'`.
 * @param info - the run's identity snapshot.
 * @param agent - the call identity plus its outcome.
 * @mode emit
 */
'workflow/agent-end'(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowagent-start--emit"></a>

#### `workflow/agent-start` — emit

One `agent()` call established a published child run. Paired with Events['workflow/agent-end'] by `agent.seq`. A call that never receives a published run from the provider emits neither event in this pair.

```ts cordis-catalog
/**
 * One `agent()` call established a published child run. Paired with
 * {@link Events['workflow/agent-end']} by `agent.seq`. A call that never
 * receives a published run from the provider emits neither
 * event in this pair.
 * @param info - the run's identity snapshot.
 * @param agent - the call's sequence number, label, phase, and child id.
 * @mode emit
 */
'workflow/agent-start'(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowend--emit"></a>

#### `workflow/end` — emit

A workflow run settled (any stop reason). Fired when WorkflowRun.result resolves. Paired with Events['workflow/start'].

```ts cordis-catalog
/**
 * A workflow run settled (any stop reason). Fired when
 * {@link WorkflowRun.result} resolves. Paired with
 * {@link Events['workflow/start']}.
 * @param info - the run's identity snapshot.
 * @param result - the outcome data (stop reason, error, agent count) —
 *   deliberately WITHOUT the result value (see {@link WorkflowResultInfo}).
 * @mode emit
 */
'workflow/end'(info: WorkflowRunInfo, result: WorkflowResultInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowlog--emit"></a>

#### `workflow/log` — emit

The script emitted a narration line (a `log(message)` call).

```ts cordis-catalog
/**
 * The script emitted a narration line (a `log(message)` call).
 * @param info - the run's identity snapshot.
 * @param message - the logged message, verbatim.
 * @mode emit
 */
'workflow/log'(info: WorkflowRunInfo, message: string): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowphase--emit"></a>

#### `workflow/phase` — emit

The script entered a phase (a `phase(title)` call) — progress grouping for observers; no execution semantics.

```ts cordis-catalog
/**
 * The script entered a phase (a `phase(title)` call) — progress grouping
 * for observers; no execution semantics.
 * @param info - the run's identity snapshot.
 * @param title - the phase title, verbatim.
 * @mode emit
 */
'workflow/phase'(info: WorkflowRunInfo, title: string): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowstart--emit"></a>

#### `workflow/start` — emit

A workflow run started — the script's meta block validated, the body about to execute. Paired with Events['workflow/end'].

```ts cordis-catalog
/**
 * A workflow run started — the script's meta block validated, the body
 * about to execute. Paired with {@link Events['workflow/end']}.
 * @param info - the run's identity snapshot (id + meta).
 * @mode emit
 */
'workflow/start'(info: WorkflowRunInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)
<!-- END GENERATED cordis-surface -->
