import { stripVTControlCharacters } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createMessage, createUserMessage, LlmAttemptId } from '@deepseek-ai/dsh-llm'
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import { ChatScreen } from '../src/ui/chat.ts'
import { fixtureAgent } from './fixture-agent.ts'
import * as views from '../src/ui/views.ts'

async function historyFixture(historyLimit = 20) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('lazy-history'))
  for (let index = 1; index <= 200; index++) {
    session.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: `saved-${String(index).padStart(3, '0')}` }] }), { surfaceOp: 'append' })
  }
  const agent = fixtureAgent(ctx, session)
  let input: (data: string) => void = () => {}
  const size = { columns: 120, rows: 18 }
  const terminal: Terminal = {
    get columns() { return size.columns }, get rows() { return size.rows }, kittyProtocolActive: false,
    start: (onInput) => { input = onInput }, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
    moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
    clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(), setProgramStatus: vi.fn(),
  }
  const tui = new TuiAltScreen(terminal)
  const screen = new ChatScreen({ ctx, tui, agent, config: { historyLimit, cwd: join(tmpdir(), 'deepseek-harness') }, onQuit: vi.fn() })
  tui.start()
  await screen.replayTranscript(agent)
  const frame = () => {
    tui.renderNow()
    return tui.getScreenLines().map(line => stripVTControlCharacters(line))
  }
  const text = () => frame().join('\n')
  return { ctx, session, agent, tui, screen, terminal, frame, text, size,
    input: (data: string) => { input(data) },
    dispose: async () => { tui.stop(); await ctx.fiber.dispose() } }
}

describe('lazy transcript history', () => {
  it('reaches all older and newer messages by scrolling while retaining a bounded set of views', async () => {
    const fixture = await historyFixture()
    const createView = vi.spyOn(views, 'createView')
    try {
      const original = fixture.session.snapshotEvents()
      expect(fixture.text()).toContain('saved-200')
      expect(fixture.text()).not.toContain('saved-001')
      let previous: string[] | undefined
      for (let step = 0; step < 800 && !fixture.text().includes('saved-001'); step++) {
        createView.mockClear()
        const before = fixture.frame().slice(0, -5).map(line => line.split('│')[0] ?? '')
        fixture.tui.scrollBy(-1)
        const after = fixture.frame().slice(0, -5).map(line => line.split('│')[0] ?? '')
        if (createView.mock.calls.length > 0) {
          expect(createView.mock.calls.length).toBeLessThanOrEqual(2 * Math.max(20, fixture.terminal.rows))
          const anchor = before.find(line => line.includes('saved-'))
          if (anchor !== undefined) expect(after).toContain(anchor)
        }
        previous = after
      }
      expect(fixture.text()).toContain('saved-001')
      expect(previous).toBeDefined()
      expect(fixture.frame()).toMatchSnapshot('oldest lazy page')
      for (let step = 0; step < 100 && !fixture.tui.isFollowingOutput; step++) {
        fixture.input('\x1b[6~')
        fixture.frame()
      }
      expect(fixture.text()).toContain('saved-200')
      expect(fixture.tui.isFollowingOutput).toBe(true)
      expect(fixture.session.snapshotEvents()).toEqual(original)
    } finally { createView.mockRestore(); await fixture.dispose() }
  })

  it('keeps the old page still when a reply arrives and Ctrl+End returns to the live tail', async () => {
    const fixture = await historyFixture(1)
    try {
      fixture.text()
      fixture.input('\x1b[1;5H')
      const before = fixture.frame().filter(line => line.trimStart().startsWith('› saved-'))
      expect(before.join('\n')).toContain('saved-001')
      fixture.screen.handleEvent(fixture.session.append('assistant/message', { turn: 1, step: 1, stream: [],
        message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock' },
          content: [{ type: 'text', text: 'LIVE_LATEST_REPLY' }] }) }, { surfaceOp: 'append' }))
      expect(fixture.frame().filter(line => line.trimStart().startsWith('› saved-'))).toEqual(before)
      expect(fixture.tui.isFollowingOutput).toBe(false)
      expect(fixture.text()).not.toContain('LIVE_LATEST_REPLY')
      fixture.input('\x1b[1;5F')
      expect(fixture.text()).toContain('LIVE_LATEST_REPLY')
      expect(fixture.tui.isFollowingOutput).toBe(true)
    } finally { await fixture.dispose() }
  })

  it('finds unloaded messages without expanding the complete transcript', async () => {
    const fixture = await historyFixture()
    const createView = vi.spyOn(views, 'createView')
    try {
      fixture.text()
      fixture.input('\x06')
      expect(fixture.tui.hasOverlay()).toBe(true)
      fixture.input('saved-001')
      fixture.input('\x1b')
      expect(fixture.text()).toContain('saved-001')
      expect(createView.mock.calls.length).toBeLessThan(60)
      fixture.size.columns = 80
      fixture.size.rows = 10
      expect(fixture.text()).toContain('saved-001')
      fixture.input('\x1b[1;5F')
      expect(fixture.text()).toContain('saved-200')
    } finally { createView.mockRestore(); await fixture.dispose() }
  })

  it('keeps mouse paging stable during streamed replies and resumes the live stream at the tail', async () => {
    const fixture = await historyFixture()
    try {
      fixture.text()
      for (let step = 0; step < 12; step++) {
        fixture.input('\x1b[<64;2;2M')
        fixture.frame()
      }
      const before = fixture.frame().map(line => line.split('│')[0] ?? '').filter(line => line.includes('saved-'))
      expect(before.length).toBeGreaterThan(0)
      expect(before.join('\n')).not.toContain('saved-200')
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const emit = (text: string) => { fixture.ctx.events.emit('agent/assistant-stream', {
        agent: fixture.agent,
        frame: { type: 'chunk', attemptId: LlmAttemptId('lazy-stream'), revision: 1, index: 0, time: 0,
          chunk: { type: 'text-delta', index: 0, text } },
      }) }
      emit('STREAMED_REPLY')
      vi.advanceTimersByTime(16)
      expect(fixture.frame().map(line => line.split('│')[0] ?? '').filter(line => line.includes('saved-'))).toEqual(before)
      expect(fixture.tui.isFollowingOutput).toBe(false)
      fixture.input('\x1b[1;5F')
      expect(fixture.text()).toContain('STREAMED_REPLY')
      emit('_CONTINUED')
      vi.advanceTimersByTime(16)
      expect(fixture.text()).toContain('STREAMED_REPLY_CONTINUED')
      expect(fixture.tui.isFollowingOutput).toBe(true)
    } finally { await fixture.dispose(); vi.useRealTimers() }
  })
})
