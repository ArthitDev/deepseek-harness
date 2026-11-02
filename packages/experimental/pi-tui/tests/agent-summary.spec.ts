import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createDeveloperMessage, createMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent, type SessionEventMap } from '@deepseek-ai/dsh-session'
import { createAgentSummary, foldAgentSummary, formatAgentSummary, rebuildAgentSummary } from '../src/core/agent-summary.ts'

let seq = 0
function event<K extends keyof SessionEventMap>(type: K, data: SessionEventMap[K], time = 1000): SessionEvent<K> {
  return { type, data, seq: SessionSeq(seq++), time } as SessionEvent<K>
}

describe('Agent Debug summaries', () => {
  it('counts parallel native and PTC calls, measured usage, todos, and turn duration', () => {
    const summary = createAgentSummary()
    foldAgentSummary(summary, event('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect the service' }] })))
    foldAgentSummary(summary, event('turn/start', { turn: 1 }, 1000))
    foldAgentSummary(summary, event('tool/call', { turn: 1, step: 1, callId: ToolCallId('native'), name: 'read_file', arguments: '{}' }))
    foldAgentSummary(summary, event('tool/ptc-dispatch-start', {
      rootCallId: ToolCallId('root'), parentCallId: ToolCallId('root'), subCallId: 'root:ptc:0', name: 'grep', arguments: {},
    } as never))
    foldAgentSummary(summary, event('tool/result', {
      turn: 1, step: 1, message: createMessage({ role: 'tool', source: { kind: 'tool', callId: ToolCallId('native') },
        toolCallId: ToolCallId('native'), content: [{ type: 'text', text: 'cancelled' }], isError: true }),
      error: { name: 'AbortError', code: 'ABORTED' },
    }))
    foldAgentSummary(summary, event('tool/ptc-dispatch', {
      rootCallId: ToolCallId('root'), parentCallId: ToolCallId('root'), subCallId: 'root:ptc:0', name: 'grep', arguments: {},
      isError: true, error: { name: 'ToolError', code: 'FAILED' },
    } as never))
    foldAgentSummary(summary, event('assistant/message', {
      turn: 1, step: 1, message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [] }), stream: [],
      usage: { inputTokens: 11, outputTokens: 7 },
    }))
    foldAgentSummary(summary, event('todo/write', { todos: [
      { content: 'Check listener cleanup', status: 'pending' }, { content: 'Read service', status: 'completed' },
    ] } as never))
    foldAgentSummary(summary, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3500))

    expect(summary.calls).toEqual({ pending: new Map(), completed: 0, failed: 1, cancelled: 1, stopped: 0 })
    const text = formatAgentSummary(summary, 4000)
    expect(text).toContain('task: Inspect the service')
    expect(text).toContain('last tool: grep')
    expect(text).toContain('calls: 0 pending, 0 completed, 1 failed, 1 cancelled, 0 stopped')
    expect(text).toContain('elapsed: 2.5s')
    expect(text).toContain('usage: 11 in / 7 out tokens')
    expect(text).toContain('todos: 1/2 completed, 1 remaining (Check listener cleanup)')

    foldAgentSummary(summary, event('turn/start', { turn: 2 }, 5000))
    expect(formatAgentSummary(summary, 6000)).toContain('calls: none')
    expect(formatAgentSummary(summary, 6000)).toContain('usage: unknown')
    expect(formatAgentSummary(summary, 6000)).toContain('task: Inspect the service')
  })

  it('summarizes matched request, first-token, and root tool timings across retry and replay', () => {
    const events: SessionEvent[] = [
      event('turn/start', { turn: 3 }, 1000),
      event('step/start', { turn: 3, step: 1 }, 1200),
      event('assistant/attempt', { turn: 3, step: 1, stream: [] }, 1250),
      event('assistant/attempt', { turn: 3, step: 1, stream: [{ type: 'chunk', time: 1400,
        chunk: { type: 'text-delta', index: 0, text: 'a' } }] }, 1450),
      event('assistant/attempt', { turn: 3, step: 1, stream: [{ type: 'chunk', time: 1500,
        chunk: { type: 'text-delta', index: 0, text: 'b' } }] }, 1500),
      event('assistant/message', { turn: 3, step: 1,
        message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [] }), stream: [
          { type: 'chunk', time: 1700, chunk: { type: 'text-delta', index: 0, text: 'c' } },
        ], usage: { inputTokens: 2, outputTokens: 1 } }, 2200),
      event('tool/call', { turn: 3, step: 1, callId: ToolCallId('first'), name: 'read_file', arguments: '{}' }, 2300),
      event('tool/call', { turn: 3, step: 1, callId: ToolCallId('second'), name: 'write_file', arguments: '{}' }, 2400),
      event('tool/result', { turn: 3, step: 1, message: createMessage({ role: 'tool',
        source: { kind: 'tool', callId: ToolCallId('first') }, toolCallId: ToolCallId('first'), content: [] }) }, 2800),
      event('tool/result', { turn: 3, step: 1, message: createMessage({ role: 'tool',
        source: { kind: 'tool', callId: ToolCallId('second') }, toolCallId: ToolCallId('second'), content: [] }) }, 2900),
      event('step/end', { turn: 3, step: 1 }, 3000),
      event('step/start', { turn: 3, step: 2 }, 3100),
      event('assistant/message', { turn: 3, step: 2,
        message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [] }), stream: [
          { type: 'chunk', time: 3500, chunk: { type: 'text-delta', index: 0, text: 'd' } },
        ] }, 3700),
      event('step/end', { turn: 3, step: 2 }, 3800),
      event('turn/end', { turn: 3, reason: { kind: 'completed' } }, 3900),
    ]
    const summary = events.reduce((current, item) => {
      foldAgentSummary(current, item)
      return current
    }, createAgentSummary())

    expect(summary.preStepMs).toBe(200)
    expect(summary.requestSumMs).toBe(1600)
    expect(summary.requestSamples).toBe(2)
    expect(summary.ttftSumMs).toBe(600)
    expect(summary.ttftSamples).toBe(2)
    expect(summary.toolSumMs).toBe(1000)
    expect(summary.toolSamples).toBe(2)
    expect(formatAgentSummary(summary)).toContain('request sum: 1600ms (2)')
    expect(formatAgentSummary(summary)).toContain('TTFT avg: 300ms (2)')
    expect(formatAgentSummary(summary)).toContain('tool sum: 1000ms (2)')
    expect(formatAgentSummary(rebuildAgentSummary(events))).toBe(formatAgentSummary(summary))
  })

  it('sums overlapping root tool calls only and ignores unmatched or duplicate results', () => {
    const summary = createAgentSummary()
    const rawPluginEvent = (type: string, data: Record<string, unknown>, time: number): SessionEvent =>
      ({ type, data, seq: SessionSeq(seq++), time }) as SessionEvent
    foldAgentSummary(summary, event('turn/start', { turn: 1 }, 0))
    foldAgentSummary(summary, event('step/start', { turn: 1, step: 1 }, 0))
    foldAgentSummary(summary, event('assistant/message', { turn: 1, step: 1,
      message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [] }), stream: [] }, 5))
    foldAgentSummary(summary, event('tool/call', { turn: 1, step: 1, callId: ToolCallId('a'), name: 'a', arguments: '{}' }, 10))
    foldAgentSummary(summary, event('tool/call', { turn: 1, step: 1, callId: ToolCallId('b'), name: 'b', arguments: '{}' }, 20))
    foldAgentSummary(summary, event('tool/call', { turn: 1, step: 1, callId: ToolCallId('root'), name: 'ptc', arguments: '{}' }, 30))
    foldAgentSummary(summary, rawPluginEvent('tool/ptc-dispatch-start', {
      rootCallId: ToolCallId('root'), parentCallId: ToolCallId('root'), subCallId: 'root:ptc:0', name: 'sub', arguments: {},
    }, 40))
    foldAgentSummary(summary, rawPluginEvent('tool/ptc-dispatch', {
      rootCallId: ToolCallId('root'), parentCallId: ToolCallId('root'), subCallId: 'root:ptc:0', name: 'sub', arguments: {},
      isError: false,
    }, 80))
    const result = (callId: string, time: number) => event('tool/result', { turn: 1, step: 1,
      message: createMessage({ role: 'tool', source: { kind: 'tool', callId: ToolCallId(callId) },
        toolCallId: ToolCallId(callId), content: [] }) }, time)
    foldAgentSummary(summary, result('root', 90))
    foldAgentSummary(summary, result('a', 90))
    foldAgentSummary(summary, result('b', 100))
    foldAgentSummary(summary, result('a', 101))
    foldAgentSummary(summary, result('unmatched', 102))
    foldAgentSummary(summary, event('step/end', { turn: 1, step: 1 }, 105))
    foldAgentSummary(summary, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 110))

    expect(summary.preStepMs).toBe(0)
    expect(summary.toolSumMs).toBe(220)
    expect(summary.toolSamples).toBe(3)
    expect(formatAgentSummary(summary)).toContain('tool sum: 220ms (3)')
    expect(summary.toolSumMs).toBeGreaterThan(summary.endedAt! - summary.startedAt!)
  })

  it('keeps missing and aborted timing samples unknown and resets timing on the next turn', () => {
    expect(formatAgentSummary(createAgentSummary('task only'))).not.toContain('pre-step')
    const summary = createAgentSummary()
    foldAgentSummary(summary, event('turn/start', { turn: 1 }, 1000))
    foldAgentSummary(summary, event('step/start', { turn: 1, step: 1 }, 1000))
    foldAgentSummary(summary, event('tool/call', { turn: 1, step: 1, callId: ToolCallId('pending'), name: 'read', arguments: '{}' }, 1150))
    foldAgentSummary(summary, event('step/end', { turn: 1, step: 1 }, 1200))
    foldAgentSummary(summary, event('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } }, 1300))
    expect(formatAgentSummary(summary)).toContain('pre-step: 0ms')
    expect(formatAgentSummary(summary)).toContain('request sum: unknown')
    expect(formatAgentSummary(summary)).toContain('TTFT avg: unknown')
    expect(formatAgentSummary(summary)).toContain('tool sum: unknown')
    expect(formatAgentSummary(summary)).toContain('1 cancelled')

    foldAgentSummary(summary, event('assistant/message', { turn: 1, step: 1,
      message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [] }), stream: [
        { type: 'chunk', time: 1320, chunk: { type: 'text-delta', index: 0, text: 'late' } },
      ] }, 1350))
    expect(summary.requestSamples).toBe(0)

    foldAgentSummary(summary, event('turn/start', { turn: 2 }, 2000))
    expect(formatAgentSummary(summary)).toContain('pre-step: unknown')
    expect(formatAgentSummary(summary)).toContain('request sum: unknown')
    expect(formatAgentSummary(summary)).toContain('tool sum: unknown')
  })

  it('rebuilds current facts from events that survive a rewind marker', () => {
    const first = event('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Old task' }] }))
    const oldCall = event('tool/call', { turn: 1, step: 1, callId: ToolCallId('old'), name: 'old_tool', arguments: '{}' })
    const marker = {
      ...event('developer/message', { turn: 1, step: 1,
        message: createDeveloperMessage({ source: { kind: 'session-edit' }, content: [{ type: 'text', text: 'the operator rewound' }] }) }),
      surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: oldCall.seq },
    } as SessionEvent
    const current = event('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Current task' }] }))
    const text = formatAgentSummary(rebuildAgentSummary([first, oldCall, marker, current]))
    expect(text).toContain('task: Current task')
    expect(text).not.toContain('Old task')
    expect(text).not.toContain('old_tool')
    expect(text).toContain('calls: none')
  })

  it('removes terminal escapes from task and tool labels before formatting', () => {
    const summary = createAgentSummary()
    foldAgentSummary(summary, event('user/message', createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'text', text: '\u001b[31mInspect the service\u001b[0m' },
    ] })))
    foldAgentSummary(summary, event('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('ansi'), name: '\u001b[32mread_file\u001b[0m', arguments: '{}',
    }))
    const text = formatAgentSummary(summary)
    expect(text).toContain('task: Inspect the service')
    expect(text).toContain('last tool: read_file')
    expect(text).not.toContain('\u001b')
    expect(text).not.toContain('[31m')
  })
})
