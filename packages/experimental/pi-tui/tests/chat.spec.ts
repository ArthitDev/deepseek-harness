import { stripVTControlCharacters } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AssistantStreamAccumulator, boundContextSummary, createMessage, createSystemMessage, createUserMessage, ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import { ChatScreen } from '../src/ui/chat.ts'
import { StatusBar } from '../src/ui/views.ts'
import { fixtureAgent } from './fixture-agent.ts'

/** Wait for the fake terminal's scheduled render and read its visible text. */
async function renderScreen(tui: TuiAltScreen): Promise<string> {
  tui.requestRender()
  await setTimeout(30)
  return stripVTControlCharacters(tui.getScreenLines().join('\n'))
}

describe('running subagents in the status bar', () => {
  it('shows Wiki availability for the visible session and follows tool changes', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const first = fixtureAgent(ctx, ctx.sessions.create(SessionId('wiki-enabled')))
    const second = fixtureAgent(ctx, ctx.sessions.create(SessionId('wiki-denied')))
    let available = true
    ctx.provide('tools', { get: (name: string, scope: Agent) => name === 'knowledge_list' && available && scope === first ? {} : undefined })
    const terminal: Terminal = {
      columns: 100, rows: 40, kittyProtocolActive: false,
      start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    const screen = new ChatScreen({ ctx, tui, agent: first, config: {}, onQuit: vi.fn() })
    tui.start()
    try {
      expect(await renderScreen(tui)).toContain('📚 Wiki')
      screen.switchAgent(second)
      expect(await renderScreen(tui)).not.toContain('📚 Wiki')
      screen.switchAgent(first)
      expect(await renderScreen(tui)).toContain('📚 Wiki')
      available = false
      ctx.events.emit(null, 'tools/change')
      expect(await renderScreen(tui)).not.toContain('📚 Wiki')
    } finally { tui.stop(); await ctx.fiber.dispose() }
  })

  it('tracks lifecycle events per session, ignores duplicates, and releases listeners on disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const makeAgent = async (id: string): Promise<Agent> => {
      const owner = await ctx.plugin(() => {})
      return fixtureAgent(owner.ctx.extend({ testParent: id }), ctx.sessions.create(SessionId(id)))
    }
    const first = await makeAgent('first-parent')
    const second = await makeAgent('second-parent')
    const nested = await makeAgent('nested-parent')
    const terminal: Terminal = {
      columns: 40, rows: 80, kittyProtocolActive: false,
      start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    const screen = new ChatScreen({ ctx, tui, agent: first, config: {}, onQuit: vi.fn() })
    const stopAnimation = vi.spyOn(StatusBar.prototype, 'stop')
    const emit = (parent: Agent, event: 'subagent/start' | 'subagent/end', runId: string, ancestors: readonly string[] = []): void => {
      ctx.events.emit({
        [Context.filter]: (listener: Context & { testParent?: string }) =>
          listener.testParent === undefined || listener.testParent === parent.id || ancestors.includes(listener.testParent),
      }, event, { runId })
    }
    tui.start()
    try {
      expect(await renderScreen(tui)).not.toContain(' agents')
      emit(second, 'subagent/start', 'unrelated')
      expect(await renderScreen(tui)).not.toContain(' agents')
      emit(first, 'subagent/start', 'local-run')
      emit(first, 'subagent/start', 'external-run')
      emit(first, 'subagent/start', 'local-run')
      expect(await renderScreen(tui)).toContain('2 agents')
      emit(nested, 'subagent/start', 'nested-run', [first.id])
      expect(await renderScreen(tui)).toContain('3 agents')
      screen.switchAgent(nested)
      expect(await renderScreen(tui)).toContain('1 agents')
      screen.switchAgent(first)
      expect(await renderScreen(tui)).toContain('3 agents')
      emit(nested, 'subagent/end', 'nested-run', [first.id])
      expect(await renderScreen(tui)).toContain('2 agents')
      emit(first, 'subagent/end', 'local-run')
      expect(await renderScreen(tui)).toContain('1 agents')
      screen.switchAgent(second)
      expect(await renderScreen(tui)).toContain('1 agents')
      emit(second, 'subagent/start', 'second-run')
      expect(await renderScreen(tui)).toContain('2 agents')
      emit(first, 'subagent/end', 'external-run')
      expect(await renderScreen(tui)).toContain('2 agents')
      screen.switchAgent(first)
      expect(await renderScreen(tui)).not.toContain(' agents')
      screen.switchAgent(second)
      expect(await renderScreen(tui)).toContain('2 agents')
      emit(second, 'subagent/end', 'second-run')
      expect(await renderScreen(tui)).toContain('1 agents')
      emit(second, 'subagent/end', 'unrelated')
      expect(await renderScreen(tui)).not.toContain(' agents')
      emit(second, 'subagent/start', 'active-at-disposal')
      expect(await renderScreen(tui)).toContain('1 agents')
      stopAnimation.mockClear()
      await ctx.fiber.dispose()
      expect(stopAnimation).toHaveBeenCalledOnce()
      emit(second, 'subagent/start', 'disposed-run')
      expect(await renderScreen(tui)).toContain('1 agents')
    } finally {
      tui.stop()
      await ctx.fiber.dispose()
      stopAnimation.mockRestore()
    }
  })
})

