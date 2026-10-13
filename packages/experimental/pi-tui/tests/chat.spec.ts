import { stripVTControlCharacters } from 'node:util'
import { setTimeout } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
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

describe('/clear transcript', () => {
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
        session.append('system/message', { turn: 1, step: 1, message: createSystemMessage('system') }, { surfaceOp: 'append' })
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
