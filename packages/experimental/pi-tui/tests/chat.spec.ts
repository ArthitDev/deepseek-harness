import { stripVTControlCharacters } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { AssistantStreamAccumulator, boundContextSummary, createMessage, createSystemMessage, createUserMessage, ReasoningEffortId, ToolCallId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import TerminalSessionService, { TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import type { TerminalBackend, TerminalSendOperation } from '@deepseek-ai/dsh-terminal'
import { Text, TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import { ChatScreen } from '../src/ui/chat.ts'
import { ShellPane, PANE_POLL_MS, type ShellPaneSession } from '../src/ui/shell-pane.ts'
import { StatusBar, ToolCardView } from '../src/ui/views.ts'
import { fixtureAgent } from './fixture-agent.ts'
import * as gitState from '../src/core/git.ts'

/** Wait for the fake terminal's scheduled render and read its visible text. */
async function renderScreen(tui: TuiAltScreen): Promise<string> {
  // Render synchronously: a scheduled render plus a fixed sleep races
  // under parallel-suite load and reads stale frames.
  tui.renderNow()
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
      await screen.switchAgent(second)
      expect(await renderScreen(tui)).not.toContain('📚 Wiki')
      await screen.switchAgent(first)
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
      await screen.switchAgent(nested)
      expect(await renderScreen(tui)).toContain('1 agents')
      await screen.switchAgent(first)
      expect(await renderScreen(tui)).toContain('3 agents')
      emit(nested, 'subagent/end', 'nested-run', [first.id])
      expect(await renderScreen(tui)).toContain('2 agents')
      emit(first, 'subagent/end', 'local-run')
      expect(await renderScreen(tui)).toContain('1 agents')
      await screen.switchAgent(second)
      expect(await renderScreen(tui)).toContain('1 agents')
      emit(second, 'subagent/start', 'second-run')
      expect(await renderScreen(tui)).toContain('2 agents')
      emit(first, 'subagent/end', 'external-run')
      expect(await renderScreen(tui)).toContain('2 agents')
      await screen.switchAgent(first)
      expect(await renderScreen(tui)).not.toContain(' agents')
      await screen.switchAgent(second)
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
  it('loads folded tool images only when revealed and reloads evicted images', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const readImage = vi.fn(async () => ({ data: new Uint8Array([1, 2, 3]) }))
    ctx.provide('attachments', { readImage })
    const session = ctx.sessions.create(SessionId('bounded-images'))
    const callId = ToolCallId('saved-image')
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'read_image', arguments: '{}' })
    session.append('tool/result', { turn: 1, step: 1, message: createMessage({ role: 'tool',
      source: { kind: 'tool', callId }, toolCallId: callId,
      content: [{ type: 'image', attachment: { attachmentId: AttachmentId('saved-image'),
        mediaType: 'image/png', bytes: 3, width: 1, height: 1 } }] }) }, { surfaceOp: 'append' })
    for (let i = 0; i < 5; i++) {
      session.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: `after-image-${i}` }] }), { surfaceOp: 'append' })
    }
    const agent = fixtureAgent(ctx, session)
    const tui = new TuiAltScreen({ columns: 120, rows: 25, kittyProtocolActive: false,
      start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(), moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(),
      clearLine: vi.fn(), clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn() })
    const screen = new ChatScreen({ ctx, tui, agent, config: { historyLimit: 3 }, onQuit: vi.fn() })
    const setImages = vi.spyOn(ToolCardView.prototype, 'setImages')
    tui.start()
    try {
      await screen.replayTranscript(agent)
      expect(readImage).not.toHaveBeenCalled()
      screen.submit('/expand-all')
      await vi.waitFor(() => { expect(setImages).toHaveBeenCalledTimes(1) })
      screen.submit('/expand-all')
      screen.submit('/expand-all')
      await vi.waitFor(() => { expect(setImages).toHaveBeenCalledTimes(2) })
      expect(readImage).toHaveBeenCalledTimes(2)
    } finally { tui.stop(); setImages.mockRestore(); await ctx.fiber.dispose() }
  })

  it.each([undefined, 3])('creates only the visible history views with limit %s', async (historyLimit) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('bounded-history'))
    for (let i = 1; i <= 120; i++) {
      session.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: `saved-${i}` }] }), { surfaceOp: 'append' })
    }
    const agent = fixtureAgent(ctx, session)
    const tui = new TuiAltScreen({ columns: 120, rows: 25, kittyProtocolActive: false,
      start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(), moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(),
      clearLine: vi.fn(), clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn() })
    const screen = new ChatScreen({ ctx, tui, agent,
      config: historyLimit === undefined ? {} : { historyLimit }, onQuit: vi.fn() })
    const createView = vi.spyOn(await import('../src/ui/views.ts'), 'createView')
    tui.start()
    try {
      await screen.replayTranscript(agent)
      expect(createView).toHaveBeenCalledTimes(historyLimit ?? 20)
      expect(createView.mock.calls.map(([item]) => item.text)).not.toContain('saved-1')
      expect(await renderScreen(tui)).toContain('saved-120')
      if (historyLimit === 3) {
        expect(tui.getScreenLines().map(line => stripVTControlCharacters(line))).toMatchSnapshot('bounded history')
      }
      createView.mockClear()
      screen.handleEvent(session.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: 'live-latest' }] }), { surfaceOp: 'append' }))
      expect(createView).toHaveBeenCalledTimes(1)
      expect(await renderScreen(tui)).toContain('live-latest')

      screen.submit('/expand-all')
      expect(createView.mock.calls.map(([item]) => item.text)).toContain('saved-1')
      screen.handleEvent(session.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: 'live-expanded' }] }), { surfaceOp: 'append' }))
      expect(await renderScreen(tui)).toContain('live-expanded')
      screen.submit('/expand-all')
      createView.mockClear()
      screen.submit('/expand-all')
      expect(createView.mock.calls.map(([item]) => item.text)).toContain('saved-1')
      expect(session.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(122)
    } finally { tui.stop(); createView.mockRestore(); await ctx.fiber.dispose() }
  })

  it('replays a seeded session once even when its parent no longer exists', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const open = vi.fn(async () => { throw new Error('session "missing-parent" not found') })
    ctx.provide('sessionPersistence', { open })
    const original = ctx.sessions.create(SessionId('seed-source'))
    original.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'saved question' }] }), { surfaceOp: 'append' })
    original.append('assistant/message', { turn: 1, step: 1, stream: [], message: createMessage({ role: 'assistant',
      source: { kind: 'model', provider: 'mock', model: 'mock' }, content: [{ type: 'text', text: 'saved answer' }] }) }, { surfaceOp: 'append' })
    const resumedSession = ctx.sessions.create(SessionId('seeded-resume'), {
      seed: original.snapshotEvents(), inheritedEventCount: SessionLogOffset(original.seq),
      meta: { parentSession: SessionId('missing-parent'), isSeeded: true },
    })
    const first = fixtureAgent(ctx, ctx.sessions.create(SessionId('current-resume')))
    const resumed = fixtureAgent(ctx, resumedSession)
    const tui = new TuiAltScreen({ columns: 120, rows: 30, kittyProtocolActive: false,
      start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(), moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(),
      clearLine: vi.fn(), clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn() })
    const screen = new ChatScreen({ ctx, tui, agent: first, config: {}, onQuit: vi.fn() })
    tui.start()
    try {
      await screen.switchAgent(resumed)
      const text = await renderScreen(tui)
      expect(text.match(/› saved question/g)).toHaveLength(1)
      expect(text.split('\n').filter(line => line.trimStart().startsWith('saved answer'))).toHaveLength(1)
      expect(open).not.toHaveBeenCalled()
      expect(tui.getScreenLines().map(line => stripVTControlCharacters(line)))
        .toMatchSnapshot('resumed inherited messages with a missing parent')
      const history = resumed.session.snapshotEvents()
      const followup = vi.spyOn(resumed, 'followup')
      screen.submit('/recap')
      expect((await renderScreen(tui)).match(/Recap · Request: saved question/g)).toHaveLength(2)
      screen.submit('/recap unexpected')
      expect(await renderScreen(tui)).toContain('usage: /recap')
      expect(resumed.session.snapshotEvents()).toEqual(history)
      expect(followup).not.toHaveBeenCalled()
    } finally { tui.stop(); await ctx.fiber.dispose() }
  })

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
      await screen.switchAgent(resumed)
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
          " ℹ gateway ← current — Gateway · 2 model(s) · key ✓ (TEST_GATEWAY_KEY)                      │",
          " ℹ missing — Missing Key · 0 model(s) · key ✗ — /key TEST_MISSING_KEY                       │",
          " ℹ native — Native Auth · 0 model(s) · provider-native auth                                 │",
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
            "» session cleared — same session, fresh context    │",
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