describe('exit and resume hints', () => {
  it.each(['slash', 'ctrl-d', 'ctrl-c'] as const)('exits through %s with the currently visible saved session', async (entry) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const original = fixtureAgent(ctx, ctx.sessions.create(SessionId('previous-session')))
    const resumed = fixtureAgent(ctx, ctx.sessions.create(SessionId('00000000-0000-4000-8000-000000000001')))
    const originalFollowup = vi.spyOn(original, 'followup')
    const resumedFollowup = vi.spyOn(resumed, 'followup')
    resumed.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'saved conversation' }] }), { surfaceOp: 'append' })
    const start = vi.fn<Terminal['start']>()
    const terminal: Terminal = {
      columns: 100, rows: 40, kittyProtocolActive: false,
      start, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    const onQuit = vi.fn()
    const screen = new ChatScreen({ ctx, tui, agent: original, config: {}, onQuit })
    tui.start()
    try {
      screen.switchAgent(resumed)
      const input = (data: string): void => { start.mock.calls[0]?.[0](data) }
      if (entry === 'slash') {
        screen.handleEvent(resumed.session.append('turn/start', { turn: 1 }))
        screen.submit('/exit')
      } else if (entry === 'ctrl-d') input('\x04')
      else { input('\x03'); input('\x03') }
      expect(onQuit).toHaveBeenCalledExactlyOnceWith(`session: ${resumed.id}\nresume: dsh tui --resume ${resumed.id}`)
      screen.submit('/exit')
      screen.submit('do not send after exit')
      expect(onQuit).toHaveBeenCalledOnce()
      expect(originalFollowup).not.toHaveBeenCalled()
      expect(resumedFollowup).not.toHaveBeenCalled()
    } finally { tui.stop(); await ctx.fiber.dispose() }
  })

  it('exits an empty session without advertising unsaved history', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId('empty-exit')))
    const followup = vi.spyOn(agent, 'followup')
    const terminal: Terminal = {
      columns: 100, rows: 40, kittyProtocolActive: false,
      start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    const onQuit = vi.fn()
    const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit })
    try {
      screen.submit('/exit')
      expect(onQuit).toHaveBeenCalledExactlyOnceWith(undefined)
      expect(followup).not.toHaveBeenCalled()
    } finally { tui.stop(); await ctx.fiber.dispose() }
  })
})

