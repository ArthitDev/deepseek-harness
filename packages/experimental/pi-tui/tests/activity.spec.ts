import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createAssistantMessage, createDeveloperMessage, createMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent, type SessionEventMap } from '@deepseek-ai/dsh-session'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type { ActivityEntry } from '../src/core/activity.ts'
import { applyEvent, createModel } from '../src/core/model.ts'

let seq = 0
function event<K extends keyof SessionEventMap>(type: K, data: SessionEventMap[K], time = 1000): SessionEvent<K> {
  // Fabricated events are plain appends; surfaceOp is only read for `replace`.
  return { type, data, seq: SessionSeq(seq++), time } as SessionEvent<K>
}
const call = (name = 'pwsh', id = 'call') => event('tool/call', {
  turn: 1, step: 1, name, callId: ToolCallId(id), arguments: '{"command":"Get-Date"}',
})
const result = (id = 'call', isError = false, meta?: SessionEventMap['tool/result']['meta'], errorCode?: string) => event('tool/result', {
  turn: 1, step: 1,
  message: createMessage({ role: 'tool', source: { kind: 'tool', callId: ToolCallId(id) },
    toolCallId: ToolCallId(id), content: [{ type: 'text', text: isError ? 'Error: command failed' : 'exit code: 0\nfinished' }], isError }),
  ...(errorCode === undefined ? {} : { error: { name: 'AbortError', code: errorCode } }),
  ...(meta === undefined ? {} : { meta }),
}, 2500)

