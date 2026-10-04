import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  SESSION_FORMAT_VERSION,
  SessionId,
  SessionSeq,
  type Session,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import {
  attachWorkspaceOnFirstEvent,
  forkSession,
  listPresets,
  listSessions,
  loadPersistedSession,
  reconcileWorkspaceAttachments,
  remoteCwd,
  replayEvents,
  resolveAgent,
  resumeCommand,
  sessionTitles,
  type SessionMeta,
} from '../src/core/session.ts'

/** The generated session id inside one scripted `agents.create` input. */
const createdSessionId = (input: ScriptedAgentInput | undefined): SessionId =>
  input?.sessionId ?? SessionId('missing')

/** Settle the fire-and-forget workspace attach queue. */
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

function harness(services: Record<string, unknown> = {}): Context {
  const ctx = new Context()
  for (const [name, service] of Object.entries(services)) ctx.provide(name, service)
  return ctx
}

const meta = (cwd = '/tmp/workdir'): SessionMeta => ({ cwd })

const header = (id: string, createdAt: number, cwd?: string): SessionHeader => ({
  version: SESSION_FORMAT_VERSION,
  id: SessionId(id),
  createdAt,
  isSeeded: false,
  ...(cwd !== undefined ? { cwd } : {}),
})

const turnStart = (seq: number): SessionEvent<'turn/start'> => ({
  type: 'turn/start',
  seq: SessionSeq(seq),
  time: 0,
  data: { turn: 1 },
})

function silence(ctx: Context): void {
  vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  vi.spyOn(ctx.logger, 'info').mockImplementation(() => {})
}

function persistenceWith(
  sessions: Record<string, { header?: unknown; events?: unknown[] }>,
  options: { failOpen?: boolean; failList?: boolean } = {},
) {
  return {
    list: async () => {
      if (options.failList) throw new Error('list refused')
      return Object.entries(sessions).map(([id, session]) => ({
        header: session.header ?? { id, createdAt: 0 },
      }))
    },
    open: async (id: string, access: string) => {
      if (options.failOpen) throw new Error('open refused')
      const session = sessions[id]
      if (session === undefined) throw new Error(`unknown session ${id}`)
      if (access !== 'read') throw new Error('write access unsupported in the fake')
      let closed = false
      return {
        header: session.header ?? { id, createdAt: 0 },
        read: async () => {
          if (closed) throw new Error('read after close')
          return { events: session.events ?? [] }
        },
        close: async () => {
          closed = true
        },
      }
    },
  }
}

function workspaceRegistry(workspaces: Record<string, { sessionIds: string[]; failAttach?: boolean }>) {
  const attached: string[] = []
  const created: string[] = []
  return {
    attached,
    created,
    service: {
      resolveByPath: async (path: string) => {
        const entry = workspaces[path]
        if (entry === undefined) return undefined
        return {
          path,
          sessionIds: entry.sessionIds,
          attachSession: async (sessionId: string) => {
            if (entry.failAttach) throw new Error('attach refused')
            entry.sessionIds.push(sessionId)
            attached.push(sessionId)
          },
        }
      },
      create: async (path: string) => {
        created.push(path)
        const entry = { sessionIds: [] as string[], failAttach: false }
        workspaces[path] = entry
        return {
          path,
          sessionIds: entry.sessionIds,
          attachSession: async (sessionId: string) => {
            entry.sessionIds.push(sessionId)
            attached.push(sessionId)
          },
        }
      },
    },
  }
}

interface ScriptedAgentInput {
  sessionId?: SessionId
  setup?: (agentCtx: unknown) => Promise<void>
  seed?: unknown
  inheritedEventCount?: number
  meta?: Record<string, unknown>
}

function agentsService() {
  const calls = {
    resume: [] as ScriptedAgentInput[],
    create: [] as ScriptedAgentInput[],
  }
  const handle = (name: string) => ({
    agent: { id: SessionId(`${name}-session`) },
    dispose: async () => {},
  })
  const runSetup = async (input: ScriptedAgentInput): Promise<void> => {
    if (input.setup !== undefined) await input.setup({})
  }
  return {
    calls,
    service: {
      get: (id: unknown) => (String(id) === 'live-session' ? { id: SessionId('live-session') } : undefined),
      resume: async (input: Record<string, unknown>) => {
        calls.resume.push(input)
        await runSetup(input)
        return handle('resumed')
      },
      create: async (input: Record<string, unknown>) => {
        calls.create.push(input)
        await runSetup(input)
        return handle('created')
      },
    },
  }
}