describe('/new model selection', () => {
  it('keeps the latest selected provider and model across repeated new sessions', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const startup = { provider: 'antigravity', model: 'gemini-3.1-pro-low' }
    const selected = { provider: 'b-ai', model: 'glm-5.3-flash' }
    const saveSelection = vi.fn()
    ctx.provide('agentDefaultModel', { currentSelection: () => startup, saveSelection })
    ctx.provide('llm', {
      listProviders: () => [{ id: selected.provider }],
      listModels: async () => [{ id: selected.model, provider: selected.provider }],
      resolveCallConfig: async () => selected,
    })
    const makeAgent = (id: SessionId, options = startup): Agent => fixtureAgent(ctx, ctx.sessions.create(id), options)
    const create = vi.fn(async (input: { sessionId: SessionId; agentOptions: typeof selected }) => ({
      agent: makeAgent(input.sessionId, input.agentOptions),
    }))
    ctx.provide('agents', { create })
    const terminal: Terminal = {
      columns: 100, rows: 80, kittyProtocolActive: false,
      start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    const onAgentSwitch = vi.fn()
    const screen = new ChatScreen({
      ctx, tui, agent: makeAgent(SessionId('before-new')), config: startup,
      onQuit: vi.fn(), onAgentSwitch,
    })
    tui.start()
    try {
      screen.submit(`/model ${selected.provider}/${selected.model}`)
      await vi.waitFor(() => { expect(saveSelection).toHaveBeenCalledWith(selected) })
      for (let count = 1; count <= 2; count++) {
        screen.submit('/new')
        await vi.waitFor(() => { expect(onAgentSwitch).toHaveBeenCalledTimes(count) })
        expect(create.mock.calls[count - 1]?.[0].agentOptions).toEqual(selected)
        tui.requestRender()
        await setTimeout(30)
        const rendered = stripVTControlCharacters(tui.getScreenLines().join('\n'))
        expect(rendered).toContain(selected.model)
        expect(rendered).not.toContain(startup.model)
      }
    } finally {
      tui.stop()
      await ctx.fiber.dispose()
    }
  })
})

