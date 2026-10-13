import { mkdtemp, mkdir, readFile, rm, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import PentestModePolicy from '@deepseek-ai/dsh-pentest-executor'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installWebPromptSettings } from '../src/core/prompt-settings.ts'

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('TUI Web prompt settings', () => {
  it.each([true, false])('follows the saved Web switch at boot and each request, initially %s', async (initial) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-prompt-settings-'))
    const ctx = new Context()
    try {
      const web = join(root, 'profiles', 'web', 'cordis.patch.yml')
      const home = join(root, 'home')
      await mkdir(join(root, 'profiles', 'web'), { recursive: true })
      await mkdir(join(root, '.git'))
      await mkdir(home)
      await writeFile(join(root, 'AGENTS.md'), 'project workspace rule')
      await writeFile(join(home, 'AGENTS.md'), 'global workspace rule')
      const save = (suppressSections: boolean) => writeFile(web, JSON.stringify([{ id: 'pentest-mode', config: { suppressSections } }]))
      await save(initial)
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(LocalFileSystem, { cwd: root })
      ctx.provide('profileContext', { name: 'tui', home: root })
      await ctx.plugin(Loader)
      ctx.loader.builtins['mode-test'] = PentestModePolicy
      ctx.loader.builtins['instructions-test'] = AgentInstructions
      ctx.loader.builtins['tui-settings-test'] = {
        name: 'tui-settings-test', inject: ['pentestModePolicy', 'systemPrompt'], apply: installWebPromptSettings,
      }
      const composition = join(root, 'cordis.yml')
      await writeFile(composition, JSON.stringify([
        { id: 'pentest-mode', name: 'cordis:mode-test', config: { suppressSections: false, redPrompt: 'mode contribution' } },
        { id: 'instructions', name: 'cordis:instructions-test', config: { dshHome: home, maxBytes: 65536 } },
        { id: 'tui-settings', name: 'cordis:tui-settings-test' },
      ]))
      const originalComposition = await readFile(composition, 'utf8')
      const rows = JSON.parse(await readFile(composition, 'utf8')) as { id: string; name: string; config?: object }[]
      for (const row of rows) {
        const id = await ctx.loader.create(row)
        await ctx.loader.resolve(id).fiber?.await()
      }
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
      const adapter = new RecordingAdapter()
      const errors: unknown[] = []
      ctx.on('agent/error', ({ error }) => { errors.push(error) })
      ctx.llm.registerAdapter(['mock'], adapter)
      const agent = await ctx.agentLoop.create(SessionId('tui-prompt-settings'), { provider: 'mock', model: 'mock' }, { cwd: root })
      agent.ctx.systemPrompt.section({ name: 'preset:test', order: 2, text: 'preset contribution' })
      const send = async (suppressed: boolean) => {
        const before = await readFile(web, 'utf8')
        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } }))
        await agent.whenIdle()
        expect(errors).toEqual([])
        const request = adapter.requests.at(-1)!
        const text = request.messages.flatMap(message => message.content)
          .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
        expect(ctx.pentestModePolicy.current().suppressSections).toBe(suppressed)
        for (const context of ['workspace rule', 'Current runtime context.', 'Mandatory Jev-first browser and computer actions', 'built-in guidance']) {
          expect(text.includes(context), context).toBe(!suppressed)
        }
        expect(text).toContain('preset contribution')
        expect(text).toContain('mode contribution')
        expect(await readFile(web, 'utf8')).toBe(before)
        expect(await readFile(composition, 'utf8')).toBe(originalComposition)
      }
      await send(initial)
      for (const suppressed of [true, false, true]) {
        await save(suppressed)
        await send(suppressed)
      }
      await unlink(web)
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'fallback' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      expect(ctx.pentestModePolicy.current().suppressSections).toBe(false)
      expect(ctx.pentestModePolicy.current().redPrompt).toBe('mode contribution')
      const count = adapter.requests.length
      await writeFile(web, JSON.stringify([{ id: 'pentest-mode', config: { suppressSections: 'yes' } }]))
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'invalid' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      expect(errors).toContainEqual(new Error('pi-tui: Web suppressSections must be a boolean'))
      expect(adapter.requests).toHaveLength(count)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
