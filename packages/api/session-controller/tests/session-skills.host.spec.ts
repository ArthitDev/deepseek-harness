import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-skill'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionSkillCatalog } from '../src/skill-catalog.ts'

function observation(
  sessionId: SessionId,
  options: { readonly cwd?: string; readonly workingDirectory?: string | null; readonly agentPreset?: string } = {},
): SessionObservation {
  const events = Object.freeze([])
  const lease = (): SessionObservation => ({
    source: 'live',
    header: {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 1,
      isSeeded: false,
      ...options.cwd === undefined ? {} : { cwd: options.cwd },
    },
    events,
    inheritedEventCount: SessionLogOffset(0),
    cursor: -1,
    projections: {
      asOfSeq: -1,
      values: {
        ...options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset },
        ...options.workingDirectory === undefined ? {} : { workingDirectory: options.workingDirectory },
      },
    },
    retain: lease,
    [Symbol.dispose]: () => {},
  })
  return lease()
}

async function context(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  provideWorkingDirectoryFixture(ctx, '/catalog/default')
  return ctx
}

describe('SessionSkillCatalog', () => {
  it('reads a moved cold Session catalog from its recorded current directory without resuming an Agent', async () => {
    const ctx = await context()
    const sessionId = SessionId('cold-skills')
    const observed = observation(sessionId, { cwd: '/cold/original', workingDirectory: '/cold/project' })
    const dispose = vi.spyOn(observed, Symbol.dispose)
    const observeSession = vi.fn(() => Promise.resolve(observed))
    ctx.provide('sessionQuery', { observeSession } as never)
    const resume = vi.spyOn(ctx.agents, 'resume')
    const ensureDirectory = vi.spyOn(ctx.workingDirectory, 'ensure')
    const list = vi.fn(() => Promise.resolve([
      {
        name: 'review',
        description: 'Review the current change.',
        whenToUse: 'Before publishing.',
        path: '/cold/project/.agents/skills/review/SKILL.md',
        invocation: { modelInvocable: true, userInvocable: true },
      },
      {
        name: 'model-only',
        description: 'Not shown to the user.',
        invocation: { modelInvocable: true, userInvocable: false },
      },
    ]))
    ctx.provide('skills', { list } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({
      skills: [{
        name: 'review',
        description: 'Review the current change.',
        whenToUse: 'Before publishing.',
        path: '/cold/project/.agents/skills/review/SKILL.md',
        modelInvocable: true,
      }],
    })
    expect(observeSession).toHaveBeenCalledWith(sessionId)
    expect(dispose).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
    expect(ensureDirectory).not.toHaveBeenCalled()
    expect(ctx.agents.list()).toEqual([])
    expect(list).toHaveBeenCalledWith({ cwd: '/cold/project', scope: undefined })
  })

  it.each([
    { cwd: undefined, workingDirectory: '/cold/current', expected: '/cold/current' },
    { cwd: '/cold/original', workingDirectory: null, expected: '/cold/original' },
    { cwd: undefined, workingDirectory: null, expected: '/catalog/default' },
    { cwd: undefined, workingDirectory: undefined, expected: '/catalog/default' },
  ])('resolves cold directory metadata $cwd / $workingDirectory to $expected without filesystem checks', async ({ cwd, workingDirectory, expected }) => {
    const ctx = await context()
    try {
      const sessionId = SessionId('cold-directory-fallback')
      ctx.provide('sessionQuery', {
        observeSession: () => Promise.resolve(observation(sessionId, {
          ...cwd === undefined ? {} : { cwd },
          ...workingDirectory === undefined ? {} : { workingDirectory },
        })),
      } as never)
      const list = vi.fn(() => Promise.resolve([]))
      ctx.provide('skills', { list } as never)
      const ensure = vi.spyOn(ctx.workingDirectory, 'ensure')
      const resume = vi.spyOn(ctx.agents, 'resume')
      await expect(new SessionSkillCatalog(ctx).list({ sessionId }, new AbortController().signal))
        .resolves.toEqual({ skills: [] })
      expect(list).toHaveBeenCalledWith({ cwd: expected, scope: undefined })
      expect(ensure).not.toHaveBeenCalled()
      expect(resume).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('uses a live Agent to address a preset-owned registry', async () => {
    const ctx = await context()
    const sessionId = SessionId('live-skills')
    const session = ctx.sessions.create(sessionId, { meta: { cwd: '/live/project' } })
    const agent = { id: sessionId, session, status: 'idle', ctx } as Agent
    await ctx.agents.register(agent)
    const ensureDirectory = vi.spyOn(ctx.workingDirectory, 'ensure').mockResolvedValue('/live/current')
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd: '/live/project' })),
    } as never)
    const scopedList = vi.fn(() => Promise.resolve([{
      name: 'preset-owned',
      description: 'Composed for this Agent.',
      invocation: { modelInvocable: false, userInvocable: true },
    }]))
    const acquireScope = vi.fn()
    ctx.provide('agentPresets', {
      serviceFor: () => ({ list: scopedList }),
      acquireScope,
    } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({
      skills: [{
        name: 'preset-owned',
        description: 'Composed for this Agent.',
        modelInvocable: false,
      }],
    })
    expect(scopedList).toHaveBeenCalledWith({ cwd: '/live/current', scope: agent })
    expect(ensureDirectory).toHaveBeenCalledWith(agent, expect.any(AbortSignal))
    expect(session.header.cwd).toBe('/live/project')
    expect(acquireScope).not.toHaveBeenCalled()
  })

  it('uses the recorded preset standing scope for a cold Session', async () => {
    const ctx = await context()
    const sessionId = SessionId('standing-skills')
    const scope = { agentPreset: 'minimal' }
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, {
        cwd: '/cold/project',
        agentPreset: 'minimal',
      })),
    } as never)
    const acquireScope = vi.fn(() => Promise.resolve({ key: scope, [Symbol.asyncDispose]: async () => {} }))
    ctx.provide('agentPresets', { acquireScope } as never)
    const list = vi.fn(() => Promise.resolve([]))
    ctx.provide('skills', { list } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({ skills: [] })
    expect(acquireScope).toHaveBeenCalledWith('minimal')
    expect(list).toHaveBeenCalledWith({ cwd: '/cold/project', scope })
    expect(ctx.agents.list()).toEqual([])
  })

  it('falls back to the global registry when the recorded preset is unavailable', async () => {
    const ctx = await context()
    const sessionId = SessionId('gone-preset')
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, {
        cwd: '/cold/project',
        agentPreset: 'gone',
      })),
    } as never)
    ctx.provide('agentPresets', {
      acquireScope: () => Promise.reject(new Error('unknown preset')),
    } as never)
    const list = vi.fn(() => Promise.resolve([]))
    ctx.provide('skills', { list } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({ skills: [] })
    expect(list).toHaveBeenCalledWith({ cwd: '/cold/project', scope: undefined })
  })

  it.each([
    {
      error: new SessionQueryError(
        'session "missing-skills" not found',
        'SESSION_QUERY_SESSION_NOT_FOUND',
      ),
      code: 'session/not-found',
    },
    { error: new Error('storage offline'), code: 'gateway/internal' },
  ] as const)('classifies failed Session inspection as $code', async ({ error, code }) => {
    const ctx = await context()
    ctx.provide('sessionQuery', { observeSession: () => Promise.reject(error) } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list(
      { sessionId: SessionId('missing-skills') },
      new AbortController().signal,
    )).rejects.toMatchObject({ code })
  })

  it('reports an absent skill registry instead of an empty catalog', async () => {
    const ctx = await context()
    const sessionId = SessionId('no-skills')
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd: '/project' })),
    } as never)
    const catalog = new SessionSkillCatalog(ctx)

    const failed = catalog.list({ sessionId }, new AbortController().signal)
    await expect(failed).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(failed).rejects.toThrow('skill registry is absent')
  })

  it('rejects observations without projections', async () => {
    const ctx = await context()
    const sessionId = SessionId('incomplete-skills')
    const withoutProjections = { ...observation(sessionId, { cwd: '/project' }), projections: undefined }
    const observeSession = vi.fn()
      .mockResolvedValueOnce(withoutProjections)
    ctx.provide('sessionQuery', { observeSession } as never)
    const catalog = new SessionSkillCatalog(ctx)

    const unprojected = catalog.list({ sessionId }, new AbortController().signal)
    await expect(unprojected).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(unprojected).rejects.toThrow('projected Session observation')
  })

  it('classifies a provider listing failure', async () => {
    const ctx = await context()
    const sessionId = SessionId('failed-skills')
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd: '/project' })),
    } as never)
    ctx.provide('skills', {
      list: () => Promise.reject(new Error('catalog offline')),
    } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal))
      .rejects.toMatchObject({
        code: 'gateway/internal', message: 'skill listing failed: Error: catalog offline',
      })
  })
})

