import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { createMessage, createUserMessage, LlmAttemptId, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import { ChatScreen } from '../src/ui/chat.ts'
import { fixtureAgent } from './fixture-agent.ts'
import * as chatModel from '../src/core/model.ts'

async function fixture() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const snapshot = vi.fn(() => ({ values: {} }))
  ctx.provide('sessionProjections', { snapshot })
  const makeAgent = (id: string) => fixtureAgent(ctx, ctx.sessions.create(SessionId(id)))
  const agent = makeAgent('stream-render')
  const start = vi.fn<Terminal['start']>()
  const terminal: Terminal = {
    columns: 100, rows: 80, kittyProtocolActive: false,
    start, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
    moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
    clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
  }
  const tui = new TuiAltScreen(terminal)
  const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
  tui.start()
  const text = (): string => {
    tui.renderNow()
    return stripVTControlCharacters(tui.getScreenLines().join('\n'))
  }
  const emit = (chunk: StreamChunk): void => {
    const frame: AssistantStreamFrame = {
      type: 'chunk', attemptId: LlmAttemptId('stream-test'), revision: 1, index: 0, time: 0, chunk,
    }
    ctx.events.emit('agent/assistant-stream', { agent, frame })
  }
  text()
  snapshot.mockClear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  return { ctx, agent, screen, tui, start, snapshot, makeAgent, text, emit }
}