/** Fire the harness's `session/event` announcement for one session id. */
const announce = (ctx: Context, id: SessionId): void => {
  ctx.emit('session/event', { id } as Session, turnStart(1))
}

describe('replayEvents', () => {
  it('snapshots the durable log synchronously', () => {
    const events = [turnStart(0)]
    expect(replayEvents({ snapshotEvents: () => events })).toBe(events)
  })
})

describe('resumeCommand', () => {
  it('renders the copy-pasteable resume invocation', () => {
    expect(resumeCommand('abc')).toBe('dsh --profile pi-tui --resume abc')
  })
})

describe('remoteCwd', () => {
  it('qualifies the default path under the machine namespace', () => {
    expect(remoteCwd('box-1')).toBe('/__dsh_ssh__/box-1/root')
  })

  it('normalizes dot segments, empty segments, and parent traversals', () => {
    expect(remoteCwd('box-1', '/a/./b/../c//')).toBe('/__dsh_ssh__/box-1/a/c')
    expect(remoteCwd('box-1', '/')).toBe('/__dsh_ssh__/box-1/')
  })

  it('rejects a machine id outside the reserved namespace grammar', () => {
    expect(() => remoteCwd('Box_1')).toThrow('invalid machine id')
  })
})

describe('attachWorkspaceOnFirstEvent', () => {
  it('does nothing without a cwd or a registry', () => {
    const bare = harness()
    expect(() => {
      attachWorkspaceOnFirstEvent(bare, SessionId('s1'), undefined)
    }).not.toThrow()
    const registry = workspaceRegistry({})
    const ctx = harness({ workspaceRegistry: registry.service })
    attachWorkspaceOnFirstEvent(ctx, SessionId('s1'), '')
    announce(ctx, SessionId('s1'))
    expect(registry.attached).toEqual([])
  })

  it('attaches the session on its first durable event', async () => {
    const registry = workspaceRegistry({})
    const ctx = harness({ workspaceRegistry: registry.service })
    const sessionId = SessionId('first-event')
    attachWorkspaceOnFirstEvent(ctx, sessionId, '/tmp/first')
    announce(ctx, SessionId('other'))
    expect(registry.created).toEqual([])
    announce(ctx, sessionId)
    await tick()
    expect(registry.created).toEqual(['/tmp/first'])
    expect(registry.attached).toEqual(['first-event'])
  })

  it('reuses an existing workspace without creating one', async () => {
    const registry = workspaceRegistry({ '/tmp/existing': { sessionIds: [] } })
    const ctx = harness({ workspaceRegistry: registry.service })
    const sessionId = SessionId('first-event')
    attachWorkspaceOnFirstEvent(ctx, sessionId, '/tmp/existing')
    announce(ctx, sessionId)
    await tick()
    expect(registry.created).toEqual([])
    expect(registry.attached).toEqual(['first-event'])
  })

  it('warns when the workspace attach fails', async () => {
    const registry = workspaceRegistry({})
    registry.service.resolveByPath = async () => {
      throw new Error('registry offline')
    }
    const ctx = harness({ workspaceRegistry: registry.service })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    attachWorkspaceOnFirstEvent(ctx, SessionId('first-event'), '/tmp/first')
    announce(ctx, SessionId('first-event'))
    await tick()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('workspace attach for "first-event" failed: registry offline'))
  })

  it('stringifies non-Error attach failures', async () => {
    const registry = workspaceRegistry({})
    registry.service.resolveByPath = async () => {
      throw 'registry string failure'
    }
    const ctx = harness({ workspaceRegistry: registry.service })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    attachWorkspaceOnFirstEvent(ctx, SessionId('first-event'), '/tmp/first')
    announce(ctx, SessionId('first-event'))
    await tick()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('registry string failure'))
  })

  it('stays quiet when the registry disappeared before the first event', async () => {
    const registry = workspaceRegistry({})
    const ctx = new Context()
    const disposeRegistry = ctx.provide('workspaceRegistry', registry.service)
    const sessionId = SessionId('late-event')
    attachWorkspaceOnFirstEvent(ctx, sessionId, '/tmp/late')
    disposeRegistry()
    announce(ctx, sessionId)
    await tick()
    expect(registry.created).toEqual([])
  })
})

