import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { CompactionCheckpointSource } from '@deepseek-ai/dsh-compaction'
import {
  AssistantStreamAccumulator,
  MessageId,
  ReasoningEffortId,
  ToolCallId,
  type AssistantStreamRecord,
  type ContentBlock,
  type ModelMessageSource,
  type ToolResultMessage,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import {
  SessionSeq,
  type SessionEvent,
  type SessionEventMap,
} from '@deepseek-ai/dsh-session'
// Type-only import: merges `session/title` into SessionEventMap so the fixture
// below stays fully typed.
import type {} from '@deepseek-ai/dsh-session-title'
import {
  applyEvent,
  applyStreamChunk,
  createModel,
  pushNotice,
  textOf,
  type ChatItem,
} from '../src/core/model.ts'

let seqCounter = 0

const nextSeq = (): SessionSeq => {
  seqCounter += 1
  return SessionSeq(seqCounter)
}

const userMessageEvent = (data: UserMessage): SessionEvent<'user/message'> =>
  ({ type: 'user/message', seq: nextSeq(), time: 0, data, surfaceOp: 'append' })

const assistantMessageEvent = (data: SessionEventMap['assistant/message']): SessionEvent<'assistant/message'> =>
  ({ type: 'assistant/message', seq: nextSeq(), time: 0, data, surfaceOp: 'append' })

const toolResultEvent = (data: SessionEventMap['tool/result']): SessionEvent<'tool/result'> =>
  ({ type: 'tool/result', seq: nextSeq(), time: 0, data, surfaceOp: 'append' })

const attemptEvent = (data: SessionEventMap['assistant/attempt']): SessionEvent<'assistant/attempt'> =>
  ({ type: 'assistant/attempt', seq: nextSeq(), time: 0, data })

const toolCallEvent = (data: SessionEventMap['tool/call']): SessionEvent<'tool/call'> =>
  ({ type: 'tool/call', seq: nextSeq(), time: 0, data })

const requestHeaderEvent = (data: SessionEventMap['request/header']): SessionEvent<'request/header'> =>
  ({ type: 'request/header', seq: nextSeq(), time: 0, data })

const turnStartEvent = (): SessionEvent<'turn/start'> =>
  ({ type: 'turn/start', seq: nextSeq(), time: 0, data: { turn: 1 } })

const turnEndEvent = (data: SessionEventMap['turn/end']): SessionEvent<'turn/end'> =>
  ({ type: 'turn/end', seq: nextSeq(), time: 0, data })

const sessionTitleEvent = (data: SessionEventMap['session/title']): SessionEvent<'session/title'> =>
  ({ type: 'session/title', seq: nextSeq(), time: 0, data })

const stepStartEvent = (): SessionEvent<'step/start'> =>
  ({ type: 'step/start', seq: nextSeq(), time: 0, data: { turn: 1, step: 1 } })

const modelSource: ModelMessageSource = { kind: 'model', provider: 'p', model: 'm' }

function userMessage(text: string, source: UserMessage['source'] = { kind: 'user' }): UserMessage {
  return { role: 'user', id: MessageId(`m${seqCounter}`), content: blocks(text), source }
}

function blocks(...texts: string[]): ContentBlock[] {
  return texts.map(text => ({ type: 'text', text }))
}

function imageRef() {
  return {
    attachmentId: AttachmentId('a1'),
    mediaType: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
  } as const
}

function toolResult(callId: string, text: string, isError = false): ToolResultMessage {
  return {
    role: 'tool',
    id: MessageId(`m${seqCounter}`),
    content: blocks(text),
    source: { kind: 'tool', callId: ToolCallId(callId) },
    toolCallId: ToolCallId(callId),
    ...(isError ? { isError: true } : {}),
  }
}

function textDelta(text: string): AssistantStreamRecord[] {
  const accumulator = new AssistantStreamAccumulator()
  accumulator.push({ time: 0, chunk: { type: 'text-delta', index: 0, text } })
  return [...accumulator.snapshot()]
}

function attemptStream(text: string, reasoning: string): AssistantStreamRecord[] {
  const accumulator = new AssistantStreamAccumulator()
  accumulator.push({ time: 0, chunk: { type: 'text-delta', index: 0, text } })
  accumulator.push({ time: 1, chunk: { type: 'reasoning-delta', index: 0, text: reasoning } })
  return [...accumulator.snapshot()]
}

describe('createModel', () => {
  it('starts an empty, idle transcript with zeroed tokens', () => {
    expect(createModel()).toEqual({ items: [], tokens: { input: 0, output: 0 }, working: false })
  })
})

describe('textOf', () => {
  it('joins text blocks and trims; absent content is empty', () => {
    expect(textOf(undefined)).toBe('')
    expect(textOf([{ type: 'text', text: ' a ' }, { type: 'image', attachment: imageRef() }])).toBe('a')
  })
})

describe('user/message folding', () => {
  it('pushes direct human prompts and records the retry target', () => {
    const model = createModel()
    applyEvent(model, userMessageEvent(userMessage('hello')))
    expect(model.items).toHaveLength(1)
    expect(model.items[0]).toMatchObject({ kind: 'user', text: 'hello', streaming: false })
    expect(model.lastUserText).toBe('hello')
  })

  it('skips empty prompts and injected context sources', () => {
    const model = createModel()
    applyEvent(model, userMessageEvent(userMessage('')))
    applyEvent(
      model,
      userMessageEvent({ ...userMessage('injected'), source: { kind: 'system-prompt' } }),
    )
    expect(model.items).toHaveLength(0)
    expect(model.lastUserText).toBeUndefined()
  })

  it('renders a compaction checkpoint as a framed notice pair with the inner summary', () => {
    const model = createModel()
    const source = {
      kind: 'compact-checkpoint',
      compactionId: 'comp-1',
    } as CompactionCheckpointSource
    applyEvent(
      model,
      userMessageEvent({
        ...userMessage('preamble <compacted-summary> kept summary </compacted-summary> tail'),
        source,
      }),
    )
    expect(model.items.map(item => item.text)).toEqual(['Conversation compacted', 'kept summary'])
    expect(model.items.every(item => item.notice === 'compact')).toBe(true)
  })

  it('renders a checkpoint without a summary frame as the raw text', () => {
    const model = createModel()
    const source = {
      kind: 'compact-checkpoint',
      compactionId: 'comp-1',
    } as CompactionCheckpointSource
    applyEvent(model, userMessageEvent({ ...userMessage('summary only'), source }))
    expect(model.items.map(item => item.text)).toEqual(['Conversation compacted', 'summary only'])
  })

  it('skips the summary notice when the checkpoint carries no text', () => {
    const model = createModel()
    const source = {
      kind: 'compact-checkpoint',
      compactionId: 'comp-1',
    } as CompactionCheckpointSource
    applyEvent(model, userMessageEvent({ ...userMessage(''), source }))
    expect(model.items.map(item => item.text)).toEqual(['Conversation compacted'])
  })
})

describe('assistant stream folding', () => {
  it('folds live text and reasoning deltas into open items', () => {
    const model = createModel()
    applyStreamChunk(model, { type: 'text-delta', index: 0, text: 'Hel' })
    applyStreamChunk(model, { type: 'text-delta', index: 0, text: 'lo' })
    applyStreamChunk(model, { type: 'reasoning-delta', index: 0, text: 'think' })
    expect(model.items.map(item => [item.kind, item.text])).toEqual([
      ['assistant', 'Hello'],
      ['reasoning', 'think'],
    ])
    expect(model.items.every(item => item.streaming)).toBe(true)
    expect(model.openAssistant?.text).toBe('Hello')
    expect(model.openReasoning?.text).toBe('think')
  })

  it('ignores empty deltas and non-text chunk kinds', () => {
    const model = createModel()
    applyStreamChunk(model, { type: 'text-delta', index: 0, text: '' })
    applyStreamChunk(model, { type: 'block-start', index: 0, blockType: 'text' })
    applyStreamChunk(model, { type: 'reasoning-delta', index: 0, text: '' })
    expect(model.items).toHaveLength(0)
  })

  it('seals the assistant item and its reasoning on the authoritative message', () => {
    const model = createModel()
    applyStreamChunk(model, { type: 'text-delta', index: 0, text: 'streamed' })
    applyStreamChunk(model, { type: 'reasoning-delta', index: 0, text: 'why' })
    applyEvent(
      model,
      assistantMessageEvent({
        turn: 1,
        step: 1,
        message: { role: 'assistant', id: MessageId('m-final'), content: blocks('final'), source: modelSource },
        stream: [],
      }),
    )
    expect(model.items.map(item => [item.kind, item.text, item.streaming])).toEqual([
      ['assistant', 'final', false],
      ['reasoning', 'why', false],
    ])
    expect(model.openAssistant).toBeUndefined()
    expect(model.openReasoning).toBeUndefined()
  })

  it('keeps the streamed text when the message carries none and folds usage', () => {
    const model = createModel()
    applyStreamChunk(model, { type: 'text-delta', index: 0, text: 'kept' })
    applyEvent(
      model,
      assistantMessageEvent({
        turn: 1,
        step: 1,
        message: { role: 'assistant', id: MessageId('m-final'), content: [], source: modelSource },
        stream: [],
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    )
    expect(model.items[0]?.text).toBe('kept')
    expect(model.tokens).toEqual({ input: 10, output: 5 })
  })

  it('accumulates usage across messages and tolerates absent usage', () => {
    const model = createModel()
    applyEvent(
      model,
      assistantMessageEvent({
        turn: 1,
        step: 1,
        message: { role: 'assistant', id: MessageId('m1'), content: blocks('a'), source: modelSource },
        stream: [],
        usage: { inputTokens: 4, outputTokens: 7 },
      }),
    )
    applyEvent(
      model,
      assistantMessageEvent({
        turn: 1,
        step: 2,
        message: { role: 'assistant', id: MessageId('m2'), content: blocks('b'), source: modelSource },
        stream: [],
        usage: { inputTokens: 3, outputTokens: 2 },
      }),
    )
    applyEvent(
      model,
      assistantMessageEvent({
        turn: 1,
        step: 3,
        message: { role: 'assistant', id: MessageId('m3'), content: blocks('c'), source: modelSource },
        stream: [],
      }),
    )
    expect(model.tokens).toEqual({ input: 7, output: 9 })
  })

  it('collapses overlong raw argument previews with an ellipsis', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({
        turn: 1,
        step: 1,
        callId: ToolCallId('c1'),
        name: 'bash',
        arguments: JSON.stringify({ command: 'x'.repeat(300) }),
      }),
    )
    const preview = model.items[0]?.tool?.argsPreview
    expect(preview?.length).toBe(201)
    expect(preview?.endsWith('…')).toBe(true)
  })

  it('replaces open item text from an attempt stream (replay path)', () => {
    const model = createModel()
    applyEvent(
      model,
      attemptEvent({ turn: 1, step: 1, stream: attemptStream('text', 'reason') }),
    )
    expect(model.items.map(item => [item.kind, item.text])).toEqual([
      ['reasoning', 'reason'],
      ['assistant', 'text'],
    ])
  })

  it('creates nothing when an attempt stream carries no text deltas', () => {
    const model = createModel()
    applyEvent(model, attemptEvent({ turn: 1, step: 1, stream: [] }))
    expect(model.items).toHaveLength(0)
  })

  it('seals already-open reasoning without creating fresh items on a later attempt', () => {
    const model = createModel()
    applyEvent(
      model,
      attemptEvent({ turn: 1, step: 1, stream: attemptStream('a', 'r1') }),
    )
    applyEvent(
      model,
      attemptEvent({ turn: 1, step: 2, stream: attemptStream('b', 'r2') }),
    )
    expect(model.items.map(item => [item.kind, item.text])).toEqual([
      ['reasoning', 'r2'],
      ['assistant', 'b'],
    ])
  })

  it('ignores an attempt stream whose deltas are all empty', () => {
    const model = createModel()
    applyEvent(model, attemptEvent({ turn: 1, step: 1, stream: textDelta('') }))
    expect(model.items).toHaveLength(0)
  })
})

describe('tool card folding', () => {
  it('skips ask_user_question calls (rendered through the questions provider)', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({
        turn: 1,
        step: 1,
        callId: ToolCallId('c0'),
        name: 'ask_user_question',
        arguments: '{}',
      }),
    )
    expect(model.items).toHaveLength(0)
  })

  it('creates a running card keyed by callId', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({
        turn: 1,
        step: 1,
        callId: ToolCallId('c1'),
        name: 'bash',
        arguments: '{"command":"ls"}',
      }),
    )
    expect(model.items[0]).toMatchObject({
      kind: 'tool',
      streaming: true,
      tool: { callId: 'c1', name: 'bash', argsPreview: '{"command":"ls"}', status: 'running' },
    })
  })

  it('previews exit_plan_mode as the plan heading and carries the full plan', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({
        turn: 1,
        step: 1,
        callId: ToolCallId('c1'),
        name: 'exit_plan_mode',
        arguments: JSON.stringify({ plan: '# The Plan\n\nsteps' }),
      }),
    )
    expect(model.items[0]?.tool).toMatchObject({
      argsPreview: 'The Plan',
      planText: '# The Plan\n\nsteps',
    })
  })

  it('falls back to the plan placeholder when the plan has no heading', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({
        turn: 1,
        step: 1,
        callId: ToolCallId('c1'),
        name: 'exit_plan_mode',
        arguments: JSON.stringify({ plan: 'no heading here' }),
      }),
    )
    expect(model.items[0]?.tool).toMatchObject({ argsPreview: 'plan', planText: 'no heading here' })
  })

  it('previews raw arguments for a plan-less exit_plan_mode call', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({
        turn: 1,
        step: 1,
        callId: ToolCallId('c2'),
        name: 'exit_plan_mode',
        arguments: JSON.stringify({ other: true }),
      }),
    )
    expect(model.items[0]?.tool).toMatchObject({ argsPreview: '{"other":true}' })
    expect(model.items[0]?.tool?.planText).toBeUndefined()
  })

  it('falls back to the raw arguments preview on malformed plan JSON', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({
        turn: 1,
        step: 1,
        callId: ToolCallId('c1'),
        name: 'exit_plan_mode',
        arguments: '{broken',
      }),
    )
    expect(model.items[0]?.tool).toMatchObject({ argsPreview: '{broken' })
    expect(model.items[0]?.tool?.planText).toBeUndefined()
  })

  it('marks results ok with a preview, full text, images, and valid diffs', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({
        turn: 1,
        step: 1,
        callId: ToolCallId('c1'),
        name: 'read_image',
        arguments: '{}',
      }),
    )
    applyEvent(
      model,
      toolResultEvent({
        turn: 1,
        step: 1,
        message: {
          ...toolResult('c1', 'done'),
          content: [
            { type: 'text', text: 'done' },
            { type: 'image', attachment: imageRef() },
          ],
        },
        meta: {
          diffs: [
            { path: 'a.ts', oldText: null, newText: 'new' },
            { path: 'broken', oldText: 5, newText: 'x' },
          ],
        },
      }),
    )
    const tool = model.items[0]?.tool
    expect(tool).toMatchObject({ status: 'ok', resultPreview: 'done', resultFull: 'done' })
    expect(tool?.imageRefs).toHaveLength(1)
    expect(tool?.diffs).toEqual([{ path: 'a.ts', oldText: null, newText: 'new' }])
  })

  it('leaves a card without preview content bare and ignores non-diff meta', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({ turn: 1, step: 1, callId: ToolCallId('c1'), name: 'bash', arguments: 'ls' }),
    )
    applyEvent(
      model,
      toolResultEvent({
        turn: 1,
        step: 1,
        message: toolResult('c1', ''),
        meta: 'not-an-object',
      }),
    )
    const tool = model.items[0]?.tool
    expect(tool?.status).toBe('ok')
    expect(tool?.resultPreview).toBeUndefined()
    expect(tool?.diffs).toBeUndefined()
    expect(tool?.imageRefs).toBeUndefined()
  })

  it('keeps only valid diffs and skips an empty filtered set', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({ turn: 1, step: 1, callId: ToolCallId('c1'), name: 'write', arguments: '{}' }),
    )
    applyEvent(
      model,
      toolResultEvent({
        turn: 1,
        step: 1,
        message: toolResult('c1', 'ok'),
        meta: { diffs: [{ path: 1 }, 'nope', null, ['nested']] },
      }),
    )
    expect(model.items[0]?.tool?.diffs).toBeUndefined()
  })

  it('ignores results with no matching card', () => {
    const model = createModel()
    applyEvent(model, toolResultEvent({ turn: 1, step: 1, message: toolResult('ghost', 'x') }))
    expect(model.items).toHaveLength(0)
  })

  it('marks plain thrown errors with the stripped message text', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({ turn: 1, step: 1, callId: ToolCallId('c1'), name: 'bash', arguments: 'x' }),
    )
    applyEvent(
      model,
      toolResultEvent({
        turn: 1,
        step: 1,
        message: toolResult('c1', 'Error: disk on fire', true),
      }),
    )
    expect(model.items[0]?.tool).toMatchObject({ status: 'error', errorText: 'disk on fire' })
  })

  it('marks harness failures with the failure identity', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({ turn: 1, step: 1, callId: ToolCallId('c1'), name: 'bash', arguments: 'x' }),
    )
    applyEvent(
      model,
      toolResultEvent({
        turn: 1,
        step: 1,
        message: toolResult('c1', 'reason text'),
        error: { name: 'HarnessError', code: 'TIMEOUT' },
      }),
    )
    expect(model.items[0]?.tool).toMatchObject({ status: 'error', errorText: 'HarnessError: TIMEOUT' })
  })

  it('renders plan-review rejections as the rejected status', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({
        turn: 1,
        step: 1,
        callId: ToolCallId('c1'),
        name: 'exit_plan_mode',
        arguments: '{"plan":"# P"}',
      }),
    )
    applyEvent(
      model,
      toolResultEvent({
        turn: 1,
        step: 1,
        message: toolResult('c1', 'Error: The user chose to keep planning', true),
      }),
    )
    expect(model.items[0]?.tool).toMatchObject({
      status: 'rejected',
      resultPreview: 'Plan not approved — still in plan mode',
    })
  })

  it('renders dismissed plan reviews as the chat-instead message', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({
        turn: 1,
        step: 1,
        callId: ToolCallId('c1'),
        name: 'exit_plan_mode',
        arguments: '{"plan":"# P"}',
      }),
    )
    applyEvent(
      model,
      toolResultEvent({
        turn: 1,
        step: 1,
        message: toolResult('c1', 'Error: The user dismissed the plan review to speak instead', true),
      }),
    )
    expect(model.items[0]?.tool).toMatchObject({
      status: 'rejected',
      resultPreview: 'Dismissed — chat instead; still in plan mode',
    })
  })

  it('keeps ordinary exit_plan_mode failures as errors', () => {
    const model = createModel()
    applyEvent(
      model,
      toolCallEvent({
        turn: 1,
        step: 1,
        callId: ToolCallId('c1'),
        name: 'exit_plan_mode',
        arguments: '{"plan":"# P"}',
      }),
    )
    applyEvent(
      model,
      toolResultEvent({
        turn: 1,
        step: 1,
        message: toolResult('c1', 'Error: something else', true),
      }),
    )
    expect(model.items[0]?.tool).toMatchObject({ status: 'error', errorText: 'something else' })
  })
})

