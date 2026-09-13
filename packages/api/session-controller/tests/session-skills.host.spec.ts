import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-skill'
import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { parseSearchOutput, SessionSkillCatalog } from '../src/skill-catalog.ts'

function observation(
  sessionId: SessionId,
  options: { readonly cwd?: string; readonly agentPreset?: string } = {},
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
  await ctx.plugin(AgentRegistry)
  return ctx
}

describe('SessionSkillCatalog', () => {
  it('parses deduplicated skills.sh results from CLI output', () => {
    expect(parseSearchOutput([
      '\u001B[32mowner/repo@pentest\u001B[0m',
      '└ https://skills.sh/owner/repo/pentest',
      'owner/repo@pentest',
      'other/tools@web-audit',
    ].join('\n'))).toEqual([
      { source: 'owner/repo@pentest', name: 'pentest', url: 'https://skills.sh/owner/repo/pentest' },
      { source: 'other/tools@web-audit', name: 'web-audit', url: 'https://skills.sh/other/tools/web-audit' },
    ])
  })

  it('installs through exact npx arguments, replaces atomically, and keeps a backup', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-test-'))
    try {
      await mkdir(join(home, 'skills', 'pentest'), { recursive: true })
      await writeFile(join(home, 'skills', 'pentest', 'SKILL.md'), 'old')
      const runCli = vi.fn(async (_args: readonly string[], cwd: string) => {
        await mkdir(join(cwd, '.agents', 'skills', 'pentest'), { recursive: true })
        await writeFile(join(cwd, '.agents', 'skills', 'pentest', 'SKILL.md'), 'new')
        return ''
      })
      const catalog = new SessionSkillCatalog(await context(), { dshHome: home, runCli })

      await expect(catalog.install(
        { source: 'owner/repo@pentest' },
        new AbortController().signal,
      )).resolves.toEqual({ installed: ['pentest'], backedUp: ['pentest'] })
      expect(runCli).toHaveBeenCalledWith([
        '--yes', 'skills', 'add', 'owner/repo@pentest',
        '--agent', 'universal', '-y', '--copy',
      ], expect.any(String), expect.any(AbortSignal))
      await expect(readFile(join(home, 'skills', 'pentest', 'SKILL.md'), 'utf8')).resolves.toBe('new')
      const [backupGeneration] = await readdir(join(home, 'skill-backups'))
      await expect(readFile(join(home, 'skill-backups', backupGeneration!, 'pentest', 'SKILL.md'), 'utf8'))
        .resolves.toBe('old')
      await expect(catalog.installed()).resolves.toEqual({ skills: [{ name: 'pentest', enabled: true }] })

      await expect(catalog.install(
        { source: '../repo@local' },
        new AbortController().signal,
      )).rejects.toMatchObject({ code: 'gateway/bad-request' })
      await expect(catalog.install(
        { source: 'https://skills.sh/owner/repo/pentest' },
        new AbortController().signal,
      )).rejects.toMatchObject({ code: 'gateway/bad-request' })
      expect(runCli).toHaveBeenCalledOnce()

      runCli.mockImplementationOnce(async (_args: readonly string[], cwd: string) => {
        await mkdir(join(cwd, '.agents', 'skills', 'pentest'), { recursive: true })
        await mkdir(join(cwd, '.agents', 'skills', 'unexpected'), { recursive: true })
        await writeFile(join(cwd, '.agents', 'skills', 'pentest', 'SKILL.md'), 'newer')
        await writeFile(join(cwd, '.agents', 'skills', 'unexpected', 'SKILL.md'), 'unrequested')
        return ''
      })
      await expect(catalog.install(
        { source: 'owner/repo@pentest' },
        new AbortController().signal,
      )).rejects.toThrow('did not produce exactly the requested skill')
      await expect(readFile(join(home, 'skills', 'pentest', 'SKILL.md'), 'utf8')).resolves.toBe('new')
      expect(runCli).toHaveBeenCalledTimes(2)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('enables and disables an installed skill by moving it out of discovery', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-skill-toggle-test-'))
    try {
      await mkdir(join(home, 'skills', 'pentest'), { recursive: true })
      await writeFile(join(home, 'skills', 'pentest', 'SKILL.md'), 'body')
      const catalog = new SessionSkillCatalog(await context(), { dshHome: home })

      await expect(catalog.setEnabled({ name: 'pentest', enabled: false }))
        .resolves.toEqual({ name: 'pentest', enabled: false })
      await expect(catalog.installed()).resolves.toEqual({ skills: [{ name: 'pentest', enabled: false }] })
      await expect(readFile(join(home, 'disabled-skills', 'pentest', 'SKILL.md'), 'utf8')).resolves.toBe('body')
      await expect(catalog.setEnabled({ name: 'pentest', enabled: false }))
        .resolves.toEqual({ name: 'pentest', enabled: false })

      await expect(catalog.setEnabled({ name: 'pentest', enabled: true }))
        .resolves.toEqual({ name: 'pentest', enabled: true })
      await expect(catalog.installed()).resolves.toEqual({ skills: [{ name: 'pentest', enabled: true }] })
      await expect(readFile(join(home, 'skills', 'pentest', 'SKILL.md'), 'utf8')).resolves.toBe('body')
      await expect(catalog.setEnabled({ name: '../pentest', enabled: false }))
        .rejects.toMatchObject({ code: 'gateway/bad-request' })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('removes enabled and disabled skills into recoverable backups', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-skill-remove-test-'))
    try {
      for (const [root, name] of [['skills', 'enabled'], ['disabled-skills', 'disabled']] as const) {
        await mkdir(join(home, root, name), { recursive: true })
        await writeFile(join(home, root, name, 'SKILL.md'), name)
      }
      const catalog = new SessionSkillCatalog(await context(), { dshHome: home })

      await expect(catalog.remove({ name: 'enabled' })).resolves.toEqual({ name: 'enabled', removed: true })
      await expect(catalog.remove({ name: 'disabled' })).resolves.toEqual({ name: 'disabled', removed: true })
      await expect(catalog.remove({ name: 'disabled' })).resolves.toEqual({ name: 'disabled', removed: false })
      await expect(catalog.remove({ name: '../enabled' })).rejects.toMatchObject({ code: 'gateway/bad-request' })
      await expect(catalog.installed()).resolves.toEqual({ skills: [] })

      const generations = await readdir(join(home, 'skill-backups'))
      const names = (await Promise.all(generations.map(generation => (
        readdir(join(home, 'skill-backups', generation))
      )))).flat().sort()
      expect(names).toEqual(['disabled', 'enabled'])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('bridges an interactive native terminal with incremental output and cleanup', async () => {
    const ctx = await context()
    const output = new PassThrough()
    const settled = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    const write = vi.fn(() => Promise.resolve())
    const terminate = vi.fn(() => Promise.resolve())
    const handle = {
      pid: 42,
      output,
      done: settled.promise,
      write,
      inspectForeground: vi.fn(() => Promise.resolve(undefined)),
      signalForeground: vi.fn(() => Promise.resolve(42)),
      terminate,
    } satisfies SubprocessTerminalHandle
    const resolveExecutable = vi.fn((shell: string) => Promise.resolve(shell))
    const spawnTerminal = vi.fn((_spec: SubprocessTerminalSpawnSpec) => Promise.resolve(handle))
    ctx.provide('subprocess', { resolveExecutable, spawnTerminal } as never)
    const catalog = new SessionSkillCatalog(ctx)

    const opened = await catalog.terminalOpen(
      { command: 'npx skills add owner/repo', rows: 30, cols: 120 },
      new AbortController().signal,
    )
    expect(resolveExecutable).toHaveBeenCalledWith(
      process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : process.env.SHELL ?? '/bin/sh',
      undefined,
      expect.any(AbortSignal),
    )
    expect(spawnTerminal).toHaveBeenCalledOnce()
    const [terminalSpec] = spawnTerminal.mock.calls[0]!
    expect(terminalSpec).toMatchObject({ rows: 30, cols: 120 })
    expect(terminalSpec.argv).toHaveLength(1)
    expect(typeof terminalSpec.argv[0]).toBe('string')
    expect(typeof terminalSpec.cwd).toBe('string')
    expect(write).toHaveBeenCalledWith('npx skills add owner/repo\r')

    output.write('Select a skill: ')
    expect(catalog.terminalRead({ id: opened.id, offset: 0 })).toMatchObject({
      text: 'Select a skill: ', nextOffset: 16, lossy: false, exited: false,
    })
    await expect(catalog.terminalWrite({ id: opened.id, text: 'y\r' })).resolves.toEqual({ accepted: true })
    expect(write).toHaveBeenLastCalledWith('y\r')

    settled.resolve({ exitCode: 0, signal: null })
    output.end()
    await new Promise(resolve => setImmediate(resolve))
    expect(catalog.terminalRead({ id: opened.id, offset: 16 })).toMatchObject({ exited: true, exitCode: 0 })
    await expect(catalog.terminalClose({ id: opened.id })).resolves.toEqual({ closed: true })
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('reads a cold Session catalog without resuming an Agent', async () => {
    const ctx = await context()
    const sessionId = SessionId('cold-skills')
    const observed = observation(sessionId, { cwd: '/cold/project' })
    const dispose = vi.spyOn(observed, Symbol.dispose)
    const observeSession = vi.fn(() => Promise.resolve(observed))
    ctx.provide('sessionQuery', { observeSession } as never)
    const resume = vi.spyOn(ctx.agents, 'resume')
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
    expect(ctx.agents.list()).toEqual([])
    expect(list).toHaveBeenCalledWith({ cwd: '/cold/project', scope: undefined })
  })

  it('uses a live Agent to address a preset-owned registry', async () => {
    const ctx = await context()
    const sessionId = SessionId('live-skills')
    const session = ctx.sessions.create(sessionId, { meta: { cwd: '/live/project' } })
    const agent = { id: sessionId, session, status: 'idle', ctx } as Agent
    ctx.agents.register(agent)
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd: '/live/project' })),
    } as never)
    const scopedList = vi.fn(() => Promise.resolve([{
      name: 'preset-owned',
      description: 'Composed for this Agent.',
      invocation: { modelInvocable: false, userInvocable: true },
    }]))
    const standingKeyFor = vi.fn()
    ctx.provide('agentPresets', {
      serviceFor: () => ({ list: scopedList }),
      standingKeyFor,
    } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({
      skills: [{
        name: 'preset-owned',
        description: 'Composed for this Agent.',
        modelInvocable: false,
      }],
    })
    expect(scopedList).toHaveBeenCalledWith({ cwd: '/live/project', scope: agent })
    expect(standingKeyFor).not.toHaveBeenCalled()
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
    const standingKeyFor = vi.fn(() => Promise.resolve(scope))
    ctx.provide('agentPresets', { standingKeyFor } as never)
    const list = vi.fn(() => Promise.resolve([]))
    ctx.provide('skills', { list } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({ skills: [] })
    expect(standingKeyFor).toHaveBeenCalledWith('minimal')
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
      standingKeyFor: () => Promise.reject(new Error('unknown preset')),
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

  it('rejects observations without projections or a project cwd', async () => {
    const ctx = await context()
    const sessionId = SessionId('incomplete-skills')
    const withoutProjections = { ...observation(sessionId, { cwd: '/project' }), projections: undefined }
    const observeSession = vi.fn()
      .mockResolvedValueOnce(withoutProjections)
      .mockResolvedValueOnce(observation(sessionId))
    ctx.provide('sessionQuery', { observeSession } as never)
    const catalog = new SessionSkillCatalog(ctx)

    const unprojected = catalog.list({ sessionId }, new AbortController().signal)
    await expect(unprojected).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(unprojected).rejects.toThrow('projected Session observation')
    const cwdless = catalog.list({ sessionId }, new AbortController().signal)
    await expect(cwdless).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(cwdless).rejects.toThrow('has no project cwd')
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