describe('reconcileWorkspaceAttachments', () => {
  it('is a no-op without the registry or persistence services', async () => {
    await expect(reconcileWorkspaceAttachments(harness())).resolves.toBe(0)
    const registry = workspaceRegistry({})
    await expect(
      reconcileWorkspaceAttachments(harness({ workspaceRegistry: registry.service })),
    ).resolves.toBe(0)
  })

  it('re-attaches persisted sessions missing from their cwd workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-tui-reconcile-'))
    const cwd = join(root, 'project')
    await mkdir(cwd)
    const registry = workspaceRegistry({ [cwd]: { sessionIds: ['other-session'] } })
    const ctx = harness({
      workspaceRegistry: registry.service,
      sessionPersistence: persistenceWith({
        attached: { header: { id: 'attached', createdAt: 1, cwd } },
        cwdless: { header: { id: 'cwdless', createdAt: 2 } },
        vanished: { header: { id: 'vanished', createdAt: 3, cwd: join(root, 'gone') } },
        outside: { header: { id: 'outside', createdAt: 4, cwd: join(root, 'unknown-place') } },
      }),
    })
    silence(ctx)
    await expect(reconcileWorkspaceAttachments(ctx)).resolves.toBe(1)
    expect(registry.attached).toEqual(['attached'])
  })

  it('skips sessions already present in the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-tui-reconcile-'))
    const cwd = join(root, 'project')
    await mkdir(cwd)
    const registry = workspaceRegistry({ [cwd]: { sessionIds: ['member'] } })
    const ctx = harness({
      workspaceRegistry: registry.service,
      sessionPersistence: persistenceWith({ member: { header: { id: 'member', createdAt: 1, cwd } } }),
    })
    silence(ctx)
    await expect(reconcileWorkspaceAttachments(ctx)).resolves.toBe(0)
    expect(registry.attached).toEqual([])
  })

  it('skips sessions whose cwd has no workspace yet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-tui-reconcile-'))
    const cwd = join(root, 'project')
    await mkdir(cwd)
    const registry = workspaceRegistry({})
    const ctx = harness({
      workspaceRegistry: registry.service,
      sessionPersistence: persistenceWith({ orphan: { header: { id: 'orphan', createdAt: 1, cwd } } }),
    })
    silence(ctx)
    await expect(reconcileWorkspaceAttachments(ctx)).resolves.toBe(0)
    expect(registry.created).toEqual([])
    expect(registry.attached).toEqual([])
  })

  it('returns zero and warns when the persistence listing fails', async () => {
    const registry = workspaceRegistry({})
    const ctx = harness({
      workspaceRegistry: registry.service,
      sessionPersistence: persistenceWith({}, { failList: true }),
    })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await expect(reconcileWorkspaceAttachments(ctx)).resolves.toBe(0)
    expect(warn).toHaveBeenCalled()
  })

  it('returns zero and warns with a stringified failure when the listing throws a non-Error', async () => {
    const registry = workspaceRegistry({})
    const persistence = persistenceWith({}, { failList: true })
    persistence.list = async () => {
      throw 'plain string failure'
    }
    const ctx = harness({ workspaceRegistry: registry.service, sessionPersistence: persistence })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await expect(reconcileWorkspaceAttachments(ctx)).resolves.toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('plain string failure'))
  })

  it('returns zero and warns when a workspace attach fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-tui-reconcile-'))
    const cwd = join(root, 'project')
    await mkdir(cwd)
    const registry = workspaceRegistry({ [cwd]: { sessionIds: [], failAttach: true } })
    const ctx = harness({
      workspaceRegistry: registry.service,
      sessionPersistence: persistenceWith({ failing: { header: { id: 'failing', createdAt: 1, cwd } } }),
    })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await expect(reconcileWorkspaceAttachments(ctx)).resolves.toBe(0)
    expect(warn).toHaveBeenCalled()
  })
})