/** One PTY backend whose single session answers reads with a fixed tail. */
function stubPaneBackend(type: string, tail: string): TerminalBackend {
  return {
    type,
    spawn: async () => ({
      motd: `stub ${type} ready`,
      startSend: () => settledOperation(''),
      read: () => ({ text: tail, totalLines: 1, lineBegin: 0, lineEnd: 1, truncated: false }),
      signal: async () => ({ delivered: true, targetPgid: 1 }),
      status: () => ({ kind: 'running' }),
      close: async () => {},
    }),
  }
}

function settledOperation(viewport: string): TerminalSendOperation {
  return {
    done: Promise.resolve({ viewport, waitReason: 'stdin_read', sessionStatus: { kind: 'running' }, truncated: false }),
    readOutput: () => ({ delta: '', truncated: false }),
    cancel: () => false,
  }
}

describe('the split-pane shell', () => {
  it('stages a scoped shell draft without execution, overwrites, or focus changes', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const harness = await mountAgentLoopTestHarness(ctx)
    const agent = await harness.create(SessionId('shell-draft'))
    const other = await harness.create(SessionId('other-draft-owner'))
    await ctx.plugin(TerminalSessionService)
    ctx.terminals.registerBackend(stubPaneBackend('shell', 'shell ready'))
    ctx.terminals.registerBackend(stubPaneBackend('kali', 'kali ready'))
    const sends = vi.spyOn(ctx.terminals, 'startSend')
    const start = vi.fn<Terminal['start']>()
    const terminal: Terminal = {
      columns: 100, rows: 40, kittyProtocolActive: false,
      start, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
    const draft = (command: unknown, shell = 'win') => ctx.tools.execute({
      name: 'shell_draft', arguments: { command, shell }, agent,
      callId: ToolCallId('draft-call'), signal: new AbortController().signal,
    })
    const schemas = (scope = agent) => ctx.tools.schemas(scope).map(tool => tool.name)
    const input = (data: string): void => { start.mock.calls[0]?.[0](data) }
    tui.start()
    try {
      expect(schemas()).not.toContain('shell_draft')
      screen.submit('/shell win')
      await vi.waitFor(() => { expect(schemas()).toContain('shell_draft') })
      expect(schemas(other)).not.toContain('shell_draft')
      screen.cycleShellFocus()
      const focus = vi.spyOn(tui, 'setFocus')
      expect((await draft('Get-Date', 'kali')).isError).toBe(true)
      for (const command of [42, ' ', '\x1b[31mGet-Date', '\x9b31mGet-Date', 'Get-Date\r']) {
        expect((await draft(command)).isError).toBe(true)
      }
      const deny = agent.ctx.tools.guard(execution => execution.name === 'shell_draft' ? 'draft not approved' : undefined)
      expect((await draft('Get-Date')).isError).toBe(true)
      deny()
      const staged = await draft('Get-Date')
      expect(staged.isError).toBe(false)
      expect(staged.content).toMatchSnapshot('draft handoff result')
      expect(focus).not.toHaveBeenCalled()
      expect(sends).not.toHaveBeenCalled()
      await renderScreen(tui)
      const right = (): string => tui.getScreenLines()
        .map(line => stripVTControlCharacters(line).slice(54)).join('\n')
      expect(right()).toContain('Get-Date')
      expect((await draft('Get-Location')).isError).toBe(true)
      await renderScreen(tui)
      expect(right()).toContain('Get-Date')
      expect(right()).not.toContain('Get-Location')
      expect(sends).not.toHaveBeenCalled()
      screen.submit('/shell kali')
      await vi.waitFor(async () => {
        expect(await renderScreen(tui)).toContain('shell input is not empty')
      })
      expect(right()).toContain('Shell · win')
      expect(right()).toContain('Get-Date')
      expect(tui.getScreenLines().map(line => stripVTControlCharacters(line).slice(51)))
        .toMatchSnapshot('shell draft awaiting human submission')
      screen.cycleShellFocus()
      input('\r')
      await vi.waitFor(() => { expect(sends).toHaveBeenCalledOnce() })
      expect(sends.mock.calls[0]?.[2]).toMatchObject({ text: 'Get-Date', submit: true })
      screen.submit('/shell kali')
      await vi.waitFor(async () => { expect(await renderScreen(tui)).toContain('Shell · kali') })
      expect((await draft('Get-Date')).isError).toBe(true)
      expect((await draft('pwd\nwhoami', 'kali')).isError).toBe(false)
      await renderScreen(tui)
      expect(right()).toContain('pwd')
      expect(right()).toContain('whoami')
      expect(sends).toHaveBeenCalledOnce()
      screen.submit('/shell close')
      expect(schemas()).not.toContain('shell_draft')
      expect((await draft('pwd', 'kali')).isError).toBe(true)
      await screen.switchAgent(other)
      expect(schemas(other)).not.toContain('shell_draft')
    } finally {
      tui.stop()
      await ctx.fiber.dispose()
    }
  })

  it('opens the shared shell beside the chat, cycles focus, then toggles closed', async () => {
    // A late Git status can add a wrapped row and move both editors during a snapshot.
    const readGitState = vi.spyOn(gitState, 'readGitState').mockResolvedValue(undefined)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(TerminalSessionService)
    ctx.terminals.registerBackend(stubPaneBackend('shell', 'stub shell tail'))
    const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId('shell-pane')))
    await ctx.agents.register(agent)
    const start = vi.fn<Terminal['start']>()
    const terminal: Terminal = {
      columns: 100, rows: 40, kittyProtocolActive: false,
      start, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
    tui.start()
    try {
      expect(await renderScreen(tui)).toContain('Agent Debug')
      expect(await renderScreen(tui)).not.toContain('Shell · win')
      expect(tui.getScreenLines().map(line => stripVTControlCharacters(line).slice(51)))
        .toMatchSnapshot('tool activity without a shell')
      const input = (data: string): void => { start.mock.calls[0]?.[0](data) }
      screen.submit('/shell bogus')
      expect(await renderScreen(tui)).toContain('usage: /shell [win|kali|close]')
      screen.submit('/shell kali')
      await vi.waitFor(async () => {
        expect(await renderScreen(tui)).toContain('no "kali" PTY backend is mounted')
      })
      screen.submit('/shell')
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
      expect(await renderScreen(tui)).toContain('1. Windows')
      expect(await renderScreen(tui)).toContain('2. Kali')
      expect(tui.getScreenLines().map(line => stripVTControlCharacters(line)))
        .toMatchSnapshot('shell picker')
      input('\r')
      await vi.waitFor(async () => {
        expect(await renderScreen(tui)).toContain('── ▾ Shell · win')
      })
      expect(await renderScreen(tui)).toContain('stub shell tail')
      const lines = tui.getScreenLines().map(line => stripVTControlCharacters(line))
      const borders = (column: number): number[] => lines.flatMap((line, row) =>
        /^─{5}/.test(line.slice(column)) ? [row] : [])
      expect(borders(54)).toEqual(borders(0))
      expect(borders(54)).toHaveLength(2)
      expect(tui.getScreenLines().map(line => stripVTControlCharacters(line).slice(51)))
        .toMatchSnapshot('shared shell and resize divider')
      expect(await renderScreen(tui)).toContain('Agent Debug')
      screen.handleEvent({
        type: 'tool/call', seq: SessionSeq(1), time: 0,
        data: { turn: 1, step: 1, callId: ToolCallId('live-command'), name: 'pwsh', arguments: '{"command":"Get-Date"}' },
      })
      await renderScreen(tui)
      const activity = (): string => tui.getScreenLines()
        .map(line => stripVTControlCharacters(line).slice(54)).join('\n')
      expect(activity()).toContain('[RUNNING] Shell · pwsh')
      expect(activity()).toContain('Get-Date')
      screen.handleEvent({
        type: 'tool/result', seq: SessionSeq(2), time: 0, surfaceOp: 'append',
        data: {
          turn: 1, step: 1,
          message: createMessage({
            role: 'tool', toolCallId: ToolCallId('live-command'),
            source: { kind: 'tool', callId: ToolCallId('live-command') },
            content: [{ type: 'text', text: 'finished\nsecond line only expanded' }],
          }),
        },
      })
      await renderScreen(tui)
      expect(activity()).toContain('[OK] Shell · pwsh')
      expect(activity()).not.toContain('[RUNNING]')
      expect(activity()).toContain('stub shell tail')
      expect(activity()).not.toContain('second line only expanded')
      const debugSends = vi.spyOn(ctx.terminals, 'startSend')
      input('\x1b[100;7u')
      input('\r')
      expect(await renderScreen(tui)).toContain('second line only expanded')
      expect(debugSends).not.toHaveBeenCalled()
      const interrupt = vi.spyOn(agent, 'cancel')
      input('\x1b')
      expect(interrupt).not.toHaveBeenCalled()
      expect(await renderScreen(tui)).toContain('── ▾ Shell · win')
      debugSends.mockRestore()
      screen.submit('/agent-debug bogus')
      expect(await renderScreen(tui)).toContain('usage: /agent-debug')
      expect(activity()).toContain('Agent Debug')
      input('pending command')
      const sends = vi.spyOn(ctx.terminals, 'startSend')
      const focus = vi.spyOn(tui, 'setFocus')
      screen.submit('/agent-debug')
      expect(await renderScreen(tui)).not.toContain('Agent Debug')
      expect(activity()).toContain('Shell · win')
      expect(activity()).toContain('pending command')
      expect(tui.getScreenLines().map(line => stripVTControlCharacters(line).slice(51)))
        .toMatchSnapshot('shell with agent debug hidden')
      screen.submit('/agent-debug')
      await renderScreen(tui)
      expect(activity()).toContain('[OK] Shell · pwsh')
      expect(activity()).toContain('pending command')
      expect(sends).not.toHaveBeenCalled()
      expect(focus).not.toHaveBeenCalled()
      const shellColumn = async (): Promise<number> =>
        (await renderScreen(tui)).split('\n').find(line => line.includes('Shell · win'))?.indexOf('──') ?? -1
      expect(await shellColumn()).toBe(54)
      input('\x1b[1;7D')
      expect(await shellColumn()).toBe(52)
      input('\x1b[1;7C')
      expect(await shellColumn()).toBe(54)
      const overlay = tui.showOverlay(new Text('modal', 0, 0))
      input('\x1b[1;7D')
      overlay.hide()
      expect(await shellColumn()).toBe(54)
      // Focused pane: the status chip reads bright and the header offers Esc.
      expect(await renderScreen(tui)).toContain('⌨ shell:win')
      // Ctrl+P cycle: focus returns to chat, pane keeps rendering unfocused.
      screen.cycleShellFocus()
      expect(await renderScreen(tui)).toContain('── ▸ Shell · win')
      input('\x1b[1;7C')
      expect(await shellColumn()).toBe(56)
      screen.cycleShellFocus()
      expect(await renderScreen(tui)).toContain('── ▾ Shell · win')
      screen.submit('/shell')
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
      input('\x1b')
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(false) })
      expect(await renderScreen(tui)).toContain('── ▾ Shell · win')
      screen.submit('/shell')
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
      expect(await renderScreen(tui)).toContain('3. Close shell')
      input('3')
      input('\r')
      await vi.waitFor(async () => { expect(await renderScreen(tui)).not.toContain('Shell · win') })
      expect(await renderScreen(tui)).not.toContain('⌨ shell:')
      expect(await renderScreen(tui)).toContain('Agent Debug')
      screen.submit('/agent-debug')
      expect(await renderScreen(tui)).not.toContain('Agent Debug')
      screen.handleEvent({
        type: 'tool/call', seq: SessionSeq(3), time: 0,
        data: { turn: 1, step: 1, callId: ToolCallId('without-shell'), name: 'read_file', arguments: '{"path":"README.md"}' },
      })
      screen.submit('/agent-debug')
      await renderScreen(tui)
      expect(activity()).toContain('[RUNNING] Tool · read_file')
      input('\x1b[1;7D')
      await renderScreen(tui)
      expect(tui.getScreenLines()[0]).toContain('Agent Debug')
      expect(stripVTControlCharacters(tui.getScreenLines()[0] ?? '').indexOf('──')).toBe(54)
      input('\x1b[1;7C')
      screen.submit('/shell win')
      await vi.waitFor(async () => {
        expect(await renderScreen(tui)).toContain('Shell · win')
      })
      expect(activity()).toContain('[OK] Shell · pwsh')
      expect(activity().match(/Agent Debug/g)).toHaveLength(1)
      const next = fixtureAgent(ctx, ctx.sessions.create(SessionId('next-tools-session')))
      await ctx.agents.register(next)
      await screen.switchAgent(next)
      await renderScreen(tui)
      expect(activity()).toContain('Agent Debug')
      expect(activity()).not.toContain('read_file')
      expect(activity()).not.toContain('Get-Date')
    } finally {
      readGitState.mockRestore()
      tui.stop()
      await ctx.fiber.dispose()
    }
  })

  it('rebinds the mounted pane between win and kali backends', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(TerminalSessionService)
    ctx.terminals.registerBackend(stubPaneBackend('shell', 'win tail'))
    ctx.terminals.registerBackend(stubPaneBackend('kali', 'kali tail\n┌──(root㉿kali-test)-[/tmp]\n└─# '))
    const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId('shell-rebind')))
    await ctx.agents.register(agent)
    const start = vi.fn<Terminal['start']>()
    const terminal: Terminal = {
      columns: 100, rows: 40, kittyProtocolActive: false,
      start, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
    tui.start()
    try {
      screen.submit('/shell win')
      await vi.waitFor(async () => {
        expect(await renderScreen(tui)).toContain('win tail')
      })
      screen.submit('/shell')
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
      const input = (data: string): void => { start.mock.calls[0]?.[0](data) }
      input('\x1b[B')
      input('\r')
      await vi.waitFor(async () => {
        expect(await renderScreen(tui)).toContain('── ▾ Shell · kali')
      })
      expect(await renderScreen(tui)).toContain('kali tail')
      expect(await renderScreen(tui)).toContain('┌──(root㉿kali-test)-[/tmp]')
      // Same variant refocuses instead of closing.
      screen.cycleShellFocus()
      screen.submit('/shell kali')
      expect(await renderScreen(tui)).toContain('── ▾ Shell · kali')
      screen.handleEvent({ type: 'turn/start', seq: SessionSeq(1), time: 0, data: { turn: 1 } })
      const interrupt = vi.spyOn(agent, 'cancel')
      screen.submit('/shell')
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
      input('\x1b')
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(false) })
      expect(interrupt).not.toHaveBeenCalled()
      expect(await renderScreen(tui)).toContain('── ▾ Shell · kali')
    } finally {
      tui.stop()
      await ctx.fiber.dispose()
    }
  })

  it('streams pane input to the PTY and renders the retained tail', async () => {
    const sent: string[] = []
    let tail = 'first boot'
    const completion = Promise.withResolvers<Awaited<TerminalSendOperation['done']>>()
    const readOutput = vi.fn(() => ({ delta: '', truncated: false }))
    const session: ShellPaneSession = {
      id: TerminalSessionId('pane-test'),
      owner: fixtureAgent(new Context(), Session.create(SessionId('pane-owner'))),
      terminals: {
        listBackends: () => ['shell'],
        list: () => [],
        spawn: async () => ({
          sessionId: TerminalSessionId('pane-test'), motd: '', type: 'shell', status: { kind: 'running' },
        }),
        startSend: (_owner, _id, request) => {
          sent.push(request.text)
          tail = `ran: ${request.text.trim()}`
          return { done: completion.promise, readOutput, cancel: () => false }
        },
        read: () => ({ text: tail, totalLines: 1, lineBegin: 0, lineEnd: 1, truncated: false }),
      },
    }
    const terminal: Terminal = {
      columns: 46, rows: 20, kittyProtocolActive: false,
      start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    vi.useFakeTimers()
    tui.start()
    const onClose = vi.fn()
    const pane = new ShellPane(tui, session, 'win', 'Shell · test', onClose)
    try {
      expect(pane.render(46).join('\n')).toContain('── ▸ Shell · test')
      expect(pane.render(46).join('\n')).toContain('first boot')
      const requestRender = vi.spyOn(tui, 'requestRender')
      requestRender.mockClear()
      const sending = pane.send('whoami')
      await vi.advanceTimersByTimeAsync(PANE_POLL_MS)
      expect(pane.render(46).join('\n')).toContain('ran: whoami')
      requestRender.mockClear()
      readOutput.mockReturnValueOnce({ delta: 'ran: whoami', truncated: false })
      await vi.advanceTimersByTimeAsync(80)
      expect(requestRender).toHaveBeenCalled()
      expect(pane.render(46).join('\n').match(/ran: whoami/g)).toHaveLength(1)
      requestRender.mockClear()
      completion.resolve(await settledOperation(tail).done)
      await sending
      expect(requestRender).toHaveBeenCalled()
      expect(sent).toEqual(['whoami'])
      expect(pane.render(46).join('\n')).toContain('ran: whoami')
      pane.editor.onSubmit?.('/exit')
      expect(onClose).toHaveBeenCalledOnce()
    } finally {
      pane.dispose()
      tui.stop()
      vi.useRealTimers()
    }
  })

  it('polls the shared session so agent-run output appears live', async () => {
    let tail = 'first boot'
    let totalLines = 1
    const session: ShellPaneSession = {
      id: TerminalSessionId('pane-poll'),
      owner: fixtureAgent(new Context(), Session.create(SessionId('pane-poll-owner'))),
      terminals: {
        listBackends: () => ['shell'],
        list: () => [],
        spawn: async () => ({
          sessionId: TerminalSessionId('pane-poll'), motd: '', type: 'shell', status: { kind: 'running' },
        }),
        startSend: () => settledOperation(''),
        read: () => ({ text: tail, totalLines, lineBegin: 0, lineEnd: totalLines, truncated: false }),
      },
    }
    const terminal: Terminal = {
      columns: 46, rows: 20, kittyProtocolActive: false,
      start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    tui.start()
    vi.useFakeTimers()
    try {
      const pane = new ShellPane(tui, session, 'win', 'Shell · poll')
      expect(pane.render(46).join('\n')).toContain('first boot')
      // The agent writes to the shared session out-of-band; the poll picks it up.
      tail = 'nmap scan results'
      totalLines = 9
      await vi.advanceTimersByTimeAsync(PANE_POLL_MS + 50)
      expect(pane.render(46).join('\n')).toContain('nmap scan results')
      pane.dispose()
      tail = 'after dispose'
      await vi.advanceTimersByTimeAsync(PANE_POLL_MS + 50)
      expect(pane.render(46).join('\n')).toContain('nmap scan results')
      expect(pane.render(46).join('\n')).not.toContain('after dispose')
    } finally {
      vi.useRealTimers()
      tui.stop()
    }
  })

  it('pins the latest Kali prompt through clear, updates its directory, and drops it on rebind', async () => {
    let tail = 'boot output\n┌──(root㉿kali-test)-[/tmp]\n└─# '
    const ctx = new Context()
    const session: ShellPaneSession = {
      id: TerminalSessionId('kali-prompt'),
      owner: fixtureAgent(ctx, Session.create(SessionId('kali-prompt-owner'))),
      terminals: {
        listBackends: () => ['kali'], list: () => [],
        spawn: async () => ({ sessionId: TerminalSessionId('kali-prompt'), motd: '' }),
        startSend: () => settledOperation(''),
        read: () => ({ text: tail, totalLines: tail.split('\n').length, lineBegin: 0, lineEnd: tail.split('\n').length, truncated: false }),
      },
    }
    const terminal: Terminal = {
      columns: 60, rows: 16, kittyProtocolActive: false,
      start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
      moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
      clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
    }
    const tui = new TuiAltScreen(terminal)
    const pane = new ShellPane(tui, session, 'kali', 'Shell · kali', undefined, () => 2)
    tui.setLayoutRoot(pane)
    tui.setFocus(pane.editor)
    tui.start()
    try {
      const initial = await renderScreen(tui)
      expect(initial.match(/root㉿kali-test/g)).toHaveLength(1)
      expect(initial).toContain('boot output')
      const lines = initial.split('\n')
      expect(lines[9]?.trim()).toBe('┌──(root㉿kali-test)-[/tmp]')
      expect(lines[10]?.trim()).toBe('└─#')
      expect(lines[11]?.trim()).toBe('─'.repeat(60))
      tail = ''
      pane.renderTail()
      const cleared = await renderScreen(tui)
      expect(cleared).not.toContain('boot output')
      expect(cleared).toContain('┌──(root㉿kali-test)-[/tmp]')
      expect(cleared).toMatchSnapshot('Kali prompt after clear')
      tail = `${Array.from({ length: 30 }, (_, index) => `output ${index}`).join('\n')}\n┌──(root㉿kali-test)-[/var/log]\n└─# `
      pane.renderTail()
      const updated = await renderScreen(tui)
      expect(updated).toContain('output 29')
      expect(updated).not.toContain('[/tmp]')
      expect(updated.match(/root㉿kali-test/g)).toHaveLength(1)
      expect(updated).toContain('[/var/log]')
      pane.rebind(session, 'win', 'Shell · win')
      expect(await renderScreen(tui)).not.toContain('kali ❯')
      tail = ''
      pane.rebind(session, 'kali', 'Shell · kali')
      expect(await renderScreen(tui)).not.toContain('root㉿kali-test')
      expect(await renderScreen(tui)).toContain('kali ❯')
    } finally { pane.dispose(); tui.stop(); await ctx.fiber.dispose() }
  })
})