describe('stream rendering', () => {
  it('restores Targets on replay, shares Debug visibility, and resets on session switch and clear', async () => {
    const f = await fixture()
    try {
      f.screen.handleEvent(f.agent.session.append('user/message', createUserMessage({
        source: { kind: 'user' }, content: [{ type: 'text', text: 'https://example.test/' }],
      }), { surfaceOp: 'append' }))
      const callId = ToolCallId('target-fetch')
      f.screen.handleEvent(f.agent.session.append('tool/call', {
        turn: 1, step: 1, callId, name: 'fetch', arguments: '{"url":"https://example.test/api"}',
      }))
      f.screen.handleEvent(f.agent.session.append('tool/result', {
        turn: 1, step: 1, message: createMessage({ role: 'tool', toolCallId: callId,
          source: { kind: 'tool', callId }, content: [{ type: 'text', text: 'https://docs.test/' }],
        }),
      }, { surfaceOp: 'append' }))
      const events = f.agent.session.snapshotEvents()
      const targets = (): string => {
        f.text()
        return f.tui.getScreenLines().map(line => stripVTControlCharacters(line).slice(54).trimEnd()).join('\n').trimEnd()
      }
      expect(targets()).toContain('Sub Target · 1')
      expect(targets()).toContain('Other · 1')
      expect(targets()).toMatchSnapshot('targets restored from session events without a shell')
      expect(f.text()).not.toContain('Shell ·')
      const input = f.start.mock.calls[0]?.[0]
      input?.('\x1b[100;7u')
      input?.('\t')
      expect(targets()).toContain('Tab Debug')
      input?.('\x1b')
      expect(targets()).not.toContain('Tab Debug')
      f.screen.submit('/agent-debug')
      expect(targets()).not.toContain('Targets')
      f.screen.submit('/agent-debug')
      expect(targets()).toContain('https://example.test/')
      await f.screen.replayTranscript(f.agent)
      expect(targets()).toContain('Other · 1')
      expect(f.agent.session.snapshotEvents()).toEqual(events)
      await f.screen.switchAgent(f.makeAgent('empty-targets'))
      expect(targets()).not.toContain('Targets')
      await f.screen.switchAgent(f.agent)
      expect(targets()).toContain('https://example.test/')
      f.screen.submit('/clear')
      expect(targets()).not.toContain('Targets')
      await f.screen.switchAgent(f.makeAgent('after-clear'))
      await f.screen.switchAgent(f.agent)
      expect(targets()).not.toContain('Targets')
    } finally {
      f.tui.stop()
      await f.ctx.fiber.dispose()
      vi.useRealTimers()
    }
  })

  it('refreshes Jev cost after tool results and resets it on session switches', async () => {
    const f = await fixture()
    try {
      for (const [id, cost, total] of [['first', 0.001, '0.001'], ['second', 0.002, '0.003']] as const) {
        const callId = ToolCallId(id)
        f.screen.handleEvent(f.agent.session.append('tool/call', {
          turn: 1, step: 1, callId, name: 'mcp__jev__jev_verify', arguments: '{}',
        }))
        f.screen.handleEvent(f.agent.session.append('tool/result', {
          turn: 1, step: 1, message: createMessage({ role: 'tool',
            source: { kind: 'tool', callId }, toolCallId: callId,
            content: [{ type: 'text', text: JSON.stringify({ usage: { cost } }) }],
          }),
        }, { surfaceOp: 'append' }))
        f.emit({ type: 'text-delta', index: 0, text: 'answer' })
        vi.advanceTimersByTime(16)
        expect(f.text()).toContain(`cost ${total}`)
      }
      await f.screen.switchAgent(f.makeAgent('no-jev-cost'))
      expect(f.text()).not.toContain('cost 0.003')
    } finally {
      f.tui.stop()
      await f.ctx.fiber.dispose()
      vi.useRealTimers()
    }
  })

  it('updates streamed text without traversing folded history', async () => {
    const createModel = vi.spyOn(chatModel, 'createModel')
    const f = await fixture()
    const created = createModel.mock.results[0]
    createModel.mockRestore()
    try {
      if (created?.type !== 'return') throw new Error('ChatScreen did not create its transcript model')
      const model = created.value
      for (let index = 0; index < 2000; index++) {
        f.agent.session.append('user/message', createUserMessage({
          source: { kind: 'user' }, content: [{ type: 'text', text: `saved-${index}` }],
        }), { surfaceOp: 'append' })
      }
      await f.screen.replayTranscript(f.agent)
      const iterate = vi.spyOn(model.items, Symbol.iterator)
      try {
        f.emit({ type: 'text-delta', index: 0, text: 'current answer' })
        vi.advanceTimersByTime(16)
        expect(f.text()).toContain('current answer')
        expect(f.text()).not.toContain('saved-0')
        expect(iterate).not.toHaveBeenCalled()
        expect(model.items.filter(item => item.kind === 'user')).toHaveLength(2000)
      } finally { iterate.mockRestore() }
    } finally {
      f.tui.stop()
      await f.ctx.fiber.dispose()
      vi.useRealTimers()
    }
  })

  it('renders partial Markdown on the frame cadence and replaces it with the committed answer once', async () => {
    const f = await fixture()
    try {
      f.screen.handleEvent(f.agent.session.append('session/title', {
        title: 'เริ่มต้นสนทนา', messageSeqs: [], source: { kind: 'user' },
      }))
      expect(f.text()).not.toContain('เริ่มต้นสนทนา')
      expect(f.text()).not.toContain('❝')
      f.emit({ type: 'reasoning-delta', index: 0, text: '**ตรวจสอบ** ก่อน' })
      f.emit({ type: 'text-delta', index: 1, text: '**ผล' })
      vi.advanceTimersByTime(16)
      expect(f.text()).toContain('▾ Thinking')
      expect(f.text()).toContain('   ตรวจสอบ ก่อน')
      expect(f.text()).not.toContain('**ตรวจสอบ**')
      f.emit({ type: 'text-delta', index: 1, text: 'ชั่วคราว**\n\n- กำลังทำ' })
      vi.advanceTimersByTime(16)
      expect(f.text()).toContain('ผลชั่วคราว')
      expect(f.text()).not.toContain('**ผลชั่วคราว**')
      f.emit({ type: 'text-delta', index: 1, text: '\n- ข้อความค้าง' })
      f.screen.handleEvent(f.agent.session.append('assistant/message', {
        turn: 1, step: 1, stream: [],
        message: createMessage({ role: 'assistant', content: [{ type: 'text', text: '**ผลจริง**\n\n- เสร็จแล้ว' }], source: { kind: 'model', provider: 'mock', model: 'mock' } }),
      }, { surfaceOp: 'append' }))
      const final = f.text()
      expect(final).toContain('▸ Thinking')
      expect(final.match(/ผลจริง/g)).toHaveLength(1)
      expect(final).not.toContain('**ผลจริง**')
      expect(final).not.toContain('ผลชั่วคราว')
      expect(final).not.toContain('ข้อความค้าง')
      expect(final.split('\n').map(line => line.trimEnd()).filter(line =>
        line.includes('Thinking') || line.includes('ผลจริง') || line.includes('เสร็จแล้ว'),
      )).toMatchInlineSnapshot(`
        [
          " ▸ Thinking · 16 chars · Ctrl+T                     │",
          " ผลจริง                                              │",
          " - เสร็จแล้ว                                          │",
        ]
      `)
      f.snapshot.mockClear()
      vi.advanceTimersByTime(32)
      expect(f.snapshot).not.toHaveBeenCalled()
      expect(f.text()).toBe(final)
    } finally {
      f.tui.stop()
      await f.ctx.fiber.dispose()
      vi.useRealTimers()
    }
  })

  it('keeps Thinking separate from the answer and lets Ctrl+T fold reasoning during streaming', async () => {
    const f = await fixture()
    try {
      const input = f.start.mock.calls[0]?.[0]
      expect(input).toBeDefined()
      f.emit({ type: 'reasoning-delta', index: 0, text: 'live thought' })
      vi.advanceTimersByTime(16)
      expect(f.text()).toContain('▾ Thinking')
      expect(f.text()).toContain('   live thought')
      input?.('\x14')
      expect(f.text()).toContain('▸ Thinking')
      expect(f.text()).not.toContain('live thought')
      f.emit({ type: 'reasoning-delta', index: 0, text: ' still arriving' })
      f.emit({ type: 'text-delta', index: 1, text: 'final answer starts' })
      vi.advanceTimersByTime(16)
      expect(f.text()).not.toContain('still arriving')
      expect(f.text()).toContain('final answer starts')
      input?.('\x14')
      expect(f.text()).toContain('▾ Thinking')
      expect(f.text()).toContain('live thought still arriving')
      f.screen.handleEvent(f.agent.session.append('assistant/message', {
        turn: 1, step: 1, stream: [],
        message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'final answer' }], source: { kind: 'model', provider: 'mock', model: 'mock' } }),
      }, { surfaceOp: 'append' }))
      expect(f.text()).toContain('live thought still arriving')
      input?.('\x14')
      expect(f.text()).toContain('▸ Thinking')
      expect(f.text()).not.toContain('live thought')
      expect(f.text()).toContain('final answer')
    } finally {
      f.tui.stop()
      await f.ctx.fiber.dispose()
      vi.useRealTimers()
    }
  })

  it('folds and expands a live Thinking header through terminal mouse press and release', async () => {
    const f = await fixture()
    try {
      const input = f.start.mock.calls[0]?.[0]
      expect(input).toBeDefined()
      f.emit({ type: 'reasoning-delta', index: 0, text: 'mouse-controlled thought' })
      vi.advanceTimersByTime(16)
      f.text()
      const row = f.tui.getScreenLines().findIndex(line => stripVTControlCharacters(line).includes('▾ Thinking'))
      expect(row).toBeGreaterThanOrEqual(0)
      const press = `\x1b[<0;2;${row + 1}M`
      const release = `\x1b[<0;2;${row + 1}m`
      input?.(press)
      input?.(release)
      expect(f.text()).toContain('▸ Thinking')
      expect(f.text()).not.toContain('mouse-controlled thought')
      f.emit({ type: 'reasoning-delta', index: 0, text: ' with new text' })
      vi.advanceTimersByTime(16)
      expect(f.text()).not.toContain('with new text')
      input?.(press)
      input?.(release)
      expect(f.text()).toContain('▾ Thinking')
      expect(f.text()).toContain('mouse-controlled thought with new text')
    } finally {
      f.tui.stop()
      await f.ctx.fiber.dispose()
      vi.useRealTimers()
    }
  })

  it('animates the chat scanner and elapsed time while waiting, then stops on completion, cancellation, and disposal', async () => {
    const f = await fixture()
    try {
      f.screen.handleEvent(f.agent.session.append('turn/start', { turn: 1 }))
      const first = f.text()
      expect(first).toContain('⟦█▓░·····⟧ Working… 0s')
      expect(first).toContain('🤖 deepseek-v4-flash')
      expect(vi.getTimerCount()).toBe(1)
      f.snapshot.mockClear()
      vi.advanceTimersByTime(80)
      expect(f.text()).toContain('⟦▓█▓░····⟧ Working… 0s')
      vi.advanceTimersByTime(1040)
      expect(f.text()).toContain('⟦█▓░·····⟧ Working… 1s')
      expect(f.snapshot).not.toHaveBeenCalled()
      f.emit({ type: 'text-delta', index: 0, text: 'answer starts' })
      vi.advanceTimersByTime(16)
      expect(f.text()).toContain('answer starts')
      expect(f.text()).toContain('Working… 1s')
      expect(vi.getTimerCount()).toBe(1)
      f.screen.handleEvent(f.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
      expect(f.text()).not.toContain('Working…')
      expect(vi.getTimerCount()).toBe(0)
      f.screen.handleEvent(f.agent.session.append('turn/start', { turn: 2 }))
      expect(f.text()).toContain('⟦█▓░·····⟧ Working… 0s')
      f.screen.handleEvent(f.agent.session.append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } }))
      expect(f.text()).not.toContain('Working…')
      expect(vi.getTimerCount()).toBe(0)
      f.screen.handleEvent(f.agent.session.append('turn/start', { turn: 3 }))
      expect(f.text()).toContain('Working… 0s')
      expect(vi.getTimerCount()).toBe(1)
      f.tui.stop()
      await f.ctx.fiber.dispose()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      f.tui.stop()
      await f.ctx.fiber.dispose()
      vi.useRealTimers()
    }
  })

  it('coalesces bursts into one UI update without dropping or delaying a continuous stream indefinitely', async () => {
    const f = await fixture()
    try {
      for (let index = 0; index < 100; index++) f.emit({ type: 'text-delta', index: 0, text: 'ก' })
      vi.advanceTimersByTime(16)
      expect(f.snapshot).toHaveBeenCalledTimes(1)
      expect(f.text().match(/ก/g)).toHaveLength(100)
      f.snapshot.mockClear()
      for (let index = 0; index < 16; index++) {
        f.emit({ type: 'reasoning-delta', index: 1, text: 'ข' })
        vi.advanceTimersByTime(1)
      }
      expect(f.snapshot).toHaveBeenCalledTimes(1)
      expect(f.text()).toContain('ข'.repeat(16))
      f.snapshot.mockClear()
      f.emit({ type: 'block-start', index: 2, blockType: 'tool-call' })
      f.emit({ type: 'text-delta', index: 0, text: '' })
      vi.advanceTimersByTime(32)
      expect(f.snapshot).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      f.tui.stop()
      await f.ctx.fiber.dispose()
    }
  })

  it('flushes the last delta at stream end without waiting for the next timer', async () => {
    const f = await fixture()
    try {
      f.emit({ type: 'text-delta', index: 0, text: 'last delta' })
      const frame: AssistantStreamFrame = {
        type: 'end', attemptId: LlmAttemptId('stream-test'), revision: 1, index: 1,
        outcome: { kind: 'abandoned' },
      }
      f.ctx.events.emit('agent/assistant-stream', { agent: f.agent, frame })
      expect(f.text()).toContain('last delta')
      expect(f.snapshot).toHaveBeenCalledTimes(1)
      f.snapshot.mockClear()
      vi.advanceTimersByTime(32)
      expect(f.snapshot).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      f.tui.stop()
      await f.ctx.fiber.dispose()
    }
  })

  it('seals the final answer immediately and cancels pending work on switches and disposal', async () => {
    const f = await fixture()
    try {
      f.emit({ type: 'text-delta', index: 0, text: 'partial answer' })
      const answer = f.agent.session.append('assistant/message', {
        turn: 1, step: 1, stream: [],
        message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'final answer' }], source: { kind: 'model', provider: 'mock', model: 'mock' } }),
      }, { surfaceOp: 'append' })
      f.screen.handleEvent(answer)
      expect(f.text()).toContain('final answer')
      expect(f.text()).not.toContain('partial answer')
      f.snapshot.mockClear()
      vi.advanceTimersByTime(32)
      expect(f.snapshot).not.toHaveBeenCalled()
      f.emit({ type: 'text-delta', index: 0, text: 'old session tail' })
      void f.screen.switchAgent(f.makeAgent('next-stream-session'))
      f.snapshot.mockClear()
      vi.advanceTimersByTime(32)
      expect(f.snapshot).not.toHaveBeenCalled()
      expect(f.text()).not.toContain('old session tail')
      f.emit({ type: 'text-delta', index: 0, text: 'disposed tail' })
      await f.ctx.fiber.dispose()
      f.snapshot.mockClear()
      vi.advanceTimersByTime(32)
      f.emit({ type: 'text-delta', index: 0, text: 'after disposal' })
      vi.advanceTimersByTime(32)
      expect(f.snapshot).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      f.tui.stop()
      await f.ctx.fiber.dispose()
    }
  })
})