describe('preset switches with conversation history', () => {
  it.each(['preset', 'model'] as const)('opens an independent session through /%s and keeps its model and preset', async (command) => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-tui-preset-command-'))
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.provide('profileContext', { home })
    const oldRoute = { provider: 'mock', model: 'old-model' }
    const newRoute = command === 'model' ? { provider: 'mock', model: 'new-model' } : oldRoute
    let saved = oldRoute
    ctx.provide('agentDefaultModel', { currentSelection: () => saved, saveSelection: async (route: typeof saved) => { saved = route } })
    ctx.provide('llm', {
      listProviders: () => [{ id: 'mock' }], listModels: async () => [{ id: 'new-model', provider: 'mock' }],
      resolveCallConfig: async (route: typeof oldRoute) => route,
    })
    const mounted = new WeakMap<Context, string>()
    const source = fixtureAgent(ctx.extend({ testParent: 'preset-source' }), ctx.sessions.create(SessionId(`switch-${command}`)), oldRoute)
    mounted.set(source.ctx, 'old-preset')
    const session = source.session
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('system/message', { turn: 1, step: 1, message: createSystemMessage('OLD_PRESET') }, { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'retained question' }] }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({ source: { kind: 'knowledge-context', form: 'instructions', digest: 'old-wiki' }, content: [{ type: 'text', text: 'OLD_WIKI_GUIDANCE' }] }), { surfaceOp: 'append' })
    session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createMessage({ role: 'assistant', source: { kind: 'model', ...oldRoute }, content: [{ type: 'text', text: 'retained answer' }] }) }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const original = session.snapshotEvents()
    const select = vi.fn(async (agent: Agent, id: string) => { mounted.set(agent.ctx, id); return id })
    ctx.provide('agentPresets', {
      list: async () => ['old-preset', 'new-preset'].map(id => ({ id, name: id, trust: 'user' })),
      resolve: async (id: string) => ({ id }), mount: async (agentCtx: Context, id: string) => { mounted.set(agentCtx, id) },
      composedPreset: (agentCtx: Context) => mounted.get(agentCtx), presetIdForModel: () => 'new-preset', select,
    })
    const create = vi.fn(async (input: Parameters<typeof ctx.agents.create>[0]) => {
      const agent = fixtureAgent(ctx.extend({ testParent: String(input.sessionId) }), ctx.sessions.create(input.sessionId, {
        ...input.seed === undefined ? {} : { seed: input.seed },
        ...input.meta === undefined ? {} : { meta: input.meta },
        ...input.inheritedEventCount === undefined ? {} : { inheritedEventCount: input.inheritedEventCount },
      }), input.agentOptions)
      await input.setup?.(agent.ctx, agent)
      return { agent, dispose: vi.fn() }
    })
    ctx.provide('agents', { create })
    const terminal: Terminal = {
      columns: 120, rows: 80, kittyProtocolActive: false,
      start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    const onAgentSwitch = vi.fn()
    const screen = new ChatScreen({ ctx, tui, agent: source, config: { ...oldRoute, preset: 'old-preset' }, onQuit: vi.fn(), onAgentSwitch })
    tui.start()
    try {
      screen.submit(command === 'preset' ? '/preset new-preset' : '/model mock/new-model')
      await vi.waitFor(() => { expect(onAgentSwitch).toHaveBeenCalledOnce() })
      const child = (onAgentSwitch.mock.calls[0]![0] as { agent: Agent }).agent
      expect(child.id).not.toBe(source.id)
      expect(child.session.inheritedEventCount).toBe(0)
      expect(create.mock.calls[0]![0].meta).toMatchObject({ agentPreset: 'new-preset', parentSession: source.id })
      expect(select).toHaveBeenCalledWith(child, 'new-preset')
      expect(JSON.stringify(child.session.deriveMessages())).not.toContain('OLD_PRESET')
      expect(JSON.stringify(child.session.deriveMessages())).not.toContain('OLD_WIKI_GUIDANCE')
      expect(source.session.snapshotEvents()).toEqual(original)
      const rendered = await renderScreen(tui)
      expect(rendered).toContain('retained question')
      expect(rendered).toContain('retained answer')
      expect(rendered).toContain('new-preset')
      expect(rendered).toContain(newRoute.model)
      screen.submit('/preset new-preset')
      await renderScreen(tui)
      expect(create).toHaveBeenCalledOnce()
      screen.submit('/new')
      await vi.waitFor(() => { expect(onAgentSwitch).toHaveBeenCalledTimes(2) })
      expect(create.mock.calls[1]![0]).toMatchObject({ agentOptions: newRoute, meta: { agentPreset: 'new-preset' } })
      const currentId = screen.currentSessionId
      create.mockRejectedValueOnce(new Error('unavailable preset'))
      screen.submit('/preset old-preset')
      await vi.waitFor(async () => { expect(await renderScreen(tui)).toContain('unavailable preset') })
      expect(screen.currentSessionId).toBe(currentId)
      expect(onAgentSwitch).toHaveBeenCalledTimes(2)
      const current = (onAgentSwitch.mock.calls[1]![0] as { agent: Agent }).agent
      screen.handleEvent(current.session.append('turn/start', { turn: 1 }))
      screen.submit('/preset old-preset')
      expect(await renderScreen(tui)).toContain('cannot switch presets while work is running')
      expect(create).toHaveBeenCalledTimes(3)
    } finally {
      tui.stop()
      await ctx.fiber.dispose()
      await rm(home, { recursive: true, force: true })
    }
  })
})