describe('Agent Debug event projection', () => {
  it('replays queued and preparing calls without inventing live execution or progress', () => {
    const model = createModel()
    const requested = event('assistant/message', {
      turn: 1, step: 1,
      message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [
        { type: 'tool-call', id: ToolCallId('queued'), name: 'mcp__docs__search', arguments: '{"query":"x"}' },
      ] }),
      stream: [],
    })
    applyEvent(model, requested)
    expect(model.activity[0]).toMatchObject({ key: 'tool:queued', category: 'MCP', status: 'queued' })
    applyEvent(model, call('mcp__docs__search', 'queued'))
    expect(model.activity[0]).toMatchObject({ status: 'preparing' })
    expect(model.activity[0]?.progress).toBeUndefined()
    const replayed = createModel()
    applyEvent(replayed, requested)
    applyEvent(replayed, call('mcp__docs__search', 'queued'))
    const projection = (entries: typeof model.activity) => entries.map(({ seq: _seq, time: _time, ...entry }) => entry)
    expect(projection(replayed.activity)).toEqual(projection(model.activity))
  })

  it('folds the keyless tool-call-turn recording into the same queued, preparing, and settled activity', async () => {
    const source = await readFile(new URL('../../../../snapshots/session/tool-call-turn/session.v4.jsonl', import.meta.url), 'utf8')
    const events = source.trimEnd().split('\n').slice(1).map(line => JSON.parse(line) as SessionEvent)
    const fold = () => {
      const model = createModel()
      const states: ActivityEntry['status'][] = []
      let key: string | undefined
      for (const entry of events) {
        applyEvent(model, entry)
        if (entry.type === 'assistant/message') {
          const requested = entry.data.message.content.find(block => block.type === 'tool-call')
          if (requested?.type === 'tool-call') {
            key = `tool:${requested.id}`
            const row = model.activity.find(activity => activity.key === key)
            if (row !== undefined) states.push(row.status)
          }
        } else if ((entry.type === 'tool/call' || entry.type === 'tool/result') && key !== undefined) {
          const row = model.activity.find(activity => activity.key === key)
          if (row !== undefined) states.push(row.status)
        }
      }
      return { activity: model.activity, states }
    }
    const first = fold()
    const replay = fold()
    expect(first.states).toEqual(['queued', 'preparing', 'ok'])
    expect(first.activity[0]?.progress).toBeUndefined()
    expect(replay.activity).toEqual(first.activity)
  })

  it.each(['ABORTED', 'ABORTED_BEFORE_DISPATCH'] as const)('folds PTC %s as cancelled', (errorCode) => {
    const model = createModel()
    const ptc = (type: string, time: number, isError?: boolean): SessionEvent => ({
      type, seq: SessionSeq(seq++), time, data: {
        rootCallId: ToolCallId('root'), parentCallId: ToolCallId('root'), subCallId: 'root:ptc:0',
        name: 'mcp__docs__search', arguments: { query: 'x' }, ...(isError === undefined ? {} : { isError }),
        ...(isError ? { error: { name: 'AbortError', code: errorCode } } : {}),
      },
    } as SessionEvent)
    applyEvent(model, ptc('tool/ptc-dispatch-start', 1000))
    expect(model.activity[0]).toMatchObject({ key: 'ptc:root:ptc:0', status: 'preparing' })
    expect(model.activity[0]?.detail).toContain('"query":"x"')
    applyEvent(model, ptc('tool/ptc-dispatch', 2500, true))
    expect(model.activity[0]).toMatchObject({ status: 'cancelled', endedAt: 2500 })
  })

  it.each(['ABORTED', 'ABORTED_BEFORE_DISPATCH'] as const)('folds native %s as cancelled', (errorCode) => {
    const model = createModel()
    applyEvent(model, call())
    applyEvent(model, result('call', true, undefined, errorCode))
    expect(model.activity[0]).toMatchObject({ status: 'cancelled', endedAt: 2500 })
  })

  it.each([
    [{ kind: 'completed' }, 'ok'], [{ kind: 'blocked' }, 'stopped'],
    [{ kind: 'max-tokens' }, 'stopped'], [{ kind: 'interrupted' }, 'stopped'],
    [{ kind: 'forked' }, 'stopped'], [{ kind: 'error', error: { code: 'PROVIDER_DOWN', message: 'offline' } }, 'error'],
  ] as const)('settles the Agent row for %j', (reason, status) => {
    const model = createModel()
    applyEvent(model, event('turn/start', { turn: 1 }))
    applyEvent(model, event('turn/end', { turn: 1, reason }, 4000))
    expect(model.activity[0]).toMatchObject({ category: 'Agent', status, endedAt: 4000 })
  })

  it('pairs concurrent calls by id and uses durable times on replay', () => {
    const events = [call(), call('mcp__docs__search', 'mcp'), result('mcp'), result('call', true)]
    const live = createModel()
    for (const entry of events) applyEvent(live, entry)
    expect(live.activity.map(row => [row.category, row.status, row.time, row.endedAt])).toEqual([
      ['Shell', 'error', 1000, 2500], ['MCP', 'ok', 1000, 2500],
    ])
    expect(live.activity[0]?.tool?.resultFull).toBe('Error: command failed')
    const replayed = createModel()
    for (const entry of events) applyEvent(replayed, entry)
    expect(replayed.activity).toEqual(live.activity)
  })

  it('records confirmed file diffs after successful tool results only', () => {
    const model = createModel()
    applyEvent(model, call('write_file'))
    const meta = { diffs: [{ path: 'src/chat.ts', oldText: 'before', newText: 'after' }] }
    applyEvent(model, result('call', true, meta))
    expect(model.activity).toHaveLength(1)
    applyEvent(model, call('write_file', 'write'))
    applyEvent(model, result('write', false, meta))
    expect(model.activity.at(-1)).toMatchObject({ category: 'File', status: 'changed', label: 'src/chat.ts' })
    expect(model.activity.at(-1)?.detail).toContain('Before:\nbefore\n\nAfter:\nafter')
  })

  it.each(['allowed-once', 'rejected', 'cancelled', 'unavailable'] as const)('settles approval outcome %s without performing it', (outcome) => {
    const model = createModel()
    const id = ApprovalRequestId('approval')
    applyEvent(model, event('approval/asked', { id, toolName: 'pwsh', reason: 'Review this command.' }))
    expect(model.activity[0]).toMatchObject({ category: 'Approval', status: 'waiting' })
    applyEvent(model, event('approval/decided', { id, outcome }, 3000))
    expect(model.activity[0]?.status).toBe({ 'allowed-once': 'ok', rejected: 'rejected', cancelled: 'cancelled', unavailable: 'error' }[outcome])
    expect(model.activity[0]?.detail).toContain(outcome)
    expect(model.activity[0]?.endedAt).toBe(3000)
  })

  it('shows retry waits, attempted retries, superseded failures, and cancellation', () => {
    const model = createModel()
    const retryEvent = (type: string, retry: number, time: number): SessionEvent => ({
      type, time, seq: SessionSeq(seq++), data: {
        retryId: 'request', retry, provider: 'deepseek', maxRetries: 3, delayMs: 500,
        failure: { code: 'RATE_LIMIT', message: 'Try later' },
      },
    } as SessionEvent)
    applyEvent(model, event('turn/start', { turn: 1 }))
    applyEvent(model, retryEvent('llm/retry', 1, 2000))
    expect(model.activity.at(-1)?.status).toBe('waiting')
    applyEvent(model, retryEvent('llm/retry-started', 1, 2500))
    expect(model.activity.at(-1)?.status).toBe('retry')
    applyEvent(model, retryEvent('llm/retry', 2, 3000))
    expect(model.activity.at(-2)?.status).toBe('error')
    applyEvent(model, event('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }, 3200))
    expect(model.activity.at(-1)?.status).toBe('cancelled')
    expect(model.activity.some(row => row.endedAt === undefined)).toBe(false)
    expect(model.activity.at(-1)?.detail).toContain('RATE_LIMIT Try later')
  })

  it('keeps the newest 20 operations and ignores ordinary conversation text', () => {
    const model = createModel()
    for (let id = 0; id < 23; id++) applyEvent(model, call('read_file', String(id)))
    expect(model.activity).toHaveLength(20)
    expect(model.activity[0]?.key).toBe('tool:3')
    expect(model.activity.at(-1)?.key).toBe('tool:22')
    applyEvent(model, event('user/message', createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] })))
    expect(model.activity).toHaveLength(20)
  })

  it('prunes replaced activity on rewind and clears later log-only approvals', () => {
    const model = createModel()
    const kept = call('pwsh', 'kept')
    const removed = call('read_file', 'removed')
    applyEvent(model, kept)
    applyEvent(model, removed)
    const marker = event('developer/message', { turn: 1, step: 1,
      message: createDeveloperMessage({ source: { kind: 'session-edit' }, content: [{ type: 'text', text: 'the operator rewound' }] }) })
    applyEvent(model, { ...marker, surfaceOp: { op: 'replace', startSeq: removed.seq, endSeq: removed.seq } })
    expect(model.activity.map(row => row.key)).toEqual(['tool:kept'])
    applyEvent(model, event('approval/asked', { id: ApprovalRequestId('later'), toolName: 'pwsh' }))
    applyEvent(model, { ...event('developer/message', { turn: 1, step: 1,
      message: createDeveloperMessage({ source: { kind: 'session-edit' }, content: [{ type: 'text', text: 'the operator cleared' }] }) }),
    surfaceOp: { op: 'replace', startSeq: kept.seq, endSeq: kept.seq } })
    expect(model.activity).toEqual([])
    expect(createModel().activity).toEqual([])
  })
})
