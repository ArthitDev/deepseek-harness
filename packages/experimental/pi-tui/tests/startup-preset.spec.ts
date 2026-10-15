import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import * as Persona from '@deepseek-ai/dsh-persona'
import { describe, expect, it, vi } from 'vitest'
import AgentDefaultModel from '../../../core/agent-default-model/src/index.ts'
import AgentPresets, { COMPOSITION_FILE } from '../../../preset/agent-presets/src/index.ts'
import * as piTui from '../src/index.ts'
import { resolveAgent } from '../src/core/session.ts'
import { defaultModelSelection } from '../src/core/web-settings.ts'

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('TUI preset startup through Loader', () => {
  it.each(['preset-first', 'model-first'] as const)('waits for both services and sends the bound preset on its first request, %s', async (order) => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-tui-startup-preset-'))
    const ctx = new Context()
    const opened = vi.fn()
    const adapter = new RecordingAdapter()
    const errors: unknown[] = []
    try {
      await mountAgentLoopTestDependencies(ctx, { systemPrompt: { personaPrefix: 'GLOBAL_FALLBACK' } })
      await ctx.plugin(AgentLoop, { agents: [] })
      ctx.llm.registerAdapter(['mock'], adapter)
      ctx.on('agent/error', ({ error }) => { errors.push(error) })
      ctx.provide('cmdlineArgs', { get: () => [] })
      ctx.provide('profileContext', { home, name: 'tui' })
      ctx.provide('pentestModePolicy', {})
      ctx.provide('workspaceRegistry', { resolveByPath: async () => ({ attachSession: async () => {} }) })
      await ctx.plugin(Loader)
      class DeferredPresets extends AgentPresets {
        static inject = [...AgentPresets.inject, 'testPresetReady']
      }
      class DeferredDefaultModel extends AgentDefaultModel {
        static inject = ['testModelReady']
      }
      const presetsRoot = join(home, 'presets')
      for (const [id, prefix] of [['fallback', 'WRONG_PRESET'], ['bound', 'BOUND_PRESET']] as const) {
        await mkdir(join(presetsRoot, id), { recursive: true })
        await writeFile(join(presetsRoot, id, COMPOSITION_FILE), JSON.stringify([
          { id: 'persona', name: 'cordis:persona', config: { prefix } },
        ]))
      }
      Object.assign(ctx.loader.builtins, {
        include: Include, persona: Persona, presets: DeferredPresets, model: DeferredDefaultModel,
        // Exercise the shipped dependency contract without opening a real terminal.
        tui: { ...piTui, apply: async (tuiCtx: Context) => {
          opened()
          const route = defaultModelSelection(tuiCtx)
          const { agent } = await resolveAgent(tuiCtx, undefined, route ?? {}, { cwd: home })
          expect(tuiCtx.agentPresets.composedPreset(agent.ctx)).toBe('bound')
          agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'first task' }] }))
          await agent.whenIdle()
        } },
      })
      const composition = join(home, 'cordis.yml')
      await writeFile(composition, JSON.stringify([
        { id: 'tui', name: 'cordis:tui' },
        { id: 'agent-presets', name: 'cordis:presets', config: {
          default: 'fallback', includeUserRoot: false, includeShippedRoot: false,
          roots: [{ path: presetsRoot, trust: 'user' }], models: { mock: { 'startup-model': 'bound' } },
        } },
        { id: 'agent-default-model', name: 'cordis:model', config: { provider: 'mock', model: 'startup-model' } },
      ]))
      await ctx.loader.root.update([{ id: 'include', name: 'cordis:include', config: { path: pathToFileURL(composition).href } }])
      await ctx.loader.await()
      expect(opened).not.toHaveBeenCalled()
      expect(adapter.requests).toHaveLength(0)
      const gates = order === 'preset-first' ? ['testPresetReady', 'testModelReady'] : ['testModelReady', 'testPresetReady']
      ctx.provide(gates[0]!, true)
      await ctx.loader.await()
      expect(opened).not.toHaveBeenCalled()
      expect(adapter.requests).toHaveLength(0)
      ctx.provide(gates[1]!, true)
      await ctx.loader.await()
      await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
      expect(opened).toHaveBeenCalledOnce()
      expect(ctx.loader.resolve('include:tui').fiber?.state).toBe(FiberState.ACTIVE)
      expect(errors).toEqual([])
      const request = adapter.requests[0]!
      expect(request).toMatchObject({ provider: 'mock', model: 'startup-model' })
      expect(request.messages[0]?.role).toBe('system')
      expect(JSON.stringify(request.messages[0])).toContain('BOUND_PRESET')
      expect(JSON.stringify(request.messages)).not.toContain('WRONG_PRESET')
      expect(JSON.stringify(request.messages)).not.toContain('GLOBAL_FALLBACK')
    } finally {
      await ctx.fiber.dispose()
      await rm(home, { recursive: true, force: true })
    }
  })
})