describe('request header folding', () => {
  it('records the route and reasoning effort from the dispatched header', () => {
    const model = createModel()
    applyEvent(
      model,
      requestHeaderEvent({
        header: { config: { provider: 'p1', model: 'm1', reasoningEffort: ReasoningEffortId('high') } },
        reason: 'initial',
      }),
    )
    expect(model.route).toEqual({ provider: 'p1', model: 'm1' })
    expect(model.effort).toBe('high')
  })

  it('keeps only the route when the header carries no effort, and skips empty headers', () => {
    const model = createModel()
    applyEvent(
      model,
      requestHeaderEvent({
        header: { config: { provider: 'p1', model: 'm1' } },
        reason: 'initial',
      }),
    )
    expect(model.route).toEqual({ provider: 'p1', model: 'm1' })
    expect(model.effort).toBeUndefined()
    applyEvent(
      model,
      requestHeaderEvent({
        header: { config: { provider: 'p1', model: 'm1', reasoningEffort: ReasoningEffortId('low') } },
        reason: 'change',
      }),
    )
    expect(model.effort).toBe('low')
    applyEvent(
      model,
      requestHeaderEvent({
        header: {} as SessionEventMap['request/header']['header'],
        reason: 'resume',
      }),
    )
    expect(model.route).toEqual({ provider: 'p1', model: 'm1' })
    applyEvent(
      model,
      requestHeaderEvent({
        header: { config: {} as SessionEventMap['request/header']['header']['config'] },
        reason: 'series',
      }),
    )
    expect(model.route).toEqual({})
  })
})