describe('resolveAgent', () => {
  it('attaches to a live agent without resuming', async () => {
    const agents = agentsService()
    const ctx = harness({ agents: agents.service })
    const resolved = await resolveAgent(ctx, 'live-session', {}, meta())
    expect(resolved.agent.id).toBe(SessionId('live-session'))
    expect(resolved.handle).toBeUndefined()
    expect(agents.calls.resume).toEqual([])
    expect(agents.calls.create).toEqual([])
  })

  it('resumes a persisted session and mounts its recorded preset', async () => {
    const agents = agentsService()
    const mounted: string[] = []
    const ctx = harness({
      agents: agents.service,
      sessionPersistence: persistenceWith({
        'preset-session': {
          header: { id: 'preset-session', createdAt: 1 },
          events: [{ type: 'agent-preset/selected', data: { agentPreset: 'raw-preset' } }],
        },
      }),
      agentPresets: {
        resolve: async (id: string) => ({ id: `resolved-${id}` }),
        mount: async (_agentCtx: unknown, id: string) => {
          mounted.push(id)
        },
      },
    })
    silence(ctx)
    const resolved = await resolveAgent(ctx, 'preset-session', { model: 'm1' }, meta())
    expect(resolved.agent.id).toBe(SessionId('resumed-session'))
    expect(mounted).toEqual(['resolved-raw-preset'])
    expect(agents.calls.resume[0]).toMatchObject({
      resumeSessionId: SessionId('preset-session'),
      agentOptions: { model: 'm1' },
    })
    expect(agents.calls.create).toEqual([])
  })

  it('resumes without composing when the session records no preset', async () => {
    const agents = agentsService()
    const ctx = harness({
      agents: agents.service,
      sessionPersistence: persistenceWith({
        'plain-session': {
          header: { id: 'plain-session', createdAt: 1, agentPreset: 'header-preset' },
          events: [],
        },
      }),
    })
    silence(ctx)
    await resolveAgent(ctx, 'plain-session', {}, meta())
    expect(agents.calls.resume[0]).not.toHaveProperty('setup')
  })

  it('falls back to the header preset when the recorded events carry none', async () => {
    const agents = agentsService()
    const ctx = harness({
      agents: agents.service,
      sessionPersistence: persistenceWith({
        'header-preset-session': {
          header: { id: 'header-preset-session', createdAt: 1, agentPreset: 'header-preset' },
          events: [{ type: 'session/title', data: { title: 'unrelated' } }],
        },
      }),
    })
    silence(ctx)
    await resolveAgent(ctx, 'header-preset-session', {}, meta())
    expect(agents.calls.resume[0]).toMatchObject({ resumeSessionId: SessionId('header-preset-session') })
    expect(agents.calls.resume[0]).not.toHaveProperty('setup')
  })

  it('starts fresh from an unreadable persistence probe', async () => {
    const agents = agentsService()
    const ctx = harness({
      agents: agents.service,
      sessionPersistence: persistenceWith({}, { failOpen: true }),
    })
    silence(ctx)
    await resolveAgent(ctx, 'any-session', {}, meta())
    expect(agents.calls.resume).toHaveLength(1)
    expect(agents.calls.resume[0]).not.toHaveProperty('setup')
  })

  it('falls back to a fresh create when the resume fails', async () => {
    const agents = agentsService()
    agents.service.resume = async () => {
      throw new Error('log unreadable')
    }
    const ctx = harness({ agents: agents.service })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const resolved = await resolveAgent(ctx, 'ghost-session', { provider: 'p1' }, meta('/tmp/fresh'))
    expect(resolved.agent.id).toBe(SessionId('created-session'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('resume of "ghost-session" failed'))
    expect(agents.calls.create).toHaveLength(1)
    expect(agents.calls.create[0]).toMatchObject({ meta: { cwd: '/tmp/fresh' }, agentOptions: { provider: 'p1' } })
  })

  it('starts fresh when the persistence probe is unavailable', async () => {
    const agents = agentsService()
    const ctx = harness({ agents: agents.service })
    silence(ctx)
    await resolveAgent(ctx, 'plain-session', {}, meta())
    expect(agents.calls.resume).toHaveLength(1)
  })

  it('creates a fresh session with a composed preset and defers the workspace attach', async () => {
    const registry = workspaceRegistry({})
    const agents = agentsService()
    const mounted: string[] = []
    const ctx = harness({
      agents: agents.service,
      workspaceRegistry: registry.service,
      agentPresets: {
        resolve: async (id: string) => ({ id }),
        mount: async (_agentCtx: unknown, id: string) => {
          mounted.push(id)
        },
      },
    })
    silence(ctx)
    const resolved = await resolveAgent(ctx, undefined, {}, { cwd: '/tmp/new-dir', agentPreset: 'standard' })
    expect(resolved.agent.id).toBe(SessionId('created-session'))
    expect(mounted).toEqual(['standard'])
    expect(createdSessionId(agents.calls.create[0])).toMatch(/^[0-9a-f-]{36}$/)
    expect(agents.calls.create[0]).toMatchObject({
      meta: { cwd: '/tmp/new-dir', agentPreset: 'standard' },
    })
    expect(registry.created).toEqual([])
    // The first durable event carries the session id resolveAgent generated.
    announce(ctx, createdSessionId(agents.calls.create[0]))
    await tick()
    expect(registry.created).toEqual(['/tmp/new-dir'])
    expect(registry.attached).toEqual([String(agents.calls.create[0]?.sessionId)])
  })

  it('stringifies non-Error resume failures in the fallback warning', async () => {
    const agents = agentsService()
    agents.service.resume = async () => {
      throw 'resume string failure'
    }
    const ctx = harness({ agents: agents.service })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await resolveAgent(ctx, 'ghost-session', {}, meta())
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('resume string failure'))
    expect(agents.calls.create).toHaveLength(1)
  })

  it('fails loud when the fresh create fails', async () => {
    const agents = agentsService()
    agents.service.create = async () => {
      throw new Error('disk full')
    }
    const ctx = harness({ agents: agents.service })
    silence(ctx)
    await expect(resolveAgent(ctx, undefined, {}, meta())).rejects.toThrow(
      'pi-tui: failed to create agent (provider=deepseek-official): disk full',
    )
  })

  it('fails loud with a stringified create failure and the explicit provider', async () => {
    const agents = agentsService()
    agents.service.create = async () => {
      throw 'create string failure'
    }
    const ctx = harness({ agents: agents.service })
    silence(ctx)
    await expect(resolveAgent(ctx, undefined, { provider: 'p1' }, meta())).rejects.toThrow(
      'pi-tui: failed to create agent (provider=p1): create string failure',
    )
  })

  it('keeps composing when the preset resolver refuses (best effort)', async () => {
    const agents = agentsService()
    const ctx = harness({
      agents: agents.service,
      agentPresets: {
        resolve: async () => {
          throw new Error('preset gone')
        },
        mount: async () => {},
      },
    })
    silence(ctx)
    const resolved = await resolveAgent(ctx, undefined, {}, { cwd: '/tmp/x', agentPreset: 'gone' })
    expect(agents.calls.create[0]).toMatchObject({ meta: { cwd: '/tmp/x' } })
    expect(agents.calls.create[0]).not.toHaveProperty('setup')
    expect(resolved.handle).toBeDefined()
  })
})

