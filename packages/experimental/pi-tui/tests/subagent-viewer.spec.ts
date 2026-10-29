import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SubagentRuntime, { SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent'
import { createMessage, createUserMessage, LlmAttemptId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { TuiAltScreen, visibleWidth, type Terminal, type TuiMouseEvent } from '@earendil-works/pi-tui'
import { ChatScreen } from '../src/ui/chat.ts'
import { StatusBar } from '../src/ui/views.ts'
import { inspectSubagent } from '../src/ui/subagent-viewer.ts'
import { fixtureAgent } from './fixture-agent.ts'

class TranscriptQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> { throw new Error('search unused') }
  override searchEvents(): Promise<never> { throw new Error('search unused') }
}

const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tui-subagents-'))
  const ctx = new Context()
  const start = vi.fn<Terminal['start']>()
  // Terminal dimensions are getter-only on the interface; the fixture keeps a
  // live mutable size so resize assertions can move the viewport.
  const size = { columns: 100, rows: 32 }
  const terminal: Terminal = { get columns() { return size.columns }, get rows() { return size.rows }, kittyProtocolActive: false,
    start, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(), moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(),
    clearLine: vi.fn(), clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn() }
  const tui = new TuiAltScreen(terminal)
  let screen!: ChatScreen
  const onAgentSwitch = vi.fn()
  try {
    await ctx.plugin(Loader)
    Object.assign(ctx.loader.builtins, { include: Include, sessions: SessionStore, agents: AgentRegistry,
      projections: SessionProjectionRegistry, query: TranscriptQuery, subagents: SubagentRuntime,
      screen: { name: 'subagent-screen-fixture', inject: ['sessions', 'agents', 'subagents'], apply: async (scope: Context) => {
        const agent = fixtureAgent(scope, scope.sessions.create(SessionId('parent-viewer')))
        await scope.agents.register(agent)
        screen = new ChatScreen({ ctx: scope, tui, agent, config: {}, onQuit: vi.fn(), onAgentSwitch })
      } },
    })
    const path = join(root, 'cordis.yml')
    await writeFile(path, JSON.stringify(['sessions', 'agents', 'projections', 'query', 'subagents', 'screen'].map(name => ({ name: `cordis:${name}` }))))
    await ctx.loader.root.update([{ id: 'include', name: 'cordis:include', config: { path: pathToFileURL(path).href } }])
    await ctx.loader.await()
    expect(screen).toBeDefined()
    tui.start()
    return { ctx, tui, size, terminal, screen, onAgentSwitch,
      key: (data: string) => start.mock.calls[0]?.[0](data),
      frame: () => { tui.renderNow(); return stripVTControlCharacters(tui.getScreenLines().join('\n')) },
      dispose: async () => { tui.stop(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) },
    }
  } catch (error) { tui.stop(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); throw error }
}