describe('SessionSkillCatalog user-global management', () => {
  const roots: string[] = []
  const contextsForCleanup: Context[] = []
  const contexts = async (): Promise<Context> => {
    const ctx = await context()
    contextsForCleanup.push(ctx)
    return ctx
  }
  const home = async (): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-skill-catalog-'))
    roots.push(dir)
    return dir
  }
  afterEach(async () => {
    for (const ctx of contextsForCleanup.splice(0).reverse()) await ctx.fiber.dispose()
    for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  const install = async (root: string, name: string, disabled = false): Promise<string> => {
    const dir = join(root, disabled ? 'disabled-skills' : 'skills', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), `# ${name}\n`)
    return dir
  }

  it('lists, moves, and removes installed skills against the user-global roots', async () => {
    const dshHome = await home()
    await install(dshHome, 'zebra')
    await install(dshHome, 'alpha', true)
    const catalog = new SessionSkillCatalog(await contexts(), { dshHome })

    await expect(catalog.installed()).resolves.toEqual({
      skills: [{ name: 'alpha', enabled: false }, { name: 'zebra', enabled: true }],
    })

    await expect(catalog.setEnabled({ name: 'alpha', enabled: true })).resolves.toEqual({
      name: 'alpha', enabled: true,
    })
    await expect(catalog.installed()).resolves.toEqual({
      skills: [{ name: 'alpha', enabled: true }, { name: 'zebra', enabled: true }],
    })
    await expect(catalog.setEnabled({ name: 'missing', enabled: false }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })

    await expect(catalog.remove({ name: 'zebra' })).resolves.toEqual({ name: 'zebra', removed: true })
    await expect(catalog.remove({ name: 'zebra' })).resolves.toEqual({ name: 'zebra', removed: false })
    const backups = await readdir(join(dshHome, 'skill-backups'))
    expect(backups).toHaveLength(1)
    expect(await readdir(join(dshHome, 'skill-backups', backups[0]!))).toContain('zebra')
  })

  it('searches the catalog through the maintained skills CLI and parses stable identifiers', async () => {
    const runCli = vi.fn(() => Promise.resolve(
      '\u001B[1m best \u001B[0m owner/repo@pentest and other/src@pentest plus owner/repo@pentest again\n',
    ))
    const catalog = new SessionSkillCatalog(await contexts(), { dshHome: await home(), runCli })

    await expect(catalog.search({ query: '  pentest ' }, new AbortController().signal)).resolves.toEqual({
      skills: [
        { source: 'owner/repo@pentest', name: 'pentest', url: 'https://skills.sh/owner/repo/pentest' },
        { source: 'other/src@pentest', name: 'pentest', url: 'https://skills.sh/other/src/pentest' },
      ],
    })
    expect(runCli).toHaveBeenCalledWith(
      ['--yes', 'skills', 'find', 'pentest'],
      expect.any(String),
      expect.any(AbortSignal),
    )
    await expect(catalog.search({ query: '' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
  })

  it('installs one staged skills.sh source with a backup when replacing', async () => {
    const dshHome = await home()
    await install(dshHome, 'pentest')
    const runCli = vi.fn(async (_args: readonly string[], cwd: string) => {
      await mkdir(join(cwd, '.agents', 'skills', 'pentest'), { recursive: true })
      await writeFile(join(cwd, '.agents', 'skills', 'pentest', 'SKILL.md'), '# replaced\n')
      return ''
    })
    const catalog = new SessionSkillCatalog(await contexts(), { dshHome, runCli })

    await expect(catalog.install({ source: 'owner/repo@pentest' }, new AbortController().signal)).resolves.toEqual({
      installed: ['pentest'], backedUp: ['pentest'],
    })
    expect(await readFile(join(dshHome, 'skills', 'pentest', 'SKILL.md'), 'utf8')).toBe('# replaced\n')
    await expect(catalog.install({ source: 'not-a-source' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
  })

  it('runs one confirmed command in a host terminal and streams its output', async () => {
    const written: string[] = []
    let resolver: ((outcome: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | undefined
    const output = new Readable({ read() {} })
    const handle = {
      pid: 4242,
      output,
      done: new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => { resolver = resolve }),
      write: (data: string) => { written.push(data); return Promise.resolve() },
      resize: () => Promise.resolve(),
      inspectForeground: () => Promise.resolve(undefined),
      inspectActivity: () => Promise.resolve({ state: 'unknown', revision: 0 }),
      signalForeground: () => Promise.reject(new Error('unused')),
      terminate: () => Promise.resolve(),
    }
    const spawnTerminal = vi.fn(() => Promise.resolve(handle))
    const ctx = await contexts()
    ctx.provide('subprocess', {
      resolveExecutable: (command: string) => Promise.resolve(command),
      spawnTerminal,
    } as never)
    const catalog = new SessionSkillCatalog(ctx, { dshHome: await home() })

    const { id } = await catalog.terminalOpen({ command: 'npx skills find pentest' }, new AbortController().signal)
    expect(written).toEqual(['npx skills find pentest\r'])
    output.push('hello ')
    output.push('world')
    await new Promise(resolve => setImmediate(resolve))
    expect(catalog.terminalRead({ id, offset: 0 })).toMatchObject({
      text: 'hello world', nextOffset: 11, lossy: false, exited: false,
    })
    await expect(catalog.terminalWrite({ id, text: 'y\r' })).resolves.toEqual({ accepted: true })
    expect(written).toEqual(['npx skills find pentest\r', 'y\r'])
    output.push('done')
    output.emit('end')
    resolver?.({ exitCode: 0, signal: null })
    await handle.done
    await new Promise(resolve => setImmediate(resolve))
    expect(catalog.terminalRead({ id, offset: 11 })).toMatchObject({
      text: 'done', exited: true, exitCode: 0,
    })
    await expect(catalog.terminalClose({ id })).resolves.toEqual({ closed: true })
    await expect(catalog.terminalClose({ id })).resolves.toEqual({ closed: false })
    expect(() => catalog.terminalRead({ id: 'gone', offset: 0 })).toThrow(/terminal was not found/)
  })

  it('publishes the catalog and management Remotes under the skills namespace', async () => {
    const catalog = new SessionSkillCatalog(await contexts(), { dshHome: await home() })
    expect([...remoteMethods(catalog)].sort((a, b) => a.method.localeCompare(b.method))).toEqual([
      { method: 'install', exportName: 'add', invocation: { kind: 'direct' } },
      { method: 'installed', invocation: { kind: 'direct' } },
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'remove', exportName: 'uninstall', invocation: { kind: 'direct' } },
      { method: 'search', invocation: { kind: 'direct' } },
      { method: 'setEnabled', invocation: { kind: 'direct' } },
      { method: 'terminalClose', invocation: { kind: 'direct' } },
      { method: 'terminalOpen', invocation: { kind: 'direct' } },
      { method: 'terminalRead', invocation: { kind: 'direct' } },
      { method: 'terminalWrite', invocation: { kind: 'direct' } },
    ])
  })
})
