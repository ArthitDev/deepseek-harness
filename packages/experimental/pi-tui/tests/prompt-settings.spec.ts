import { mkdtemp, mkdir, readFile, rm, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createDeveloperMessage, createSystemMessage, createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai/src/config.ts'
import PentestModePolicy from '@deepseek-ai/dsh-pentest-executor'
import * as Persona from '@deepseek-ai/dsh-persona'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { installWebPromptSettings } from '../src/core/prompt-settings.ts'
import { forkSession } from '../src/core/session.ts'

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  onFirstRequest?: () => void
  inHistory = false
  constructor(private readonly gateway: PiAiAdapter) { super() }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, ...this.inHistory ? { systemPromptUpdate: 'in-history' as const } : {} })
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) this.onFirstRequest?.()
    yield* this.gateway.stream(options)
  }
}

describe('TUI Web prompt settings', () => {
  it.each([
    { initial: true, savedWeb: true },
    { initial: false, savedWeb: true },
    { initial: true, savedWeb: false },
    { initial: false, savedWeb: false },
  ])('matches Web context from the first turn with suppression $initial and saved Web settings $savedWeb', async ({ initial, savedWeb }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-prompt-settings-'))
    const ctx = new Context()
    const wireRequests: { messages: { role: string; content: string }[] }[] = []
    const gateway = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => { body += String(chunk) })
      request.on('end', () => {
        wireRequests.push(JSON.parse(body) as typeof wireRequests[number])
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end('data: {"choices":[{"delta":{"content":"done"},"index":0,"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
      })
    })
    try {
      await new Promise<void>((resolve, reject) => { gateway.once('error', reject); gateway.listen(0, '127.0.0.1', resolve) })
      const address = gateway.address()
      if (address === null || typeof address === 'string') throw new Error('test gateway has no TCP address')
      const web = join(root, 'profiles', 'web', 'cordis.patch.yml')
      const home = join(root, 'home')
      await mkdir(join(root, 'profiles', 'web'), { recursive: true })
      await mkdir(join(root, '.git'))
      await mkdir(home)
      await writeFile(join(root, 'AGENTS.md'), 'project workspace rule')
      await writeFile(join(home, 'AGENTS.md'), 'global workspace rule')
      const save = (suppressSections: boolean) => writeFile(web, JSON.stringify([{ id: 'pentest-mode', config: { suppressSections } }]))
      const readSaved = async () => {
        try { return await readFile(web, 'utf8') }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
      }
      if (savedWeb) await save(initial)
      const fallback = savedWeb ? false : initial
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(LocalFileSystem, { cwd: root })
      ctx.provide('profileContext', { name: 'tui', home: root })
      await ctx.plugin(Loader)
      ctx.loader.builtins['include-test'] = Include
      ctx.loader.builtins['mode-test'] = PentestModePolicy
      ctx.loader.builtins['instructions-test'] = AgentInstructions
      ctx.loader.builtins['tui-settings-test'] = {
        name: 'tui-settings-test', inject: ['pentestModePolicy', 'systemPrompt'], apply: installWebPromptSettings,
      }
      const composition = join(root, 'cordis.yml')
      await writeFile(composition, JSON.stringify([
        { id: 'pentest-mode', name: 'cordis:mode-test', config: { suppressSections: fallback, redPrompt: 'mode contribution' } },
        { id: 'instructions', name: 'cordis:instructions-test', config: { dshHome: home, maxBytes: 65536 } },
        { id: 'tui-settings', name: 'cordis:tui-settings-test' },
      ]))
      const originalComposition = await readFile(composition, 'utf8')
      await ctx.loader.root.update([{ id: 'include', name: 'cordis:include-test', config: { path: pathToFileURL(composition).href } }])
      await ctx.loader.await()
      expect(ctx.loader.resolve('include:tui-settings').fiber?.state).toBe(FiberState.ACTIVE)
      expect(ctx.pentestModePolicy.current().suppressSections).toBe(initial)
      ctx.systemPrompt.section({ name: 'builtin:test', order: 1, text: 'built-in guidance' })
      ctx.systemPrompt.context({ name: 'runtime:test', order: 1, text: 'Current DSH file policy: danger-full-access. Approval prompts are disabled.' })
      ctx.on('agent/pre-step', async (_payload, next) => {
        const decision = await next()
        if (decision.kind === 'reject') return decision
        return { ...decision, messages: [...decision.messages, createUserMessage({
          content: [{ type: 'text', text: 'Mandatory Jev-first browser and computer actions' }],
          source: { kind: 'skill-invocation', name: 'jev-first-policy', form: 'instructions' },
        })] }
      })
      await ctx.plugin(AgentLoop, { agents: [] })
      const adapter = new RecordingAdapter(new PiAiAdapter({
        profiles: () => resolveProfiles({ mock: {
          api: 'openai-completions', baseURL: `http://127.0.0.1:${address.port}/v1`,
          compat: { supportsDeveloperRole: false },
          models: [{ id: 'mock', name: 'mock', contextWindow: 32768, maxTokens: 1024 }],
        } }),
        resolveApiKey: () => Promise.resolve('test-only-key'),
        auth: {
          credentials: {
            read: () => Promise.resolve(undefined), list: () => Promise.resolve([]),
            modify: async (_id, mutate) => await mutate(undefined), delete: () => Promise.resolve(),
          },
          authContext: { env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false) },
        },
      }))
      const errors: unknown[] = []
      ctx.on('agent/error', ({ error }) => { errors.push(error) })
      ctx.llm.registerAdapter(['mock'], adapter)
      const agent = await ctx.agentLoop.create(SessionId('tui-prompt-settings'), { provider: 'mock', model: 'mock' }, { cwd: root })
      await agent.ctx.plugin(Persona, { prefix: 'preset contribution' })
      agent.ctx.systemPrompt.section({ name: 'scoped:guidance', order: 2, text: 'scoped built-in guidance' })
      adapter.onFirstRequest = () => {
        agent.inject(createUserMessage({ content: [{ type: 'text', text: 'another step in the first turn' }], source: { kind: 'user' } }))
      }
      const question = 'User quote: workspace rule; Current runtime context.; Mandatory Jev-first browser and computer actions'
      const systemPrompts = new Map<boolean, unknown>()
      const send = async (suppressed: boolean, firstTurn = false) => {
        const before = await readSaved()
        const count = adapter.requests.length
        adapter.inHistory = true
        if (count > 0) agent.session.append('system/message', {
          turn: 2, step: 1, message: createSystemMessage('historical system update\n\nmode contribution'),
        }, { surfaceOp: 'append' })
        agent.followup(createUserMessage({ content: [{ type: 'text', text: question }], source: { kind: 'user' } }))
        await agent.whenIdle()
        expect(errors).toEqual([])
        const requests = adapter.requests.slice(count)
        expect(requests).toHaveLength(firstTurn ? 2 : 1)
        expect(ctx.pentestModePolicy.current().suppressSections).toBe(suppressed)
        for (const [index, request] of requests.entries()) {
          expect(request.messages[0]?.role).toBe('system')
          if (systemPrompts.has(suppressed)) expect(request.messages[0]!.content).toEqual(systemPrompts.get(suppressed))
          else systemPrompts.set(suppressed, request.messages[0]!.content)
          const text = request.messages.flatMap(message => message.content)
            .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
          const contexts = request.messages.filter(({ source }) =>
            source?.kind === 'agent-instructions' || source?.kind === 'runtime-context'
            || (source?.kind === 'skill-invocation' && source.name === 'jev-first-policy'))
          expect(contexts.filter(message => message.source?.kind === 'agent-instructions')).toHaveLength(suppressed ? 0 : 1)
          expect(contexts.some(message => message.source?.kind === 'runtime-context')).toBe(!suppressed)
          expect(contexts.some(message => message.source?.kind === 'skill-invocation' && message.source.name === 'jev-first-policy')).toBe(!suppressed)
          expect(text).toContain(question)
          expect(text.includes('built-in guidance')).toBe(!suppressed)
          expect(text).toContain('preset contribution')
          expect(text.includes('mode contribution')).toBe(!suppressed)
          expect(request.messages.filter(message => message.role === 'system')).toHaveLength(1)
          expect(JSON.stringify(wireRequests[count + index]).includes('mode contribution')).toBe(!suppressed)
          expect(JSON.stringify(wireRequests[count + index])).not.toContain('historical system update')
          expect(JSON.stringify(wireRequests[count + index])).not.toContain('developer marker')
          if (suppressed) {
            expect(request.messages[0]!.content).toEqual([{ type: 'text', text: 'preset contribution' }])
            const wire = wireRequests[count + index]!
            expect(wire.messages.filter(message => message.role === 'system'))
              .toEqual([{ role: 'system', content: 'preset contribution' }])
            expect(JSON.stringify(wire)).not.toContain('developer marker')
            expect(JSON.stringify(wire)).not.toContain('historical system update')
            expect(JSON.stringify(wire)).not.toContain('scoped built-in guidance')
          }
        }
        if (firstTurn) {
          const withoutContexts = (request: GenerateOptions) => request.messages.filter(({ source }) =>
            source?.kind !== 'agent-instructions' && source?.kind !== 'runtime-context'
            && !(source?.kind === 'skill-invocation' && source.name === 'jev-first-policy'))
          expect(withoutContexts(requests[0]!).map(message => message.role)).toEqual(['system', 'user'])
          expect(requests[0]!.messages[1]!.content).toEqual([{ type: 'text', text: question }])
          expect(withoutContexts(requests[1]!).map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
          expect(requests[1]!.messages[0]).toEqual(requests[0]!.messages[0])
        }
        expect(await readSaved()).toBe(before)
        expect(await readFile(composition, 'utf8')).toBe(originalComposition)
      }
      await send(initial, true)
      agent.session.append('developer/message', {
        turn: 2, step: 1,
        message: createDeveloperMessage({ content: [{ type: 'text', text: 'developer marker' }], source: { kind: 'session-edit' } }),
      }, { surfaceOp: 'append' })
      agent.session.append('system/message', {
        turn: 2, step: 1, message: createSystemMessage('historical system update\n\nmode contribution'),
      }, { surfaceOp: 'append' })
      const restored = await ctx.agents.create({
        sessionId: SessionId('restored-tui-prompt-settings'), seed: agent.session.snapshotEvents(),
        agentOptions: { provider: 'mock', model: 'mock' }, meta: { cwd: root },
        setup: async (agentCtx) => { await agentCtx.plugin(Persona, { prefix: 'preset contribution' }) },
      })
      restored.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'restored second turn' }], source: { kind: 'user' } }))
      await restored.agent.whenIdle()
      expect(errors).toEqual([])
      expect(adapter.requests.at(-1)!.messages.some(message => message.source?.kind === 'agent-instructions')).toBe(!initial)
      expect(JSON.stringify(wireRequests.at(-1))).not.toContain('developer marker')
      expect(JSON.stringify(wireRequests.at(-1)).includes('mode contribution')).toBe(!initial)
      expect(JSON.stringify(wireRequests.at(-1))).not.toContain('historical system update')
      if (initial) expect(wireRequests.at(-1)!.messages.filter(message => message.role === 'system'))
        .toEqual([{ role: 'system', content: 'preset contribution' }])
      await restored.dispose()
      await send(initial)
      for (const suppressed of [true, false, true]) {
        await save(suppressed)
        await send(suppressed)
      }
      expect(agent.session.snapshotEvents().some(event => event.type === 'developer/message'
        && event.data.message.content.some(block => block.type === 'text' && block.text === 'developer marker'))).toBe(true)
      const originalHistory = agent.session.snapshotEvents()
      const selected: string[] = []
      ctx.provide('agentPresets', {
        resolve: async (id: string) => ({ id }), composedPreset: () => 'old-preset',
        mount: async (agentCtx: Context, id: string) => { await agentCtx.plugin(Persona, { prefix: `NEW_PRESET_${id}` }) },
        select: async (_agent: unknown, id: string) => { selected.push(id); return id },
      })
      await save(initial)
      for (const id of ['second', 'third']) {
        const child = await forkSession(ctx, agent, { provider: 'mock', model: 'mock' }, { cwd: root, agentPreset: id }, true)
        let active = child
        if (id === 'third') {
          const seed = child.agent.session.snapshotEvents()
          await child.handle?.dispose()
          const reopened = await ctx.agents.create({
            sessionId: SessionId('restored-pending-preset'), seed,
            inheritedEventCount: SessionLogOffset(0), meta: { cwd: root, parentSession: agent.id, agentPreset: id },
            agentOptions: { provider: 'mock', model: 'mock' },
            setup: async (agentCtx) => { await agentCtx.plugin(Persona, { prefix: `NEW_PRESET_${id}` }) },
          })
          active = { agent: reopened.agent, handle: reopened }
        }
        try {
          active.agent.followup(createUserMessage({ content: [{ type: 'text', text: `continue ${id}` }], source: { kind: 'user' } }))
          await active.agent.whenIdle()
          expect(errors).toEqual([])
          const wire = wireRequests.at(-1)!
          expect(wire.messages[0]?.role).toBe('system')
          const systems = wire.messages.filter(message => message.role === 'system')
          expect(systems).toHaveLength(1)
          expect(systems[0]!.content).toContain(`NEW_PRESET_${id}`)
          if (initial) expect(systems[0]!.content).toBe(`NEW_PRESET_${id}`)
          expect(JSON.stringify(wire)).not.toContain('preset contribution')
          expect(JSON.stringify(wire)).not.toContain('historical system update')
          expect(JSON.stringify(wire)).not.toContain('developer marker')
          expect(JSON.stringify(wire)).not.toContain('scoped built-in guidance')
          expect(JSON.stringify(wire).includes('mode contribution')).toBe(!initial)
          expect(wire.messages.some(message => message.role === 'user' && message.content === question)).toBe(true)
          expect(wire.messages.some(message => message.role === 'assistant' && message.content === 'done')).toBe(true)
          expect(selected.at(-1)).toBe(id)
          expect(agent.session.snapshotEvents()).toEqual(originalHistory)
        } finally { await active.handle?.dispose() }
      }
      for (const mode of ['blue', 'black', 'dead', 'red'] as const) {
        await writeFile(web, JSON.stringify([{ id: 'pentest-mode', config: {
          mode, suppressSections: false, bluePrompt: 'TEAM_BLUE', redPrompt: 'TEAM_RED',
          blackPrompt: 'TEAM_BLACK', deadPrompt: 'TEAM_DEAD',
        } }]))
        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue after a team change' }], source: { kind: 'user' } }))
        await agent.whenIdle()
        expect(errors).toEqual([])
        const systems = wireRequests.at(-1)!.messages.filter(message => message.role === 'system')
        expect(systems).toHaveLength(1)
        expect(systems[0]!.content).toContain(`TEAM_${mode.toUpperCase()}`)
        for (const other of ['blue', 'red', 'black', 'dead']) {
          if (other !== mode) expect(systems[0]!.content).not.toContain(`TEAM_${other.toUpperCase()}`)
        }
        expect(systems[0]!.content).toContain('preset contribution')
        expect(systems[0]!.content).not.toContain('historical system update')
      }
      await unlink(web)
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'fallback' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      expect(ctx.pentestModePolicy.current().suppressSections).toBe(fallback)
      expect(ctx.pentestModePolicy.current().redPrompt).toBe('mode contribution')
      const count = adapter.requests.length
      await writeFile(web, JSON.stringify([{ id: 'pentest-mode', config: { suppressSections: 'yes' } }]))
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'invalid' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      expect(errors).toContainEqual(new Error('pi-tui: suppressSections must be a boolean'))
      expect(adapter.requests).toHaveLength(count)
    } finally {
      await ctx.fiber.dispose()
      if (gateway.listening) await new Promise<void>((resolve, reject) => {
        gateway.close((error) => { if (error) reject(error); else resolve() })
      })
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['tui', 'web'] as const)('applies team prompts in %s assemblies', async (surface) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-team-prompt-surface-'))
    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      ctx.systemPrompt.section({ name: 'builtin:test', order: 1, text: 'other built-in guidance' })
      const patchPath = join(root, 'profile.patch.yml')
      ctx.provide('profileContext', { name: surface, home: root, patchPath })
      await ctx.plugin(Loader)
      Object.assign(ctx.loader.builtins, {
        'include-test': Include, 'mode-test': PentestModePolicy,
        'tui-settings-test': {
          name: 'tui-settings-test', inject: ['pentestModePolicy', 'systemPrompt'], apply: installWebPromptSettings,
        },
      })
      const composition = join(root, 'cordis.yml')
      await writeFile(composition, JSON.stringify([
        { id: 'pentest-mode', name: 'cordis:mode-test' },
        ...surface === 'tui' ? [{ id: 'tui-settings', name: 'cordis:tui-settings-test' }] : [],
      ]))
      await ctx.loader.root.update([{ id: 'include', name: 'cordis:include-test', config: { path: pathToFileURL(composition).href } }])
      await ctx.loader.await()
      const entry = ctx.loader.resolve('include:pentest-mode')
      for (const mode of ['blue', 'red', 'black', 'dead'] as const) {
        for (const prompt of ['-', `${mode} team contribution`]) {
          if (surface === 'tui') await writeFile(patchPath, JSON.stringify([
            { id: 'pentest-mode', config: { mode, [`${mode}Prompt`]: prompt, suppressSections: false } },
          ]))
          await entry.update({ config: { mode, [`${mode}Prompt`]: prompt, suppressSections: false } })
          await ctx.loader.await()
          const assembly = await ctx.systemPrompt.assemble()
          expect(assembly.sections.find(section => section.name === 'pentest:mode-policy')?.text)
            .toBe(prompt)
          expect(assembly.sections.some(section => section.text === 'other built-in guidance')).toBe(true)
          expect(ctx.pentestModePolicy.current().suppressSections).toBe(false)
        }
      }
      expect(JSON.parse(await readFile(composition, 'utf8'))).toEqual([
        { id: 'pentest-mode', name: 'cordis:mode-test' },
        ...surface === 'tui' ? [{ id: 'tui-settings', name: 'cordis:tui-settings-test' }] : [],
      ])
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
