import { describe, expect, it, vi } from 'vitest'
import { stripVTControlCharacters } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { ReasoningEffortId, type LlmCallConfig, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
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
    clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(), setProgramStatus: vi.fn(),
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
    expect(vi.mocked(pickFromListWithSearch).mock.lastCall?.[1].body).toBe('current: Friendly Model (gateway)')
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
    ctx.provide('llm', { ...llm, resolveCallConfig,
      resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: 'Friendly Model' }),
    })
    const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId('model-label')))
    const tui = new TuiAltScreen(terminal())
    const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
    try {
      screen.submit(`/model ${query}`)
      await vi.waitFor(() => { expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'gateway', model: 'openai/test-model' }) })
      tui.start()
      tui.renderNow()
      const visible = stripVTControlCharacters(tui.getScreenLines().join('\n'))
      expect(visible).toContain('🤖 Friendly Model')
      expect(visible).toContain('model → Friendly Model (gateway)')
    } finally { tui.stop(); await ctx.fiber.dispose() }
  })

  it.each([false, true])('shows the configured name, with metadata failure %s falling back to the id', async (fails) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const route = { provider: 'epit-local', model: 'gemma4-26b-a4b-uncensored' }
    const resolveModelInfo = vi.fn(async () => {
      if (fails) throw new Error('catalog unavailable')
      return { provider: route.provider, id: route.model, name: 'Qwen3.8-27B-Uncensored' }
    })
    ctx.provide('llm', { ...llm, resolveModelInfo })
    const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId('configured-model-name')), route)
    const select = vi.spyOn(agent.model, 'select')
    const tui = new TuiAltScreen(terminal())
    const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
    try {
      await screen.ready()
      tui.start()
      tui.renderNow()
      const visible = stripVTControlCharacters(tui.getScreenLines().join('\n'))
      const name = fails ? route.model : 'Qwen3.8-27B-Uncensored'
      expect(visible).toContain(`model: ${name}`)
      expect(visible).toContain(`🤖 ${name}`)
      expect(select).toHaveBeenCalledExactlyOnceWith(route)
      screen.handleEvent(agent.session.append('turn/start', { turn: 1 }))
      tui.renderNow()
      tui.renderNow()
      expect(resolveModelInfo).toHaveBeenCalledOnce()
    } finally { tui.stop(); await ctx.fiber.dispose() }
  })

  it('ignores a late startup label after selecting another model', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const startup = { provider: 'epit-local', model: 'gemma4-26b-a4b-uncensored' }
    const pending = Promise.withResolvers<LlmResolvedModelInfo>()
    const resolveCallConfig = vi.fn(async (config: LlmCallConfig) => config)
    ctx.provide('llm', { ...llm, resolveCallConfig,
      resolveModelInfo: async (provider: string, model: string) => model === startup.model
        ? pending.promise : { provider, id: model, name: 'Friendly Model' },
    })
    const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId('late-model-label')), startup)
    const select = vi.spyOn(agent.model, 'select')
    const tui = new TuiAltScreen(terminal())
    const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
    const ready = screen.ready()
    try {
      screen.submit('/model gateway/openai/test-model')
      await vi.waitFor(() => { expect(select).toHaveBeenLastCalledWith({ provider: 'gateway', model: 'openai/test-model' }) })
      pending.resolve({ provider: startup.provider, id: startup.model, name: 'Qwen3.8-27B-Uncensored' })
      await ready
      tui.start()
      tui.renderNow()
      const visible = stripVTControlCharacters(tui.getScreenLines().join('\n'))
      expect(visible).toContain('model: Friendly Model')
      expect(visible).toContain('🤖 Friendly Model')
      expect(visible).not.toContain('Qwen3.8-27B-Uncensored')
    } finally {
      pending.resolve({ provider: startup.provider, id: startup.model, name: 'Qwen3.8-27B-Uncensored' })
      await ready
      tui.stop()
      await ctx.fiber.dispose()
    }
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
    // Route-aware: the screen validates the seeded header effort against the
    // CURRENT route's adapter info before a switch, so the old route must
    // advertise the effort its recorded header used.
    const resolveModelInfo = vi.fn(async (provider: string, model: string) => ({
      provider, id: model, name: 'Friendly Model',
      ...(provider === 'old' ? { reasoning: {
        efforts: [{ id: ReasoningEffortId('high'), name: 'high' }],
      } } : efforts.length === 0 ? {} : { reasoning: {
        efforts: efforts.map(id => ({ id: ReasoningEffortId(id), name: id })),
      } }),
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
    const select = vi.spyOn(agent.model, 'select')
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
      // 0.2.2 records the validated pick on the agent's durable selection;
      // agent/request can no longer adjust the effort after step preparation.
      expect(select.mock.calls).toContainEqual([{
        provider: 'gateway', model: 'openai/test-model',
        ...expected === undefined ? {} : { reasoningEffort: ReasoningEffortId(expected) },
      }])
    } finally { tui.stop(); await ctx.fiber.dispose() }
  })
})