describe('forkSession', () => {
  it('forks an empty session without a seed', async () => {
    const agents = agentsService()
    const ctx = harness({ agents: agents.service })
    const source = {
      session: { id: SessionId('source-empty'), snapshotEvents: (): readonly SessionEvent[] => [] },
      ctx,
    } as Agent
    silence(ctx)
    const resolved = await forkSession(ctx, source, {}, meta('/tmp/fork'))
    expect(resolved.agent.id).toBe(SessionId('created-session'))
    expect(agents.calls.create[0]).not.toHaveProperty('seed')
    expect(agents.calls.create[0]?.meta).toMatchObject({
      parentSession: SessionId('source-empty'),
      cwd: '/tmp/fork',
    })
  })

  it('seeds the child with the source prefix and the composed preset', async () => {
    const agents = agentsService()
    const ctx = harness({
      agents: agents.service,
      agentPresets: {
        composedPreset: () => 'forked-preset',
        resolve: async (id: string) => ({ id }),
        mount: async () => {},
      },
    })
    const source = {
      session: {
        id: SessionId('source-full'),
        snapshotEvents: (): readonly SessionEvent[] => [turnStart(0)],
      },
      ctx,
    } as Agent
    silence(ctx)
    await forkSession(ctx, source, {}, meta('/tmp/fork'))
    const created = agents.calls.create[0]
    expect(created?.seed).toBeDefined()
    expect(created?.inheritedEventCount).toBe(1)
    expect(created?.meta).toMatchObject({
      parentSession: SessionId('source-full'),
      isSeeded: true,
      agentPreset: 'forked-preset',
    })
  })
})