describe('reasoning picker commands', () => {
  it.each(['slash', 'shortcut'] as const)('opens via %s, applies once, and cancels while working', async (entry) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const route = { provider: 'gateway', model: 'test-model' }
    const saveSelection = vi.fn()
    const resolveCallConfig = vi.fn(async (config: LlmCallConfig) => config)
    ctx.provide('agentDefaultModel', { currentSelection: () => route, saveSelection })
    ctx.provide('llm', {
      resolveCallConfig,
      resolveModelInfo: async () => ({
        provider: route.provider, id: route.model, name: 'Test Model',
        reasoning: { efforts: ['low', 'high', 'max'].map(id => ({ id: ReasoningEffortId(id), name: id })) },
      }),
    })
    const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId(`reasoning-${entry}`)), route)
    const start = vi.fn<Terminal['start']>()
    const terminal: Terminal = {
      columns: 120, rows: 50, kittyProtocolActive: false,
      start, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    const show = vi.spyOn(tui, 'showOverlay')
    const screen = new ChatScreen({ ctx, tui, agent, config: route, onQuit: vi.fn() })
    tui.start()
    const input = (data: string): void => { start.mock.calls[0]?.[0](data) }
    const open = (): void => { if (entry === 'slash') screen.submit('/thinking'); else input('\x18') }
    try {
      open()
      open()
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
      expect(show).toHaveBeenCalledOnce()
      expect(await renderScreen(tui)).toContain('Select Reasoning Level for Test Model')
      input('2')
      expect(saveSelection).not.toHaveBeenCalled()
      input('\r')
      await vi.waitFor(() => { expect(saveSelection).toHaveBeenCalledOnce() })
      expect(saveSelection).toHaveBeenLastCalledWith({ ...route, reasoningEffort: ReasoningEffortId('high') })
      expect(resolveCallConfig).toHaveBeenCalledOnce()
      expect(tui.hasOverlay()).toBe(false)

      open()
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
      expect(await renderScreen(tui)).toContain('high (current)')
      const cancel = vi.spyOn(agent, 'cancel')
      screen.handleEvent(agent.session.append('turn/start', { turn: 1 }))
      input('\x1b')
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(false) })
      expect(cancel).not.toHaveBeenCalled()
      expect(saveSelection).toHaveBeenCalledOnce()
      screen.submit('/thinking low')
      await vi.waitFor(() => { expect(saveSelection).toHaveBeenCalledTimes(2) })
      expect(saveSelection).toHaveBeenLastCalledWith({ ...route, reasoningEffort: ReasoningEffortId('low') })
      expect(resolveCallConfig).toHaveBeenCalledTimes(2)
    } finally {
      tui.stop()
      await ctx.fiber.dispose()
    }
  })
})

