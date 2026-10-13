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
import { SessionId } from '@deepseek-ai/dsh-session'
import { installWebPromptSettings } from '../src/core/prompt-settings.ts'

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
  ])('defers first-turn context with suppression $initial and saved Web settings $savedWeb', async ({ initial, savedWeb }) => {
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
        adapter.inHistory = suppressed
        if (suppressed) agent.session.append('system/message', {
          turn: 2, step: 1, message: createSystemMessage('historical system update'),
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
          expect(contexts).toHaveLength(!suppressed && !firstTurn ? 3 : 0)
          expect(text).toContain(question)
          expect(text.includes('built-in guidance')).toBe(!suppressed)
          expect(text).toContain('preset contribution')
          expect(text.includes('mode contribution')).toBe(!suppressed)
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
          expect(requests[0]!.messages.map(message => message.role)).toEqual(['system', 'user'])
          expect(requests[0]!.messages[1]!.content).toEqual([{ type: 'text', text: question }])
          expect(requests[1]!.messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
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
      const restored = await ctx.agents.create({
        sessionId: SessionId('restored-tui-prompt-settings'), seed: agent.session.snapshotEvents(),
        agentOptions: { provider: 'mock', model: 'mock' }, meta: { cwd: root },
        setup: async (agentCtx) => { await agentCtx.plugin(Persona, { prefix: 'preset contribution' }) },
      })
      restored.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'restored second turn' }], source: { kind: 'user' } }))
      await restored.agent.whenIdle()
      expect(errors).toEqual([])
      expect(adapter.requests.at(-1)!.messages.some(message => message.source?.kind === 'agent-instructions')).toBe(!initial)
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
      await unlink(web)
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'fallback' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      expect(ctx.pentestModePolicy.current().suppressSections).toBe(fallback)
      expect(ctx.pentestModePolicy.current().redPrompt).toBe('mode contribution')
      const count = adapter.requests.length
      await writeFile(web, JSON.stringify([{ id: 'pentest-mode', config: { suppressSections: 'yes' } }]))
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'invalid' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      expect(errors).toContainEqual(new Error('pi-tui: Web suppressSections must be a boolean'))
      expect(adapter.requests).toHaveLength(count)
    } finally {
      await ctx.fiber.dispose()
      if (gateway.listening) await new Promise<void>((resolve, reject) => {
        gateway.close((error) => { if (error) reject(error); else resolve() })
      })
      await rm(root, { recursive: true, force: true })
    }
  })
})