describe('loadPersistedSession', () => {
  it('reads a session through a borrowed read handle and closes it', async () => {
    const persistence = persistenceWith({
      s1: { header: { id: 's1', createdAt: 5 }, events: [turnStart(0)] },
    })
    const ctx = harness({ sessionPersistence: persistence })
    const loaded = await loadPersistedSession(ctx, 's1')
    expect(loaded?.events).toHaveLength(1)
    expect(loaded?.header).toMatchObject({ id: 's1' })
  })

  it('returns undefined when persistence is unavailable', async () => {
    await expect(loadPersistedSession(harness(), 's1')).resolves.toBeUndefined()
  })
})

describe('listSessions', () => {
  it('lists persisted headers newest first', async () => {
    const ctx = harness({
      sessionPersistence: persistenceWith({
        older: { header: header('older', 1) },
        newer: { header: header('newer', 99) },
      }),
    })
    const headers = await listSessions(ctx)
    expect(headers.map(entry => String(entry.id))).toEqual(['newer', 'older'])
  })

  it('returns an empty list without persistence and on listing failures', async () => {
    await expect(listSessions(harness())).resolves.toEqual([])
    const ctx = harness({ sessionPersistence: persistenceWith({}, { failList: true }) })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await expect(listSessions(ctx)).resolves.toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it('stringifies non-Error listing failures', async () => {
    const persistence = persistenceWith({}, { failList: true })
    persistence.list = async () => {
      throw 'listing string failure'
    }
    const ctx = harness({ sessionPersistence: persistence })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await expect(listSessions(ctx)).resolves.toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('listing string failure'))
  })
})

describe('sessionTitles', () => {
  it('maps the last title per session over the newest headers only', async () => {
    const ctx = harness({
      sessionPersistence: persistenceWith({
        titled: {
          header: header('titled', 1),
          events: [
            { type: 'session/title', data: { title: 'first' } },
            { type: 'session/title', data: { title: 'second' } },
          ],
        },
        untitled: { header: header('untitled', 2), events: [] },
      }),
    })
    const titles = await sessionTitles(ctx, [header('untitled', 2), header('titled', 1)])
    expect(titles.get('titled')).toBe('second')
    expect(titles.has('untitled')).toBe(false)
  })

  it('ignores malformed title events and keeps scanning to the latest valid one', async () => {
    const ctx = harness({
      sessionPersistence: persistenceWith({
        titled: {
          header: header('titled', 1),
          events: [
            { type: 'session/title', data: { title: 'current' } },
            { type: 'session/title', data: { title: '' } },
            { type: 'session/title', data: { title: 5 } },
            { type: 'session/title' },
            { type: 'turn/start', data: { turn: 1 } },
          ],
        },
      }),
    })
    const titles = await sessionTitles(ctx, [header('titled', 1)])
    expect(titles.get('titled')).toBe('current')
  })

  it('answers nothing for sessions persistence cannot load', async () => {
    const titles = await sessionTitles(harness(), [header('ghost', 1)])
    expect(titles.size).toBe(0)
  })

  it('answers nothing for unreadable sessions without failing', async () => {
    const ctx = harness({ sessionPersistence: persistenceWith({}, { failOpen: true }) })
    silence(ctx)
    const titles = await sessionTitles(ctx, [header('ghost', 1)])
    expect(titles.size).toBe(0)
  })
})

describe('listPresets', () => {
  it('sorts the roster by name and drops broken presets', async () => {
    const ctx = harness({
      agentPresets: {
        list: async () => [
          { id: 'zeta', name: 'Zeta' },
          { id: 'broken-one', broken: 'unloadable' },
          { id: 'alpha', name: 'Alpha' },
          { id: 'mid' },
          { id: 'early' },
        ],
      },
    })
    const presets = await listPresets(ctx)
    expect(presets.map(preset => preset.id)).toEqual(['alpha', 'early', 'mid', 'zeta'])
  })

  it('returns an empty roster without the service and on listing failures', async () => {
    await expect(listPresets(harness())).resolves.toEqual([])
    const ctx = harness({
      agentPresets: {
        list: async () => {
          throw new Error('roster gone')
        },
      },
    })
    await expect(listPresets(ctx)).resolves.toEqual([])
  })
})