describe('/providers', () => {
  it('lists routes and key status using one credential reference per call', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const route = { provider: 'gateway', model: 'model' }
    ctx.provide('llm', {
      listProviders: () => [
        { id: 'gateway', name: 'Gateway' }, { id: 'missing', name: 'Missing Key' }, { id: 'native', name: 'Native Auth' },
      ],
      listModels: async (id: string) => id === 'gateway' ? [{ id: 'model' }, { id: 'other-model' }] : [],
    })
    const describeSettings = vi.fn(() => [{ ns: 'llm-pi-ai', value: { providers: {
      gateway: { apiKeyEnv: 'TEST_GATEWAY_KEY' }, missing: { apiKeyEnv: 'TEST_MISSING_KEY' },
    } } }])
    ctx.provide('settings', { describe: describeSettings })
    const describe = vi.fn((ref: string) => Promise.resolve({ configured: ref.toUpperCase() === 'TEST_GATEWAY_KEY' }))
    const resolve = vi.fn()
    ctx.provide('credentials', { describe, resolve })
    const terminal: Terminal = {
      columns: 140, rows: 50, kittyProtocolActive: false,
      start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId('providers')), route)
    const followup = vi.spyOn(agent, 'followup')
    const onQuit = vi.fn()
    const screen = new ChatScreen({ ctx, tui, agent, config: route, onQuit })
    tui.start()
    try {
      screen.submit('/providers')
      await vi.waitFor(() => { expect(describe).toHaveBeenCalledTimes(2) }, { timeout: 500 })
      const rendered = await renderScreen(tui)
      expect(rendered).toContain('gateway ← current — Gateway · 2 model(s) · key ✓ (TEST_GATEWAY_KEY)')
      expect(rendered).toContain('missing — Missing Key · 0 model(s) · key ✗ — /key TEST_MISSING_KEY')
      expect(rendered).toContain('native — Native Auth · 0 model(s) · provider-native auth')
      expect(describe.mock.calls).toEqual([['TEST_GATEWAY_KEY'], ['TEST_MISSING_KEY']])
      expect(rendered.split('\n').filter(line => line.includes(' model(s)')).map(line => line.trimEnd())).toMatchInlineSnapshot(`
        [
          " ℹ gateway ← current — Gateway · 2 model(s) · key ✓ (TEST_GATEWAY_KEY)",
          " ℹ missing — Missing Key · 0 model(s) · key ✗ — /key TEST_MISSING_KEY",
          " ℹ native — Native Auth · 0 model(s) · provider-native auth",
        ]
      `)
      expect(resolve).not.toHaveBeenCalled()
      expect(onQuit).not.toHaveBeenCalled()
      expect(followup).not.toHaveBeenCalled()

      describeSettings.mockImplementationOnce(() => { throw new Error('settings unavailable') })
      screen.submit('/providers')
      await vi.waitFor(async () => {
        expect(await renderScreen(tui)).toContain('command failed: settings unavailable')
      })
      expect(onQuit).not.toHaveBeenCalled()

      describe.mockImplementationOnce(() => { throw new Error('credential metadata unavailable') })
      screen.submit('/providers')
      await vi.waitFor(() => { expect(describe).toHaveBeenCalledTimes(4) })
      expect(await renderScreen(tui)).toContain('key status unavailable (TEST_GATEWAY_KEY)')
      expect(onQuit).not.toHaveBeenCalled()
      expect(resolve).not.toHaveBeenCalled()
    } finally {
      tui.stop()
      await ctx.fiber.dispose()
    }
  })
})

