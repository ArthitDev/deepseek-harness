import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, ReasoningEffortId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import AgentDefaultModel from '../../../core/agent-default-model/src/index.ts'
import { ChatScreen } from '../src/ui/chat.ts'

vi.mock('../src/core/git.ts', () => ({ readGitState: async () => undefined }))

const route = { provider: 'combo', model: 'GLM-DeepSeek-Flash-Combo' }
const high = { ...route, reasoningEffort: ReasoningEffortId('high') }

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly supported: boolean) { super() }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model,
      ...this.supported ? { reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] } } : {},
    })
  }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function terminal(): Terminal {
  return {
    columns: 120, rows: 50, kittyProtocolActive: false,
    start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
    moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
    clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
  }
}

describe('restored reasoning effort through Loader and the real request loop', () => {
  it.each(['saved-default', 'resumed-header', 'supported'] as const)('recovers %s without selecting the model again', async (source) => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-tui-reasoning-startup-'))
    const ctx = new Context()
    const tui = new TuiAltScreen(terminal())
    const adapter = new RecordingAdapter(source === 'supported')
    const errors: unknown[] = []
    try {
      await mountAgentLoopTestDependencies(ctx)
      ctx.llm.registerAdapter([route.provider], adapter)
      ctx.on('agent/error', ({ error }) => { errors.push(error) })
      ctx.provide('profileContext', { home, name: 'tui' })
      await ctx.plugin(Loader)
      Object.assign(ctx.loader.builtins, { include: Include, loop: AgentLoop, model: AgentDefaultModel })
      const path = join(home, 'cordis.yml')
      const config = JSON.stringify([
        { id: 'loop', name: 'cordis:loop', config: { agents: [] } },
        { id: 'agent-default-model', name: 'cordis:model', config: high },
      ])
      await writeFile(path, config)
      await ctx.loader.root.update([{ id: 'include', name: 'cordis:include', config: { path: pathToFileURL(path).href } }])
      await ctx.loader.await()
      const first = await ctx.agentLoop.create(SessionId('first'), route, { cwd: home })
      if (source === 'resumed-header') first.session.append('request/header', { header: { config: high }, reason: 'initial' })
      const screen = new ChatScreen({ ctx, tui, agent: first, config: {}, onQuit: vi.fn() })
      for (const text of ['first task', 'continue']) {
        screen.submit(text)
        await first.whenIdle()
      }
      expect(adapter.requests).toHaveLength(2)
      const switched = await ctx.agentLoop.create(SessionId('switched'), route, { cwd: home })
      switched.session.append('request/header', { header: { config: high }, reason: 'initial' })
      screen.switchAgent(switched)
      screen.submit('continue after switching session')
      await switched.whenIdle()
      expect(adapter.requests).toHaveLength(3)
      expect(errors).toEqual([])
      for (const request of adapter.requests) {
        expect(request).toMatchObject(route)
        expect(request.reasoningEffort).toBe(source === 'supported' ? 'high' : undefined)
      }
      expect(await readFile(path, 'utf8')).toBe(config)
      expect(ctx.agentDefaultModel.currentSelection()).toEqual(high)
      if (source === 'resumed-header') {
        expect(first.session.snapshotEvents().find(event => event.type === 'request/header')?.data)
          .toMatchObject({ header: { config: high } })
      }
    } finally { tui.stop(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }) }
  })
})
