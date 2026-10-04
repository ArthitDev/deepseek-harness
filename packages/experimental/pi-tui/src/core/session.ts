/**
 * dsh agent/session plumbing: resolve-or-create an agent, list persisted
 * sessions. Mirrors cc-tui's resolveAgent semantics — resume falls back to
 * a fresh session and stays loud in the log.
 */
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import {
  buildForkSeed,
  SessionId,
  SessionLogOffset,
  SessionSeq,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import type { WorkspaceRegistryService } from './services.js'

/**
 * Synchronous snapshot of a live session's durable log for transcript replay.
 * The deprecated synchronous read stays the right accessor here: the TUI fold
 * renders boundary, tool-call, and header records that `surface.nodes`
 * (message-producing seqs only) would drop, and there is no other public
 * synchronous log read on the attached Session.
 */
export function replayEvents(session: {
  snapshotEvents(): readonly SessionEvent[]
}): readonly SessionEvent[] {
  return session.snapshotEvents()
}

export interface ResolvedAgent {
  agent: Agent
  handle?: AgentHandle
}

/** Session-creation metadata the TUI passes (cwd + optional agent preset). */
export interface SessionMeta {
  cwd: string
  agentPreset?: string
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
  try {
    const resolvedId = (await presets.resolve(presetId)).id
    return {
      agentPreset: resolvedId,
      setup: async (agentCtx) => {
        await presets.mount(agentCtx, resolvedId)
      },
    }
  } catch {
    return {}
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

/** Copy-pasteable resume command for a persisted session. */
export function resumeCommand(sessionId: string): string {
  return `dsh --profile pi-tui --resume ${sessionId}`
}

/**
 * Attach a freshly created/forked session to its cwd's workspace on the
 * FIRST durable event instead of at creation. A session that never produces
 * any event leaves nothing behind: the persistence backend already skips
 * zero-event sessions in `list()`, and this keeps the workspace record
 * empty too. `attachToWorkspace` still swallows its own errors.
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
    for (const event of loaded.events) {
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
  const composition = await composeSetup(ctx, meta.agentPreset)
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
  return { agent: created.agent, handle: created }
}

/**
 * Fork the agent's session at its current end and open a NEW agent over the
 * forked log (cc-tui's rewind pattern): lineage recorded, transcript kept,
 * fresh session id. The seed is built with the session fork primitive the
 * agent factory documents: an exact parent prefix, the inherited marker, and
 * synthetic closers for the open tail.
 */
export async function forkSession(
  ctx: Context,
  source: Agent,
  agentOptions: AgentOptions,
  meta: SessionMeta,
): Promise<ResolvedAgent> {
  const events = replayEvents(source.session)
  const lastSeq = events.length - 1
  const seed = lastSeq >= 0 ? buildForkSeed(events, SessionSeq(lastSeq)) : undefined
  const presets = ctx.get('agentPresets') as
    { composedPreset(agentCtx: Context): string | undefined } | undefined
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
      ...(seed !== undefined ? { isSeeded: true } : {}),
      ...(composition.agentPreset !== undefined ? { agentPreset: composition.agentPreset } : {}),
    },
    // The fork seed's inherited prefix is the copied source events; the
    // marker and synthetic closers after it belong to the child.
    ...(seed !== undefined ? { inheritedEventCount: SessionLogOffset(lastSeq + 1) } : {}),
    agentOptions,
    ...(composition.setup !== undefined ? { setup: composition.setup } : {}),
  })
  attachWorkspaceOnFirstEvent(ctx, childId, meta.cwd)
  return { agent: created.agent, handle: created }
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

/** Persisted session headers, newest first (dsh's own persistence backend). */
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

/**
 * Last `session/title` value in a persisted session's log, or undefined.
 * Mirrors `persistedPreset`'s bounded scan; the picker shows titles instead
 * of bare `basename(cwd)` labels.
 */
export async function persistedTitle(ctx: Context, id: string): Promise<string | undefined> {
  try {
    const loaded = await loadPersistedSession(ctx, id)
    if (loaded === undefined) return undefined
    for (const event of [...loaded.events].reverse()) {
      // `session/title` is plugin-merged; read it structurally.
      const raw = event as { type?: string; data?: { title?: unknown } }
      if (raw.type !== 'session/title') continue
      if (typeof raw.data?.title !== 'string') continue
      if (raw.data.title === '') continue
      return raw.data.title
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Titles for the newest `limit` headers, keyed by session id (sessions with
 * no title are absent). Loading full logs is I/O, so callers bound it —
 * boot/resume pickers pass the already-sorted, already-capped header list.
 */
export async function sessionTitles(
  ctx: Context,
  headers: readonly SessionHeader[],
  limit = 15,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  for (const header of headers.slice(0, limit)) {
    const id = String(header.id)
    const title = await persistedTitle(ctx, id)
    if (title !== undefined) titles.set(id, title)
  }
  return titles
}

export interface PresetInfo {
  id: string
  name?: string
  description?: string
  broken?: string
}

/** The agent-preset roster (标准/PTC 模式/极简/…), name-sorted. */
export async function listPresets(ctx: Context): Promise<PresetInfo[]> {
  const presets = ctx.get('agentPresets') as { list(): Promise<readonly PresetInfo[]> } | undefined
  if (presets === undefined) return []
  try {
    const all = await presets.list()
    return [...all]
      .filter(preset => preset.broken === undefined)
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