describe('read-only subagent inspection', () => {
  it('opens from the agent count while the parent runs, follows child tools and streams, and returns without cancelling either agent', async () => {
    const h = await setup()
    const { ctx, tui, screen, key, frame } = h
    try {
      const parent = ctx.agents.get(SessionId('parent-viewer'))!
      const cancelParent = vi.spyOn(parent, 'cancel')
      const session = ctx.sessions.create(SessionId('child-viewer'), { meta: { origin: 'subagent', parentSession: parent.id } })
      session.append('subagent/descriptor', { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'test', label: 'Inspect the parser' })
      const childScope = await ctx.plugin(() => {})
      const child = fixtureAgent(childScope.ctx, session)
      const cancelChild = vi.spyOn(child, 'cancel')
      await ctx.agents.register(child)
      const nested = ctx.sessions.create(SessionId('nested-viewer'), { meta: { origin: 'subagent', parentSession: child.id } })
      nested.append('subagent/descriptor', { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'one-shot', provider: 'test', label: 'Nested review' })
      for (let i = 0; i < 25; i++) session.append('user/message', user(`child-message-${i}`), { surfaceOp: 'append' })
      screen.handleEvent(parent.session.append('turn/start', { turn: 1 }))
      screen.handleEvent(parent.session.append('user/message', user('parent keeps working'), { surfaceOp: 'append' }))
      ctx.events.emit({ [Context.filter]: () => true }, 'subagent/start', { runId: 'visible-child-run' })
      const lines = frame().split('\n')
      const y = lines.findIndex(line => line.includes('1 agents'))
      const x = lines[y]!.indexOf('1 agents')
      key(`\x1b[<0;${x + 1};${y + 1}M`)
      key(`\x1b[<0;${x + 1};${y + 1}m`)
      await vi.waitFor(() => { expect(frame()).toContain('Enter inspect') })
      expect(frame()).toContain('Nested review')
      expect(frame()).toContain('continuable')
      key('\r')
      await vi.waitFor(() => { expect(frame()).toContain('Subagent · Inspect the parser') })
      expect(frame()).toContain('5 older items')
      expect(frame()).not.toContain('child-message-0\n')
      expect(frame().split('\n').map(line => line.trimEnd()).join('\n')).toMatchSnapshot('child transcript window')
      h.size.rows = 20
      key('a')
      frame()
      key('\x1b[H')
      expect(frame()).toContain('child-message-0')
      expect(frame()).not.toContain('child-message-24')
      key('\x1b[F')
      expect(frame()).toContain('child-message-24')
      const callId = ToolCallId('child-tool')
      session.append('tool/call', { turn: 1, step: 1, callId, name: 'read', arguments: '{"path":"parser.ts"}' })
      session.append('tool/result', { turn: 1, step: 1, message: createMessage({ role: 'tool', source: { kind: 'tool', callId },
        toolCallId: callId, content: [{ type: 'text', text: 'parser tool result' }] }) }, { surfaceOp: 'append' })
      key('\x0f')
      key('\x1b[F')
      expect(frame()).toContain('parser tool result')
      const stream = { type: 'chunk', attemptId: LlmAttemptId('viewer-stream'), revision: 1, index: 0, time: 1 } as const
      ctx.events.emit('agent/assistant-stream', { agent: parent, frame: { ...stream, chunk: { type: 'text-delta', text: 'parent stream must stay out' } } })
      child.ctx.events.emit('agent/assistant-stream', { agent: child, frame: { ...stream, chunk: { type: 'text-delta', text: 'child live response' } } })
      await vi.waitFor(() => { expect(frame()).toContain('child live response') })
      expect(frame()).not.toContain('parent stream must stay out')
      screen.handleEvent(parent.session.append('user/message', user('parent event while inspecting'), { surfaceOp: 'append' }))
      key('\x1b')
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(false) })
      expect(frame()).toContain('parent event while inspecting')
      expect(cancelParent).not.toHaveBeenCalled()
      expect(cancelChild).not.toHaveBeenCalled()
      expect(h.onAgentSwitch).not.toHaveBeenCalled()
      expect(ctx.agents.get(parent.id)).toBe(parent)
      expect(ctx.agents.get(child.id)).toBe(child)
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      key('\x1b[103;7u')
      await vi.waitFor(() => { expect(frame()).toContain('Enter inspect') })
      key('\r')
      await vi.waitFor(() => { expect(frame()).toContain('Subagent · Inspect') })
      key('\x03')
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(false) })
      expect(cancelParent).not.toHaveBeenCalled()
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      screen.submit('/agents')
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
      await ctx.fiber.dispose()
      expect(tui.hasOverlay()).toBe(false)
    } finally { await h.dispose() }
  })

  it('reads saved history with a borrowed handle, refreshes without resuming, and cleans up on disposal', async () => {
    const h = await setup()
    try {
      const saved = Session.create(SessionId('saved-viewer'))
      saved.append('user/message', user('saved child question'), { surfaceOp: 'append' })
      const close = vi.fn(async () => {})
      const open = vi.fn(async () => ({ header: saved.header, read: async () => ({ events: saved.snapshotEvents() }), close }))
      h.ctx.provide('sessionPersistence', { open })
      const resume = vi.spyOn(h.ctx.agents, 'resume')
      const viewing = inspectSubagent(h.ctx, h.tui, saved.id, 'Archived child', 20)
      await vi.waitFor(() => { expect(h.frame()).toContain('Saved snapshot') })
      expect(open).toHaveBeenCalledWith(saved.id, 'read')
      expect(close).toHaveBeenCalledOnce()
      expect(h.frame()).toContain('saved child question')
      saved.append('user/message', user('new saved message'), { surfaceOp: 'append' })
      h.key('r')
      await vi.waitFor(() => { expect(h.frame()).toContain('new saved message') })
      expect(close).toHaveBeenCalledTimes(2)
      open.mockRejectedValueOnce(new Error('history temporarily unavailable'))
      h.key('r')
      await vi.waitFor(() => { expect(h.frame()).toContain('history temporarily unavailable') })
      expect(h.frame()).toContain('new saved message')
      h.size.columns = 36
      h.size.rows = 18
      h.key('\x1b[5~')
      expect(h.frame()).toContain('Archived child')
      await h.ctx.fiber.dispose()
      await viewing
      expect(h.tui.hasOverlay()).toBe(false)
      expect(resume).not.toHaveBeenCalled()
    } finally { await h.dispose() }
  })

  it('reports unreadable history and does not open a late overlay after disposal', async () => {
    const h = await setup()
    try {
      await expect(inspectSubagent(h.ctx, h.tui, SessionId('missing'), 'Missing child', 20)).rejects.toThrow('no readable session history')
      expect(h.tui.hasOverlay()).toBe(false)
      const saved = Session.create(SessionId('late-viewer'))
      const pending = Promise.withResolvers<{ events: readonly import('@deepseek-ai/dsh-session').SessionEvent[] }>()
      const close = vi.fn(async () => {})
      h.ctx.provide('sessionPersistence', { open: async () => ({ header: saved.header, read: () => pending.promise, close }) })
      const viewing = inspectSubagent(h.ctx, h.tui, saved.id, 'Late child', 20)
      await h.ctx.fiber.dispose()
      pending.resolve({ events: [] })
      await viewing
      expect(close).toHaveBeenCalledOnce()
      expect(h.tui.hasOverlay()).toBe(false)
    } finally { await h.dispose() }
  })

  it('only activates the visible agent-count segment after wrapping and clears its hit area when hidden', async () => {
    const h = await setup()
    const inspect = vi.fn()
    const bar = new StatusBar(h.tui, inspect)
    try {
      for (const width of [100, 24]) {
        bar.update({ model: '模型', subagentsRunning: 3 })
        const lines = bar.render(width).map(stripVTControlCharacters)
        const y = lines.findIndex(line => line.includes('3 agents'))
        const x = visibleWidth(lines[y]!.slice(0, lines[y]!.indexOf('3 agents')))
        const event: TuiMouseEvent = { type: 'click', button: 'left', x, y, screenX: x, screenY: y,
          width, height: lines.length, shift: false, ctrl: false, alt: false }
        inspect.mockClear()
        expect(bar.handleMouse({ ...event, x: width - 1 })).toBeUndefined()
        expect(bar.handleMouse({ ...event, type: 'press' })?.handled).toBe(true)
        expect(inspect).not.toHaveBeenCalled()
        expect(bar.handleMouse(event)?.handled).toBe(true)
        expect(inspect).toHaveBeenCalledOnce()
        expect(bar.handleMouse({ ...event, button: 'right' })).toBeUndefined()
        bar.update({})
        bar.render(width)
        expect(bar.handleMouse(event)).toBeUndefined()
      }
      bar.update({ subagentsRunning: 1 })
      bar.render(1)
      expect(bar.handleMouse({ type: 'click', button: 'left', x: 0, y: 0, screenX: 0, screenY: 0,
        width: 1, height: 1, shift: false, ctrl: false, alt: false })).toBeUndefined()
    } finally { bar.stop(); await h.dispose() }
  })
})
