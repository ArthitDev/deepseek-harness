import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import { listAllModels, pickModel, type LlmRuntimeLike } from '../src/ui/model-picker.ts'
import { pickFromListWithSearch } from '../src/ui/overlays.ts'
import { ChatScreen } from '../src/ui/chat.ts'
import { fixtureAgent } from './fixture-agent.ts'

vi.mock('../src/ui/overlays.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/ui/overlays.ts')>(),
  pickFromListWithSearch: vi.fn(),
}))

function terminal(): Terminal {
  return {
    columns: 120, rows: 50, kittyProtocolActive: false,
    start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
    moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
    clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
  }
}

const llm: LlmRuntimeLike = {
  listProviders: () => [{ id: 'gateway', name: 'My gateway' }],
  listModels: async () => [{ provider: 'gateway', id: 'openai/test-model', name: 'Friendly Model' }],
}

describe('model catalog labels in TUI', () => {
  it('keeps Web catalog names and original ids while enriching configured context sizes', async () => {
    expect(await listAllModels(llm, new Map([['gateway/openai/test-model', 128_000]]))).toEqual([{
      provider: 'gateway', model: 'openai/test-model', name: 'Friendly Model', providerName: 'My gateway', contextWindow: 128_000,
    }])
  })

  it('shows catalog labels, keeps route ids searchable, and returns the original selection', async () => {
    const tui = new TuiAltScreen(terminal())
    vi.mocked(pickFromListWithSearch).mockResolvedValueOnce('gateway\0openai/test-model')
    const selected = await pickModel(tui, llm, undefined, { provider: 'gateway', model: 'openai/test-model' })
    expect(selected).toEqual({ provider: 'gateway', model: 'openai/test-model' })
    expect(vi.mocked(pickFromListWithSearch).mock.lastCall?.[1].items).toEqual([{
      value: 'gateway\0openai/test-model',
      label: '✓ Friendly Model (My gateway)',
      description: 'active · #0 · gateway/openai/test-model',
      searchText: 'Friendly Model My gateway gateway/openai/test-model',
    }])
  })

  it('finds the original model id in the live picker after displaying a friendly name', async () => {
    const real = await vi.importActual<typeof import('../src/ui/overlays.ts')>('../src/ui/overlays.ts')
    vi.mocked(pickFromListWithSearch).mockImplementationOnce(real.pickFromListWithSearch)
    const tui = new TuiAltScreen(terminal())
    const show = vi.spyOn(tui, 'showOverlay')
    const picked = pickModel(tui, llm)
    try {
      await vi.waitFor(() => { expect(show).toHaveBeenCalledOnce() })
      const panel = show.mock.calls[0]![0]
      panel.handleInput?.('gateway/openai/test-model')
      expect(panel.render(160).join('\n')).toContain('Friendly Model')
      expect(panel.render(160).join('\n')).not.toContain('no matches')
      panel.handleInput?.('\r')
      expect(await picked).toEqual({ provider: 'gateway', model: 'openai/test-model' })
    } finally { tui.stop() }
  })

  it.each(['Friendly Model', 'gateway/openai/test-model', 'My gateway'])('selects by %s without sending a display name to the provider', async (query) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const resolveCallConfig = vi.fn(async (config: LlmCallConfig) => config)
    ctx.provide('llm', { ...llm, resolveCallConfig })
    const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId('model-label')))
    const tui = new TuiAltScreen(terminal())
    const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
    try {
      screen.submit(`/model ${query}`)
      await vi.waitFor(() => { expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'gateway', model: 'openai/test-model' }) })
    } finally { tui.stop(); await ctx.fiber.dispose() }
  })
})

describe('reasoning effort across model switches', () => {
  it.each([
    { efforts: ['low', 'high'], defaultEffort: undefined, expected: 'high' },
    { efforts: ['low'], defaultEffort: undefined, expected: undefined },
    { efforts: [], defaultEffort: undefined, expected: undefined },
    { efforts: ['low'], defaultEffort: 'low', expected: 'low' },
  ])('validates the destination controls $efforts and default $defaultEffort before saving', async ({ efforts, defaultEffort, expected }) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const prior = { provider: 'old', model: 'old-model', reasoningEffort: ReasoningEffortId('high') }
    const saveSelection = vi.fn()
    ctx.provide('agentDefaultModel', { currentSelection: () => prior, saveSelection })
    const resolveModelInfo = vi.fn(async () => ({
      provider: 'gateway', id: 'openai/test-model', name: 'Friendly Model',
      ...efforts.length === 0 ? {} : { reasoning: {
        efforts: efforts.map(id => ({ id: ReasoningEffortId(id), name: id })),
      } },
    }))
    const resolveCallConfig = vi.fn(async (config: LlmCallConfig) => {
      if (config.reasoningEffort !== undefined && !efforts.includes(config.reasoningEffort)) {
        throw new Error('UNSUPPORTED_REASONING_EFFORT')
      }
      return { ...config, ...config.reasoningEffort === undefined && defaultEffort !== undefined
        ? { reasoningEffort: ReasoningEffortId(defaultEffort) } : {} }
    })
    ctx.provide('llm', { ...llm, resolveModelInfo, resolveCallConfig })
    const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId('effort-switch')), prior)
    const tui = new TuiAltScreen(terminal())
    const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
    screen.handleEvent(agent.session.append('request/header', { header: { config: prior }, reason: 'initial' }))
    try {
      screen.submit('/model gateway/openai/test-model')
      await vi.waitFor(() => { expect(saveSelection).toHaveBeenCalledWith({
        provider: 'gateway', model: 'openai/test-model',
        ...expected === undefined ? {} : { reasoningEffort: expected },
      }) })
      expect(resolveModelInfo).toHaveBeenCalledWith('gateway', 'openai/test-model')
      expect(resolveCallConfig).toHaveBeenCalledWith({
        provider: 'gateway', model: 'openai/test-model',
        ...efforts.includes('high') ? { reasoningEffort: 'high' } : {},
      })
      const assembly = { sections: [], contexts: [], tools: [], variables: {} }
      await agent.ctx.waterfall('system-prompt/assemble', assembly, {}, async () => assembly)
      const selected = await agentEvents(agent.ctx, agent).waterfall('agent/request', {
        turn: 1, step: 1, signal: new AbortController().signal,
      }, async () => ({ ...prior }))
      expect(selected.reasoningEffort).toBe(expected)
    } finally { tui.stop(); await ctx.fiber.dispose() }
  })
})