describe('turn boundary folding', () => {
  it('drives the working flag and seals reasoning at a completed turn end', () => {
    const model = createModel()
    applyEvent(model, turnStartEvent())
    expect(model.working).toBe(true)
    applyStreamChunk(model, { type: 'reasoning-delta', index: 0, text: 'r' })
    applyStreamChunk(model, { type: 'text-delta', index: 0, text: 't' })
    applyEvent(model, turnEndEvent({ turn: 1, reason: { kind: 'completed' } }))
    expect(model.working).toBe(false)
    expect(model.items.find(item => item.kind === 'reasoning')?.streaming).toBe(false)
    expect(model.items.find(item => item.kind === 'assistant')?.streaming).toBe(true)
    expect(model.openReasoning).toBeUndefined()
    expect(model.openAssistant).toBeUndefined()
    expect(model.items.every(item => item.kind !== 'notice')).toBe(true)
  })

  it('surfaces aborted and max-tokens endings as info notices', () => {
    const model = createModel()
    applyEvent(
      model,
      turnEndEvent({ turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
    )
    applyEvent(model, turnEndEvent({ turn: 2, reason: { kind: 'max-tokens' } }))
    expect(model.items.map(item => [item.notice, item.text])).toEqual([
      ['info', 'turn aborted'],
      ['info', 'turn hit the output-token ceiling'],
    ])
  })

  it('surfaces failed endings with the failure code and message', () => {
    const model = createModel()
    applyEvent(
      model,
      turnEndEvent({
        turn: 1,
        reason: { kind: 'error', error: { message: 'boom', code: 'PROVIDER_DOWN' } },
      }),
    )
    expect(model.items[0]).toMatchObject({ notice: 'error', text: 'turn failed: PROVIDER_DOWN — boom' })
  })

  it('renders empty failure messages without decoration', () => {
    const model = createModel()
    applyEvent(
      model,
      turnEndEvent({ turn: 1, reason: { kind: 'error', error: { message: '', code: 'MYSTERY' } } }),
    )
    expect(model.items[0]?.text).toBe('turn failed: MYSTERY')
  })
})

describe('plugin event folding', () => {
  it('adopts the latest session title', () => {
    const model = createModel()
    applyEvent(
      model,
      sessionTitleEvent({
        title: 'Refactor the parser',
        messageSeqs: [],
        source: { kind: 'user' },
      }),
    )
    expect(model.title).toBe('Refactor the parser')
  })

  it('ignores empty titles and unrecognized events', () => {
    const model = createModel()
    applyEvent(model, sessionTitleEvent({ title: '', messageSeqs: [], source: { kind: 'user' } }))
    applyEvent(model, stepStartEvent())
    expect(model.title).toBeUndefined()
  })
})

describe('pushNotice', () => {
  it('pushes info notices by default and honors explicit flavors', () => {
    const model = createModel()
    const info = pushNotice(model, 'note')
    const error = pushNotice(model, 'broken', 'error')
    expect(info).toMatchObject({ kind: 'notice', notice: 'info', text: 'note' })
    expect(error.notice).toBe('error')
    expect(model.items).toHaveLength(2)
  })
})

describe('item id sequencing', () => {
  it('assigns sequential ids across folds', () => {
    const model = createModel()
    applyEvent(model, userMessageEvent(userMessage('one')))
    applyEvent(model, userMessageEvent(userMessage('two')))
    expect(model.items.map((item: ChatItem) => item.id)).toEqual([0, 1])
  })
})
