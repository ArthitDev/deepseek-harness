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

    expect(summary.calls).toEqual({ pending: new Set(), completed: 0, failed: 1, cancelled: 1, stopped: 0 })
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