describe('/clear transcript', () => {
  it.each(['empty', 'system-only', 'failed-attempt', 'hidden-context', 'wiki-context'] as const)(
    'clears visible command output and stale text with %s model history', async (history) => {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      const session = ctx.sessions.create(SessionId(`clear-notices-${history}`))
      const agent = fixtureAgent(ctx, session)
      const terminal: Terminal = {
        columns: 100, rows: 60, kittyProtocolActive: false,
        start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
        moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
        clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
      }
      const tui = new TuiAltScreen(terminal)
      const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
      tui.start()
      try {
        const system = createSystemMessage('PRESET_SENTINEL')
        if (history !== 'empty') session.append('system/message', { turn: 1, step: 1, message: system }, { surfaceOp: 'append' })
        if (history === 'hidden-context') {
          const hidden = session.append('user/message', createUserMessage({
            content: [{ type: 'text', text: 'hidden shell context' }],
            source: { kind: 'pi-tui', form: 'notice', summary: boundContextSummary('test shell command') },
          }), { surfaceOp: 'append' })
          screen.handleEvent(hidden)
        }
        if (history === 'wiki-context') {
          screen.handleEvent(session.append('user/message', createUserMessage({
            content: [{ type: 'text', text: 'WIKI_GUIDANCE_BEFORE_CLEAR' }],
            source: { kind: 'knowledge-context', form: 'instructions', digest: 'wiki' },
          }), { surfaceOp: 'append' }))
        }
        if (history === 'failed-attempt') {
          screen.handleEvent(session.append('turn/start', { turn: 1 }))
          const stream = new AssistantStreamAccumulator()
          stream.push({ time: 0, chunk: { type: 'text-delta', index: 0, text: 'old failed answer' } })
          stream.push({ time: 1, chunk: { type: 'reasoning-delta', index: 1, text: 'old failed thinking' } })
          screen.handleEvent(session.append('assistant/attempt', { turn: 1, step: 1, stream: [...stream.snapshot()] }))
          screen.handleEvent(session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }))
        }
        screen.pushNotice('old command output')
        expect(await renderScreen(tui)).toContain('old command output')
        const before = session.snapshotEvents()
        screen.submit('/clear')
        const cleared = await renderScreen(tui)
        expect(cleared).not.toContain('old command output')
        expect(cleared).not.toContain('old failed answer')
        expect(cleared).not.toContain('old failed thinking')
        expect(cleared).not.toContain('turn aborted')
        expect(cleared).not.toContain('already clear')
        expect(cleared.match(/session cleared/g)).toHaveLength(1)
        expect(cleared.split('\n').filter(line => line.includes('session cleared')).map(line => line.trim())).toMatchInlineSnapshot(`
          [
            "» session cleared — same session, fresh context",
          ]
        `)
        expect(screen.currentSessionId).toBe(session.id)
        expect(session.deriveMessages()).toEqual(history === 'empty' ? [] : [system])
        if (history !== 'hidden-context' && history !== 'wiki-context') expect(session.snapshotEvents()).toEqual(before)
        screen.submit('/clear')
        expect((await renderScreen(tui)).match(/session cleared/g)).toHaveLength(1)
      } finally {
        tui.stop()
        await ctx.fiber.dispose()
      }
    },
  )

  it.each([
    { delivery: 'synchronous', preset: 'gemini-pro' },
    { delivery: 'deferred', preset: 'gemini-pro' },
    { delivery: 'unsubscribed', preset: 'gemini-pro' },
    { delivery: 'synchronous', preset: undefined },
  ] as const)(
    'shows mounted preset $preset and clears old rendered text with $delivery event delivery',
    async ({ delivery, preset }) => {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      ctx.provide('agentPresets', {
        defaultId: 'shield-break-agent',
        composedPreset: () => preset,
      })
      const session = ctx.sessions.create(SessionId(`clear-${delivery}`))
      const agent = fixtureAgent(ctx, session)
      const terminal: Terminal = {
        columns: 100, rows: 80, kittyProtocolActive: false,
        start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
        moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
        clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
      }
      const tui = new TuiAltScreen(terminal)
      const screen = new ChatScreen({ ctx, tui, agent, config: { version: 'test' }, onQuit: vi.fn() })
      tui.start()
      try {
        const system = createSystemMessage('system')
        session.append('system/message', { turn: 1, step: 1, message: system }, { surfaceOp: 'append' })
        const question = session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'old question' }], source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        screen.handleEvent(question)
        const answer = session.append('assistant/message', {
          turn: 1, step: 1, stream: [],
          message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'old answer' }], source: { kind: 'model', provider: 'mock', model: 'mock' } }),
        }, { surfaceOp: 'append' })
        screen.handleEvent(answer)
        screen.pushNotice('old command output')
        const initial = await renderScreen(tui)
        expect(initial).toContain('› old question')
        expect(initial).toContain('old answer')
        expect(initial).not.toContain('shield-break-agent')
        if (preset !== undefined) expect(initial).toContain(preset)

        if (delivery !== 'unsubscribed') {
          ctx.on('session/event', (_session, event) => {
            if (delivery === 'synchronous') screen.handleEvent(event)
            else void Promise.resolve().then(() => { screen.handleEvent(event) })
          })
        }
        screen.submit('/clear')
        await Promise.resolve()
        const cleared = await renderScreen(tui)
        expect(cleared).not.toContain('old question')
        expect(cleared).not.toContain('old answer')
        expect(cleared).not.toContain('old command output')
        expect(cleared.match(/session cleared/g)).toHaveLength(1)
        expect(screen.currentSessionId).toBe(session.id)
        expect(session.snapshotEvents()).toContainEqual(answer)
        expect(session.deriveMessages()).toEqual([system])

        // One cleared notice becomes one replacement notice, leaving the item count unchanged.
        screen.submit('/clear')
        await Promise.resolve()
        expect((await renderScreen(tui)).match(/session cleared/g)).toHaveLength(1)
      } finally {
        tui.stop()
        await ctx.fiber.dispose()
      }
    },
  )
})
