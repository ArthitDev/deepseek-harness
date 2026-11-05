/**
 * dsh agent/session plumbing: resolve-or-create an agent, list persisted
 * sessions. Mirrors cc-tui's resolveAgent semantics — resume falls back to
 * a fresh session and stays loud in the log.
 */
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import { createDeveloperMessage, createSystemMessage } from '@deepseek-ai/dsh-llm'
import {
  buildForkSeed,
  SessionId,
  SessionLogOffset,
  SessionSeq,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import type { WorkspaceRegistryService } from './services.js'
import { readWebProfileConfig } from './web-settings.js'

/**
 * Synchronous snapshot of a live session's durable log for transcript replay.
 * The deprecated synchronous read stays the right accessor here: the TUI fold
 * renders boundary, tool-call, and header records that `surface.nodes`
 * (message-producing seqs only) would drop, and there is no other public
 * synchronous log read on the attached Session.
 * @param session - Live session exposing the synchronous `snapshotEvents()` log read.
 * @returns the durable log events in recorded order.
 */
export function replayEvents(session: {
  snapshotEvents(): readonly SessionEvent[]
}): readonly SessionEvent[] {
  return session.snapshotEvents()
}

/** An agent plus its handle when the call created or resumed it; absent when attaching to an already-live agent. */
export interface ResolvedAgent {
  agent: Agent
  handle?: AgentHandle
  /** Whether this call created the session in this run; a resumed or attached session is never fresh. */
  fresh?: boolean
}

/** Session events that mean real user content; boot-time setup events do not count. */
const CONTENT_EVENT_TYPES: ReadonlySet<string> = new Set(['user/message', 'request/header'])

/**
 * Whether a session ever carried user content — a submitted user message or a
 * model request. A created-but-never-used session holds only boot-time setup
 * events (`permission/preset`, `sandbox/mode`, `approval/policy`,
 * `knowledge/status`) and is safe to discard.
 * @param session - session (or matching shape) whose durable log is inspected.
 * @returns true when user content is present in the durable log.
 */
export function hasUserContent(session: { snapshotEvents(): readonly { type: string }[] }): boolean {
  return session.snapshotEvents().some(event => CONTENT_EVENT_TYPES.has(event.type))
}

/**
 * Best-effort durable discard of one session artifact: forget its workspace
 * record, then delete the persisted log. Used for sessions created and
 * abandoned without user content, so boot churn does not accumulate shells.
 * @param ctx - TUI context with the optional persistence and workspace services.
 * @param sessionId - session identity to discard.
 */
export async function discardEmptySession(ctx: Context, sessionId: SessionId): Promise<void> {
  try {
    const registry = ctx.get('workspaceRegistry') as
      | { forgetSession(sessionId: SessionId): Promise<void> }
      | undefined
    const persistence = ctx.get('sessionPersistence') as
      | { delete(sessionId: SessionId, options?: { signal?: AbortSignal }): Promise<boolean> }
      | undefined
    if (persistence === undefined) return
    await registry?.forgetSession(sessionId)
    await persistence.delete(sessionId)
  } catch (error: unknown) {
    // Discard is best effort: a busy lease or missing services keep the
    // artifact and the next boot repeats the decision.
    ctx.logger.warn(
      `pi-tui: discard of empty session "${sessionId}" skipped: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

/** Session-creation metadata the TUI passes (cwd + optional agent preset). */
export interface SessionMeta {
  cwd: string
  agentPreset?: string
}

/** Resolve the Web profile's model binding for the TUI without editing its settings.
 * Missing Web overrides use the TUI registry's policy.
 * @param ctx - TUI context with profile and preset services.
 * @param provider - Selected provider route.
 * @param model - Selected model id.
 * @returns Selected preset id, or undefined without a preset registry.
 */
export function resolveModelPreset(ctx: Context, provider: string, model: string): string | undefined {
  const presets = ctx.get('agentPresets') as
    { presetIdForModel(provider: string, model: string): string } | undefined
  const config = readWebProfileConfig(ctx, 'agent-presets')
  if (config !== undefined) {
    const selected = config.get('modeSelectionEnabled') === false
      ? config.get('default')
      : config.getIn(['models', provider, model]) ?? config.get('selectedDefault') ?? config.get('default')
    if (typeof selected !== 'string' || selected.trim() === '') {
      throw new Error('pi-tui: agent-presets selection in the Web profile must be a preset id')
    }
    return selected
  }
  return presets?.presetIdForModel(provider, model)
}

/**
 * Attach to an existing agent, resume a persisted session, or create a
 * fresh one.
 */
/**
 * Resolve the agent-preset composition for one agent: mount the named (or
 * default) preset's standing composition through the creation/resume setup
 * callback — the ONLY supported call site, mirroring the web host.
 */
async function composeSetup(
  ctx: Context,
  presetId: string | undefined,
): Promise<{ agentPreset?: string; setup?: (agentCtx: Context) => Promise<void> }> {
  const presets = ctx.get('agentPresets') as
    | {
      resolve(id?: string): Promise<{ id: string }>
      mount(agentCtx: Context, id: string): Promise<unknown>
    }
    | undefined
  if (presets === undefined) return {}
  const resolvedId = (await presets.resolve(presetId)).id
  return {
    agentPreset: resolvedId,
    setup: async (agentCtx) => {
      await presets.mount(agentCtx, resolvedId)
    },
  }
}

/**
 * Attach a freshly created session to the workspace owning its cwd, creating
 * the workspace when the directory is not registered yet. The web host does
 * this inside its `create`/`fork` RPC handlers (`workspace.attachSession`);
 * the TUI creates agents in-process through `ctx.agents.create` and bypasses
 * that layer, so without this the session's cwd never enters any workspace's
 * `sessionIds` account and the web sidebar files it under "Ungrouped".
 *
 * Best-effort: missing registry or a failed attach logs a warning instead of
 * failing session creation.
 */
async function attachToWorkspace(
  ctx: Context,
  sessionId: SessionId,
  cwd: string,
): Promise<void> {
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryService | undefined
  if (registry === undefined) return
  try {
    let workspace = await registry.resolveByPath(cwd)
    if (workspace === undefined) workspace = await registry.create(cwd)
    await workspace.attachSession(sessionId)
  } catch (error) {
    ctx.logger.warn(
      `pi-tui: workspace attach for "${String(sessionId)}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

/** Copy-pasteable resume command for a persisted session.
 * @param sessionId - Persisted session id to resume.
 * @returns The full `dsh tui` command line.
 */
export function resumeCommand(sessionId: string): string {
  return `dsh tui --resume ${sessionId}`
}

/**
 * Attach a freshly created/forked session to its cwd's workspace on the
 * FIRST durable event instead of at creation. A session that never produces
 * any event leaves nothing behind: the persistence backend already skips
 * zero-event sessions in `list()`, and this keeps the workspace record
 * empty too. `attachToWorkspace` still swallows its own errors.
 * @param ctx - TUI context holding the workspace registry.
 * @param sessionId - Session to attach once its first durable event arrives.
 * @param cwd - Session working directory; a missing or empty cwd skips the attach entirely.
 */
export function attachWorkspaceOnFirstEvent(
  ctx: Context,
  sessionId: SessionId,
  cwd: string | undefined,
): void {
  if (cwd === undefined || cwd === '') return
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryService | undefined
  if (registry === undefined) return
  const off = ctx.on('session/event', (session) => {
    if (session.id !== sessionId) return
    off()
    void attachToWorkspace(ctx, sessionId, cwd)
  })
}

/**
 * Heal workspace grouping after the harness's cross-process index staleness.
 *
 * dsh-workspace builds its session→canonical-cwd index ONCE per process and
 * filters/prunes workspace membership against it. A web host that started
 * before the TUI created a session therefore:
 *   1. hides that session from the web sidebar (it lands in "Ungrouped")
 *      even though `attachWorkspaceOnFirstEvent` wrote it to the workspace's
 *      raw sessionIds, and
 *   2. DURABLY prunes it from the raw list on its next workspace write
 *      (rename/archive/attach), permanently orphaning it.
 *
 * Run at TUI boot: for every persisted session whose canonical cwd resolves
 * to an existing workspace but is missing from it, re-attach it. Additive
 * only — no workspaces are created, no entries are pruned — so it can only
 * repair, never destroy. The web host's own VIEW still needs a restart to
 * rebuild its index; this heals the durable data loss that would otherwise
 * be unrecoverable.
 * @param ctx - TUI context with workspace-registry and session-persistence services.
 * @returns the count of sessions re-attached; 0 when either service is unavailable or a pass fails.
 */
export async function reconcileWorkspaceAttachments(ctx: Context): Promise<number> {
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryService | undefined
  const persistence = ctx.get('sessionPersistence') as SessionPersistenceLike | undefined
  if (registry === undefined || persistence === undefined) return 0
  try {
    // Backend listing order (not the picker's newest-first sort) so the
    // repair pass behaves the same on every backend.
    const headers = (await persistence.list()).map(snapshot => snapshot.header)
    let repaired = 0
    for (const header of headers) {
      if (header.cwd === undefined || header.cwd === '') continue
      let canonical: string
      try {
        canonical = await realpath(header.cwd)
      } catch {
        continue // unresolvable cwd — no workspace can own it
      }
      // resolveByPath canonicalizes internally and returns the workspace
      // whose stored path equals this session's cwd, or undefined.
      const workspace = await registry.resolveByPath(canonical)
      if (workspace === undefined) continue
      // The entity's filtered view is accurate in THIS process (fresh index),
      // so a miss means the raw list lost the session — re-attach it.
      if (workspace.sessionIds.includes(String(header.id))) continue
      await workspace.attachSession(header.id)
      repaired += 1
    }
    if (repaired > 0) {
      ctx.logger.info(`pi-tui: re-attached ${repaired} session(s) to their cwd workspace`)
    }
    return repaired
  } catch (error) {
    ctx.logger.warn(
      `pi-tui: workspace reconciliation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return 0
  }
}

/** The preset a persisted session runs (last selection event, else header). */
async function persistedPreset(ctx: Context, id: string): Promise<string | undefined> {
  try {
    const loaded = await loadPersistedSession(ctx, id)
    if (loaded === undefined) return undefined
    for (const event of loaded.events.toReversed()) {
      // `agent-preset/selected` is plugin-merged; read it structurally.
      const raw = event as { type?: string; data?: { agentPreset?: string } }
      if (raw.type === 'agent-preset/selected' && raw.data?.agentPreset !== undefined) {
        return raw.data.agentPreset
      }
    }
    return loaded.header?.agentPreset
  } catch {
    return undefined
  }
}

/** Resolve a live or persisted session, or create one with the explicit preset
 * or the preset bound to its model. Resumed sessions retain their recorded preset.
 * @param ctx - TUI context with agent, preset, persistence, and workspace services.
 * @param requestedSessionId - Session id to resume; undefined or a failed resume falls back to a fresh session.
 * @param agentOptions - Provider and model options for a newly created session.
 * @param meta - Session-creation metadata (cwd and optional agent preset).
 * @returns the attached, resumed, or freshly created agent with its handle.
 */
export async function resolveAgent(
  ctx: Context,
  requestedSessionId: string | undefined,
  agentOptions: AgentOptions,
  meta: SessionMeta,
): Promise<ResolvedAgent> {
  if (requestedSessionId !== undefined) {
    const resumeId = SessionId(requestedSessionId)
    const existing = ctx.agents.get(resumeId)
    if (existing !== undefined) return { agent: existing }
    try {
      // Only mount a preset composition when the persisted session records
      // one — a failed probe must not silently re-compose a preset-less
      // session under the default.
      const sessionPreset = await persistedPreset(ctx, requestedSessionId)
      const composition = sessionPreset !== undefined ? await composeSetup(ctx, sessionPreset) : {}
      const resumed = await ctx.agents.resume({
        resumeSessionId: resumeId,
        agentOptions,
        ...(composition.setup !== undefined ? { setup: composition.setup } : {}),
      })
      return { agent: resumed.agent, handle: resumed }
    } catch (error) {
      ctx.logger.warn(
        `pi-tui: resume of "${requestedSessionId}" failed, starting fresh: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
  let presetId = meta.agentPreset
  if (presetId === undefined && agentOptions.provider !== undefined && agentOptions.model !== undefined) {
    presetId = resolveModelPreset(ctx, agentOptions.provider, agentOptions.model)
  }
  const composition = await composeSetup(ctx, presetId)
  const sessionId = SessionId(randomUUID())
  let created: AgentHandle
  try {
    created = await ctx.agents.create({
      sessionId,
      meta: {
        ...meta,
        ...(composition.agentPreset !== undefined ? { agentPreset: composition.agentPreset } : {}),
      },
      agentOptions,
      ...(composition.setup !== undefined ? { setup: composition.setup } : {}),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `pi-tui: failed to create agent (provider=${agentOptions.provider ?? 'deepseek-official'}): ${message}`,
      { cause: error },
    )
  }
  // Workspace grouping is deferred to the first durable event: a failed attach
  // must never be reported as an agent-create failure, and an empty session
  // (never any event) should leave no workspace record behind.
  attachWorkspaceOnFirstEvent(ctx, sessionId, meta.cwd)
  return { agent: created.agent, handle: created, fresh: true }
}

/**
 * Fork the agent's session at its current end and open a NEW agent over the
 * forked log (cc-tui's rewind pattern): lineage recorded, transcript kept,
 * fresh session id. The seed is built with the session fork primitive the
 * agent factory documents: an exact parent prefix, the inherited marker, and
 * synthetic closers for the open tail.
 * With resetPrompt, copy the log with empty system messages and non-model-visible
 * session-edit placeholders for developer and injected user instructions. Conversation,
 * tool results, and compacted checkpoints remain. This edited seed shares no inherited
 * persistence prefix; the source is unchanged and the child's new preset is recorded.
 * @param ctx - TUI context with agent and preset services.
 * @param source - Agent whose session log is forked.
 * @param agentOptions - Provider and model options for the child agent.
 * @param meta - Session-creation metadata (cwd and optional agent preset).
 * @param resetPrompt - Copy the log with emptied system messages and non-model-visible
 *   session-edit placeholders instead of an exact inherited seed.
 * @returns the newly created child agent with its handle.
 */
export async function forkSession(
  ctx: Context,
  source: Agent,
  agentOptions: AgentOptions,
  meta: SessionMeta,
  resetPrompt = false,
): Promise<ResolvedAgent> {
  const events = replayEvents(source.session)
  const lastSeq = events.length - 1
  const prefix = resetPrompt ? events.map((event): SessionEvent => {
    if (event.type === 'system/message') return {
      ...event, data: { ...event.data, message: createSystemMessage('') },
    }
    if ((event.type === 'developer/message' && event.data.message.source.kind !== 'session-edit') || (event.type === 'user/message'
      && event.data.source.kind !== 'user' && (event.data.source as { kind: string }).kind !== 'compact-checkpoint'
      && !(event.data.source.kind === 'pi-tui' && event.data.source.form === 'notice'))) {
      return {
        ...event, type: 'developer/message', data: {
          turn: event.type === 'developer/message' ? event.data.turn : 1,
          step: event.type === 'developer/message' ? event.data.step : 1,
          message: createDeveloperMessage({ content: [], source: { kind: 'session-edit' } }),
        },
      }
    }
    return event
  }) : events
  const seed = lastSeq >= 0 ? resetPrompt ? prefix : buildForkSeed(prefix, SessionSeq(lastSeq)) : undefined
  const presets = ctx.get('agentPresets') as
    { composedPreset(agentCtx: Context): string | undefined; select(agent: Agent, id: string): Promise<string> } | undefined
  const composition = await composeSetup(
    ctx,
    meta.agentPreset ?? presets?.composedPreset(source.ctx),
  )
  const childId = SessionId(randomUUID())
  const created = await ctx.agents.create({
    sessionId: childId,
    ...(seed !== undefined ? { seed } : {}),
    meta: {
      ...meta,
      parentSession: source.session.id,
      ...(seed !== undefined && !resetPrompt ? { isSeeded: true } : {}),
      ...(composition.agentPreset !== undefined ? { agentPreset: composition.agentPreset } : {}),
    },
    // An edited seed must be persisted independently from the source prefix.
    ...(seed !== undefined ? { inheritedEventCount: SessionLogOffset(resetPrompt ? 0 : lastSeq + 1) } : {}),
    agentOptions,
    ...(composition.setup !== undefined ? { setup: composition.setup } : {}),
  })
  if (resetPrompt && composition.agentPreset !== undefined && presets !== undefined) {
    try { await presets.select(created.agent, composition.agentPreset) }
    catch (error) { await created.dispose(); throw error }
  }
  attachWorkspaceOnFirstEvent(ctx, childId, meta.cwd)
  return { agent: created.agent, handle: created, fresh: true }
}

/**
 * The session-persistence service surface the TUI consumes (`ctx.get(
 * 'sessionPersistence')`), narrowed to the read paths used here. Storage is
 * addressed through per-session handles: `list` observes headers without the
 * log; a `read` handle drains the events.
 */
interface SessionPersistenceLike {
  list(options?: { signal?: AbortSignal }): Promise<readonly { header: SessionHeader }[]>
  open(
    id: SessionId,
    access: 'read' | 'write',
    options?: { signal?: AbortSignal },
  ): Promise<{
    header: SessionHeader
    read(options?: { signal?: AbortSignal }): Promise<{ events: readonly SessionEvent[] }>
    close(): Promise<void>
  }>
}

/**
 * Read one persisted session's header and complete event log through a
 * borrowed read handle (the modern replacement for the retired `load`).
 * @param ctx - TUI context with the session-persistence service.
 * @param id - Session id to read.
 * @returns the log and header, or undefined when persistence is unavailable.
 */
export async function loadPersistedSession(
  ctx: Context,
  id: string,
): Promise<{ header?: SessionHeader; events: readonly SessionEvent[] } | undefined> {
  const persistence = ctx.get('sessionPersistence') as SessionPersistenceLike | undefined
  if (persistence === undefined) return undefined
  const handle = await persistence.open(SessionId(id), 'read')
  try {
    const { events } = await handle.read()
    return { header: handle.header, events }
  } finally {
    await handle.close()
  }
}

/** Persisted session headers, newest first (dsh's own persistence backend).
 * @param ctx - TUI context with the session-persistence service.
 * @returns Headers sorted newest first; empty when persistence is unavailable or listing fails.
 */
export async function listSessions(ctx: Context): Promise<SessionHeader[]> {
  const persistence = ctx.get('sessionPersistence') as SessionPersistenceLike | undefined
  if (persistence === undefined) return []
  try {
    const snapshots = await persistence.list()
    return snapshots
      .map(snapshot => snapshot.header)
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch (error) {
    ctx.logger.warn(
      `pi-tui: listing persisted sessions failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return []
  }
}

/** Display summary for one persisted session: its newest title and log size. */export interface SessionSummary {
  /** Newest non-empty `session/title` value in the durable log. */
  title?: string
  /** Number of events in the durable log. */
  events: number
}

/**
 * Summaries for the newest `limit` headers, keyed by session id. Loading full
 * logs is I/O, so callers bound it — boot/resume pickers pass the
 * already-sorted, already-capped header list.
 * @param ctx - TUI context with the session-persistence service.
 * @param headers - Session headers in newest-first order.
 * @param limit - Maximum number of headers to scan; defaults to 15.
 * @returns Summaries keyed by session id; sessions that fail to load are absent.
 */
export async function sessionSummaries(
  ctx: Context,
  headers: readonly SessionHeader[],
  limit = 15,
): Promise<Map<string, SessionSummary>> {
  const summaries = new Map<string, SessionSummary>()
  for (const header of headers.slice(0, limit)) {
    const id = String(header.id)
    try {
      const loaded = await loadPersistedSession(ctx, id)
      if (loaded === undefined) continue
      let title: string | undefined
      for (const event of [...loaded.events].reverse()) {
        // `session/title` is plugin-merged; read it structurally.
        const raw = event as { type?: string; data?: { title?: unknown } }
        if (raw.type !== 'session/title') continue
        if (typeof raw.data?.title !== 'string') continue
        if (raw.data.title === '') continue
        title = raw.data.title
        break
      }
      summaries.set(id, { events: loaded.events.length, ...(title !== undefined ? { title } : {}) })
    } catch {
      continue
    }
  }
  return summaries
}

/** A preset entry for the TUI pickers; `broken` carries the preset's load-failure reason. */
export interface PresetInfo {
  id: string
  trust?: 'system' | 'user'
  name?: string
  description?: string
  broken?: string
}

/** User presets for the TUI pickers, name-sorted.
 * @param ctx - TUI context with the preset service.
 * @returns Broken and system presets filtered out, sorted by name (id when unnamed);
 *   empty without the preset service or on failure.
 */
export async function listPresets(ctx: Context): Promise<PresetInfo[]> {
  const presets = ctx.get('agentPresets') as { list(): Promise<readonly PresetInfo[]> } | undefined
  if (presets === undefined) return []
  try {
    const all = await presets.list()
    return [...all]
      .filter(preset => preset.broken === undefined && preset.trust !== 'system')
      .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
  } catch {
    return []
  }
}

/** The reserved remote-execution path namespace, mirrored from
 * packages/workspace/workspace/src/remote-path.ts (that file is the
 * canonical constant; dsh-remote-machines/path.ts keeps the same value). */
const REMOTE_PATH_ROOT = '/__dsh_ssh__/'
const MACHINE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

/**
 * Build the machine-qualified session cwd that routes shell and file tools
 * onto a saved remote machine over SSH.
 * @param machineId - Saved machine identifier.
 * @param path - Absolute POSIX path on the machine; defaults to `/root`.
 * @returns the machine-qualified cwd for session meta.
 */
export function remoteCwd(machineId: string, path = '/root'): string {
  if (!MACHINE_ID_PATTERN.test(machineId)) {
    throw new Error(`pi-tui: invalid machine id ${JSON.stringify(machineId)}`)
  }
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `${REMOTE_PATH_ROOT}${machineId}/${parts.join('/')}`
}
