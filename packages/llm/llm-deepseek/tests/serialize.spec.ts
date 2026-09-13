/** Request conversion and durable replay validation. */
import { describe, expect, it, vi } from 'vitest'
import { createDeveloperMessage, createUserMessage, createAssistantMessage, createMessage, createSystemMessage, createToolResultMessage, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, ImageBlock, Message, RequestMessage, RequestUserInput } from '@deepseek-ai/dsh-llm'
import { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import { resolveAdapterOptions } from '../src/config.ts'
import { modelInfo } from '../src/model-info.ts'
import type { Options as Config } from '../src/config.ts'
import { imagePricing, inlineImages, prepareImages } from '../src/images.ts'
import { readReplay, replayState } from '../src/replay.ts'
import { serialize } from '../src/serialize.ts'
import { MODEL, options, user, requestImageStore } from './helpers.ts'

const connection = resolveAdapterOptions({})
const call = (id = 'a'): ContentBlock => ({ type: 'tool-call', id: ToolCallId(id), name: 'read', arguments: '{"path":"a"}' })
const assistant = (content: ContentBlock[]) => createAssistantMessage({ content, source: { provider: 'deepseek-official', model: MODEL } })
const result = (id = 'a', content: ContentBlock[] = [{ type: 'text', text: 'result' }]) => createToolResultMessage({ callId: ToolCallId(id), content, isError: false })
const body = (messages: RequestMessage[] = [user()], overrides: Partial<GenerateOptions> = {}) => serialize(
  options({ messages, ...overrides }), connection, messages, new Map(), () => undefined,
)
const capable = resolveAdapterOptions({ models: [{ id: MODEL, systemPromptUpdate: 'in-history' }] })
const nativeBody = (messages: Message[]) => serialize(options({ messages }), capable, messages, new Map(), () => undefined)

describe('Messages request conversion', () => {
  it('rejects unknown plugin content without interpreting its payload', () => {
    expect(() => body([createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'plugin:text', text: 'opaque' } as never,
    ] })])).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }))
  })
  it.each(['user', 'system', 'assistant', 'tool'] as const)('rejects tool-change blocks in %s history', (role) => {
    for (const type of ['tool-addition', 'tool-removal'] as const) {
      const content: ContentBlock[] = [{ type, toolName: 'search' }]
      const message = role === 'user' ? createUserMessage({ source: { kind: 'user' }, content })
        : role === 'system' ? createMessage({ role, source: { kind: 'system-prompt' }, content })
          : role === 'assistant' ? assistant(content) : result('invalid', content)
      expect(() => body([message])).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }))
    }
  })

  it('rejects deferred tool definitions until provider loading is implemented', () => {
    expect(() => body([], { tools: [{ name: 'search', description: '', parameters: {}, deferLoading: true }] }))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }))
  })

  it('preserves the exact request with request-only text after durable tool results', () => {
    const prefix = [user(), assistant([call()]), result()]
    const input: RequestUserInput = { role: 'user', content: [{ type: 'text', text: 'review or summarize this input' }] }
    const durable = createUserMessage({ content: input.content, source: { kind: 'user' } })
    expect(body([...prefix, input], { system: 'policy' })).toEqual(body([...prefix, durable], { system: 'policy' }))
  })

  it('preserves request-only image content through image preparation and wire conversion', async () => {
    const attachment: ImageAttachmentRef = {
      attachmentId: AttachmentId(`sha256:${'e'.repeat(64)}`), mediaType: 'image/png', bytes: 3, width: 1, height: 1,
    }
    const version: RequestImageAttachment = {
      variantId: ImageVariantId(`sha256:${'f'.repeat(64)}`), attachment, data: Uint8Array.of(1, 2, 3),
      mediaType: 'image/png', bytes: 3, width: 1, height: 1, depth: 'uchar', space: 'srgb', hasAlpha: true,
    }
    const input: RequestUserInput = { role: 'user', content: [
      { type: 'text', text: 'before' }, { type: 'image', attachment }, { type: 'text', text: 'after' },
    ] }
    const store = requestImageStore(async () => version)
    const vision = resolveAdapterOptions({ models: [{ id: MODEL, inputModalities: ['text', 'image'] }] })
    const durable = createUserMessage({ content: input.content, source: { kind: 'user' } })
    const actual = await prepareImages([input], vision, MODEL, store, () => undefined, new AbortController().signal)
    const expected = await prepareImages([durable], vision, MODEL, store, () => undefined, new AbortController().signal)
    expect(serialize(options({ messages: [input] }), vision, actual.messages, actual.versions, () => undefined))
      .toEqual(serialize(options({ messages: [durable] }), vision, expected.messages, expected.versions, () => undefined))
    expect(actual.messages[0]).toBe(input)
    expect(input).not.toHaveProperty('id')
    expect(input).not.toHaveProperty('source')
  })

  it('rejects developer history while provider serialization is unsupported', () => {
    const message = createDeveloperMessage({ content: [{ type: 'tool-addition', toolName: 'search' }], source: { kind: 'tool-registry' } })
    expect(() => body([message])).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }))
  })

  it('keeps the original top-level prompt and cached prefix while appending native system updates', () => {
    const head = createSystemMessage('original')
    const first = [head, user('first')]
    const update = createSystemMessage('updated')
    const second = [...first, assistant([{ type: 'text', text: 'one' }]), update, user('second')]
    const saved = JSON.stringify(second)
    const before = nativeBody(first)
    const after = nativeBody(second)
    expect(after.system).toBe(before.system)
    expect(after.messages.slice(0, before.messages.length)).toEqual(before.messages)
    expect(after.messages.slice(-2)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'second' }] },
      { role: 'system', content: [{ type: 'text', text: 'updated' }] },
    ])
    const third = nativeBody([...second, assistant([{ type: 'text', text: 'two' }]), user('third')])
    expect(third.messages.slice(0, after.messages.length)).toEqual(after.messages)
    expect(JSON.stringify(second)).toBe(saved)
  })

  it('places system updates after all parallel tool results and before the next assistant', () => {
    const history = [createSystemMessage('original'), user(), assistant([call(), call('b')]),
      createSystemMessage('first update'), result(), createSystemMessage('second update'), result('b'),
      user('more input'), assistant([{ type: 'text', text: 'done' }])]
    const request = nativeBody(history)
    expect(request.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'system', 'system', 'assistant'])
    expect(request.messages[2]?.content.map(block => block.type)).toEqual(['tool_result', 'tool_result', 'text'])
    expect(request.messages.slice(3, 5).map(message => message.content)).toEqual([
      [{ type: 'text', text: 'first update' }], [{ type: 'text', text: 'second update' }],
    ])
  })

  it('accepts native trailing updates without a top-level prompt and rejects unrepresentable positions', () => {
    const update = createSystemMessage('update')
    expect(nativeBody([user(), update])).toMatchObject({ messages: [
      { role: 'user' }, { role: 'system', content: [{ type: 'text', text: 'update' }] },
    ] })
    expect(nativeBody([user(), update]).system).toBeUndefined()
    expect(() => nativeBody([user(), assistant([{ type: 'text', text: 'done' }]), update])).toThrow(/preceding user/)
    expect(() => nativeBody([user(), createSystemMessage('')])).toThrow(/empty in-history/)
    expect(() => nativeBody([user(), assistant([call(), call('b')]), update, result()])).toThrow(/immediate results/)
  })

  it.each([[], [{ type: 'reasoning', text: 'child reasoning' }], [call('child-call')]] satisfies ContentBlock[][])(
    'rejects native system updates when their user input is omitted %#', (...content) => {
      const empty = createMessage({ role: 'user', source: { kind: 'user' }, content })
      const history = [user(), assistant([{ type: 'text', text: 'answer' }]), createSystemMessage('updated'), empty]
      const saved = JSON.stringify(history)
      for (const messages of [history, [...history, assistant([{ type: 'text', text: 'next answer' }])]]) {
        expect(() => nativeBody(messages)).toThrow(expect.objectContaining({
          code: 'UNSUPPORTED_CONTENT',
          message: 'DeepSeek Messages cannot represent system update without a preceding user or tool-result turn',
        }))
      }
      expect(JSON.stringify(history)).toBe(saved)
    },
  )

  it('keeps native system updates after retained text or tool results beside omitted user input', () => {
    const reasoning: ContentBlock = { type: 'reasoning', text: 'child reasoning' }
    const empty = createMessage({ role: 'user', source: { kind: 'user' }, content: [reasoning] })
    const update = createSystemMessage('updated')
    for (const [previous, retained, expected] of [
      [assistant([{ type: 'text', text: 'answer' }]), user('continue'), [{ type: 'text', text: 'continue' }]],
      [assistant([call()]), result('a', [reasoning]), [{ type: 'tool_result', tool_use_id: 'a', content: [], is_error: false }]],
    ] as const) {
      const history = [user(), previous, update, empty, retained, assistant([{ type: 'text', text: 'done' }])]
      const saved = JSON.stringify(history)
      const request = nativeBody(history)
      expect(request.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'system', 'assistant'])
      expect(request.messages[2]?.content).toEqual(expected)
      expect(request.messages[3]?.content).toEqual([{ type: 'text', text: 'updated' }])
      expect(JSON.stringify(history)).toBe(saved)
    }
  })

  it('groups parallel results before ordinary text and keeps tool failure content', () => {
    const messages = [user(), assistant([call(), call('b')]), user('follow-up'), result(), createToolResultMessage({ callId: ToolCallId('b'), content: [{ type: 'text', text: 'permission denied' }], isError: true })]
    expect(body(messages).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: ['a', 'b'].map(id => ({ type: 'tool_use', id, name: 'read', input: { path: 'a' } })) },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'result' }], is_error: false },
        { type: 'tool_result', tool_use_id: 'b', content: [{ type: 'text', text: 'permission denied' }], is_error: true },
        { type: 'text', text: 'follow-up' },
      ] },
    ])
    expect(messages[2]?.content).toEqual([{ type: 'text', text: 'follow-up' }])
  })

  it('preserves empty results without inventing model-visible output', () => {
    const response = body([user(), assistant([call()]), result('a', [])])
    expect(response.messages[2]?.content[0]).toMatchObject({ content: [] })
    const { isError: _isError, ...minimal } = createToolResultMessage({ callId: ToolCallId('a'), content: [{ type: 'text', text: '' }], isError: false })
    expect(body([assistant([call()]), minimal]).messages[1]?.content[0]).toEqual({ type: 'tool_result', tool_use_id: 'a', content: [] })
  })

  it('omits assistant-only blocks from user input while preserving text and durable content', () => {
    const history = [createMessage({ role: 'user', source: { kind: 'user' }, content: [
      { type: 'text', text: 'Background subagent finished.\n' },
      { type: 'reasoning', text: 'child reasoning' },
      call('child-call'),
      { type: 'text', text: '  child answer  ' },
    ] })]
    const saved = JSON.stringify(history)

    expect(body(history).messages).toEqual([{ role: 'user', content: [
      { type: 'text', text: 'Background subagent finished.\n' },
      { type: 'text', text: '  child answer  ' },
    ] }])
    expect(JSON.stringify(history)).toBe(saved)
  })

  it('omits assistant-only blocks inside tool results while retaining calls, errors and empty results', () => {
    const reasoning: ContentBlock = { type: 'reasoning', text: 'tool reasoning' }
    const history = [assistant([reasoning, call(), call('b')]),
      createToolResultMessage({ callId: ToolCallId('a'), content: [reasoning, call('nested-call'), { type: 'text', text: '  result\n' }], isError: true }),
      result('b', [reasoning, call('another-nested-call')]),
    ]
    const saved = JSON.stringify(history)

    expect(body(history).messages).toEqual([
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 'tool reasoning' },
        ...['a', 'b'].map(id => ({ type: 'tool_use', id, name: 'read', input: { path: 'a' } })),
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: '  result\n' }], is_error: true },
        { type: 'tool_result', tool_use_id: 'b', content: [], is_error: false },
      ] },
    ])
    expect(JSON.stringify(history)).toBe(saved)
  })

  it.each([
    [], [{ type: 'reasoning', text: 'child reasoning' }], [call('child-call')],
  ] satisfies ContentBlock[][])('omits empty user input after conversion %#', (...content) => {
    const empty = createMessage({ role: 'user', source: { kind: 'user' }, content })
    expect(body([empty, user(), assistant([{ type: 'text', text: 'answer' }]), empty]).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
    ])
  })

  it('collects leading system text and maps tools, stop sequences and explicit output cap', () => {
    const system = createMessage({ role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'instructions' }] })
    expect(body([system, user()], { system: 'top', maxTokens: 123, stop: ['END'], tools: [{ name: 'read', description: 'Read a file', parameters: { type: 'object' } }] })).toMatchObject({
      system: 'top\n\ninstructions', max_tokens: 123, stop_sequences: ['END'], tools: [{ name: 'read', description: 'Read a file', input_schema: { type: 'object' } }],
    })
    expect(body([user(), system]).system).toBe('instructions')
  })

  it('uses the latest complete system snapshot without changing tool history or durable messages', () => {
    const conversation = [user(), assistant([call()]), result(), assistant([{ type: 'text', text: 'done' }]), user('continue')]
    const history = [createSystemMessage('obsolete'), ...conversation.slice(0, 2),
      createSystemMessage('intermediate'), ...conversation.slice(2, 4),
      createSystemMessage('current'), conversation[4]!]
    const saved = JSON.stringify(history)
    expect(body(history)).toEqual({ ...body(conversation), system: 'current' })
    expect(body(history, { system: 'one-shot prefix' }).system).toBe('one-shot prefix\n\ncurrent')
    expect(JSON.stringify(history)).toBe(saved)
  })

  it('replaces adjacent system snapshots and joins blocks only within the current snapshot', () => {
    const latest = createMessage({ role: 'system', source: { kind: 'system-prompt' },
      content: [{ type: 'text', text: 'part one' }, { type: 'text', text: ' and part two' }] })
    expect(body([createSystemMessage('old'), latest, user()]).system).toBe('part one and part two')
  })

  it.each([[], [{ type: 'text' as const, text: '' }]].map(content => ({ content })))('clears earlier prompt snapshots with empty content %#', ({ content }) => {
    const cleared = createMessage({ role: 'system', source: { kind: 'system-prompt' }, content })
    const history = [createSystemMessage('old'), user(), cleared]
    expect(body(history).system).toBeUndefined()
    expect(body(history, { system: 'one-shot prefix' }).system).toBe('one-shot prefix')
    expect(body(history, { system: '' }).system).toBeUndefined()
  })

  it('rejects non-text system content even when a later snapshot supersedes it', () => {
    const invalid = createMessage({ role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'reasoning', text: 'bad' }] })
    expect(() => body([invalid, user(), createSystemMessage('current')])).toThrow(/non-text system/)
  })

  it.each(['off', 'low', 'high', 'max'])('maps reasoning effort %s', (effort) => {
    const request = body([user()], { reasoningEffort: ReasoningEffortId(effort) })
    expect(request.thinking.type).toBe(effort === 'off' ? 'disabled' : 'enabled')
    expect(request.output_config).toEqual(effort === 'off' ? undefined : { effort })
  })

  it('disables thinking for titles, passes temperature with thinking and refuses unsupported effort', () => {
    expect(body([user()], { purpose: 'session-title', temperature: 0 })).toMatchObject({ thinking: { type: 'disabled' }, temperature: 0 })
    expect(body([user()], { temperature: 0 })).toMatchObject({ thinking: { type: 'enabled' }, temperature: 0 })
    expect(() => body([user()], { reasoningEffort: ReasoningEffortId('medium') })).toThrow(/effort/)
    const disabled = resolveAdapterOptions({ thinking: 'disabled' })
    expect(serialize(options(), disabled, [user()], new Map(), () => undefined).thinking).toEqual({ type: 'disabled' })
    expect(() => serialize(options({ reasoningEffort: ReasoningEffortId('high') }), disabled, [user()], new Map(), () => undefined)).toThrow(/effort/)
    const capped = resolveAdapterOptions({ models: [{ id: MODEL, maxTokens: 321 }] })
    expect(serialize(options(), capped, [user()], new Map(), () => undefined).max_tokens).toBe(321)
  })

  it.each([
    [result()], [assistant([call()])], [assistant([call()]), user()],
    [assistant([call(), call()]), result()],
    [assistant([call()]), result(), result()],
  ])('rejects unmatched or duplicated tool history %#', (...messages) => {
    expect(() => body(messages)).toThrow(/tool/)
  })

  it.each(['{', '', '[]', 'null', '42', 'true', '"text"', '{"description":"最快，但"某个说法"没有证据。"}'])('uses empty input for malformed or non-object historical tool arguments %s', (arguments_) => {
    const message = assistant([{ type: 'tool-call', id: ToolCallId('a'), name: 'read', arguments: arguments_ }])
    const history = [user(), message, createToolResultMessage({ callId: ToolCallId('a'), content: [{ type: 'text', text: 'Invalid arguments' }], isError: true }), user('Continue')]
    const saved = JSON.stringify(history)
    const restored = JSON.parse(saved) as Message[]
    expect(body(restored).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'read', input: {} }] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'Invalid arguments' }], is_error: true },
        { type: 'text', text: 'Continue' },
      ] },
    ])
    expect(JSON.stringify(restored)).toBe(saved)
  })

  it('preserves own signed thinking, omits absent signatures and validates durable metadata', () => {
    const content: ContentBlock[] = [{ type: 'reasoning', text: '' }, { type: 'text', text: 'answer' }]
    const source = { provider: 'deepseek-official', model: MODEL, replayState: replayState(MODEL, [{ type: 'reasoning', signature: 'signed' }, { type: 'text' }]) }
    const message = createAssistantMessage({ content, source })
    expect(body([user(), message, user()]).messages[1]?.content).toEqual([{ type: 'thinking', thinking: '', signature: 'signed' }, { type: 'text', text: 'answer' }])
    expect(body([assistant([{ type: 'reasoning', text: 'foreign thought' }])]).messages[0]?.content).toEqual([{ type: 'thinking', thinking: 'foreign thought' }])
    expect(readReplay(message, 'different-model')).toBeUndefined()
    expect(readReplay(user(), MODEL)).toBeUndefined()
  })

  it.each([
    null,
    [],
    { response: null, blocks: [] },
    { response: { kind: 'other', version: 1 }, blocks: [] },
    { response: { kind: 'deepseek-messages', version: 2 }, blocks: [] },
    { response: { kind: 'deepseek-messages', version: 1, model: 'wrong' }, blocks: [] },
    { response: { kind: 'deepseek-messages', version: 1, model: MODEL }, blocks: [] },
    { response: { kind: 'deepseek-messages', version: 1, model: MODEL }, blocks: null },
    { response: { kind: 'deepseek-messages', version: 1, model: MODEL }, blocks: [null] },
    { response: { kind: 'deepseek-messages', version: 1, model: MODEL }, blocks: [{ type: 'tool-call' }] },
    { response: { kind: 'deepseek-messages', version: 1, model: MODEL }, blocks: [{ type: 'reasoning', signature: 3 }] },
  ].map(state => ({ state })))('degrades unusable replay state with a diagnostic %#', ({ state }) => {
    const message = createAssistantMessage({ content: [{ type: 'reasoning', text: 'think' }], source: { provider: 'deepseek-official', model: MODEL, replayState: state } })
    const onDegrade = vi.fn()
    expect(readReplay(message, MODEL, onDegrade)).toBeUndefined()
    expect(onDegrade).toHaveBeenCalledExactlyOnceWith(expect.any(String))
    expect(body([message]).messages[0]?.content).toEqual([{ type: 'thinking', thinking: 'think' }])
  })

  it.each([MODEL, 'different-model'])('keeps durable content when replay degrades for %s', async (model) => {
    const message = createAssistantMessage({
      content: [{ type: 'reasoning', text: 'Read the file.' }, { type: 'text', text: 'Checking a.' }, call()],
      source: { provider: 'deepseek-official', model: MODEL, replayState: replayState(MODEL, [
        { type: 'reasoning', signature: 'do-not-send' }, { type: 'text', signature: 'invalid-for-text' }, { type: 'tool-call' },
      ]) },
    })
    const saved = JSON.stringify(message)
    const restored = JSON.parse(saved) as Message
    const messages = [user(), restored, result()]
    const onDegrade = vi.fn()
    const request = serialize(options({ model }), connection, messages, new Map(), () => undefined, onDegrade)
    expect(onDegrade).toHaveBeenCalledExactlyOnceWith('DeepSeek Messages replay: invalid signature')
    await expect(JSON.stringify(request.messages, null, 2) + '\n').toMatchFileSnapshot('expected/degraded-replay.json')
    expect(JSON.stringify(restored)).toBe(saved)
  })

  it('keeps valid cross-model and foreign history quiet and propagates diagnostic failures', () => {
    const onDegrade = vi.fn()
    const message = createAssistantMessage({ content: [{ type: 'reasoning', text: 'think' }], source: {
      provider: 'deepseek-official', model: MODEL, replayState: replayState(MODEL, [{ type: 'reasoning', signature: '' }]),
    } })
    expect(readReplay(message, MODEL, onDegrade)).toEqual([{ type: 'reasoning', signature: '' }])
    expect(readReplay(message, 'different-model', onDegrade)).toBeUndefined()
    expect(readReplay(assistant([{ type: 'text', text: 'foreign' }]), MODEL, onDegrade)).toBeUndefined()
    expect(onDegrade).not.toHaveBeenCalled()
    const damaged = { ...message, source: { ...message.source, replayState: { response: {}, blocks: [] } } }
    const failure = new Error('diagnostic failed')
    expect(() => readReplay(damaged, MODEL, () => { throw failure })).toThrow(failure)
  })

  it.each([1, 2])('uses empty historical tool input with replay version %s', (version) => {
    const message = createAssistantMessage({ content: [{ type: 'tool-call', id: ToolCallId('a'), name: 'read', arguments: '{' }], source: {
      provider: 'deepseek-official', model: MODEL, replayState: { response: { kind: 'deepseek-messages', version, model: MODEL }, blocks: [{ type: 'tool-call' }] },
    } })
    const saved = JSON.stringify(message)
    const onDegrade = vi.fn()
    const request = serialize(options(), connection, [message, result()], new Map(), () => undefined, onDegrade)
    expect(request.messages[0]?.content).toEqual([{ type: 'tool_use', id: 'a', name: 'read', input: {} }])
    expect(onDegrade).toHaveBeenCalledTimes(version === 1 ? 0 : 1)
    expect(JSON.stringify(message)).toBe(saved)
  })
})

describe('validated configuration', () => {
  it('advertises exact model metadata and allows unlisted text models', () => {
    expect(modelInfo(connection, 'deepseek-official', MODEL)).toMatchObject({ context: { contextWindow: 1_000_000 }, defaultMaxTokens: 256_000, reasoning: { defaultEffort: 'high' } })
    expect(modelInfo(connection, 'deepseek-official', 'custom').inputModalities).toEqual(['text'])
    expect(modelInfo(connection, 'deepseek-official', MODEL).systemPromptUpdate).toBeUndefined()
    expect(modelInfo(connection, 'deepseek-official', 'custom').systemPromptUpdate).toBeUndefined()
    expect(modelInfo(capable, 'deepseek-official', MODEL).systemPromptUpdate).toBe('in-history')
    expect(modelInfo(capable, 'deepseek-official', 'custom').systemPromptUpdate).toBeUndefined()
    expect(modelInfo(resolveAdapterOptions({ thinking: 'disabled' }), 'deepseek-official', MODEL).reasoning?.efforts).toMatchObject([{ id: 'off', name: 'Off' }])
    expect(resolveAdapterOptions({ baseURL: 'https://example.com/anthropic///' }).baseURL).toBe('https://example.com/anthropic///')
  })
  it.each([
    { thinking: 'disabled', reasoningEffort: 'high' }, { models: [{ id: '' }] },
    { models: [{ id: 'a' }, { id: 'a' }] }, { models: [{ id: 'a', name: '' }] },
    { maxInlineRequestImageBytes: 1 }, { maxImagesPerRequest: 1 },
    { baseURL: 'ftp://example.com' }, { baseURL: 'https://user:pass@example.com' },
    { baseURL: 'https://example.com/?key=x' }, { baseURL: 'https://example.com/#x' },
    { maxTokens: 0 }, { streamIdleTimeoutMs: 0 },
    { models: [{ id: MODEL, systemPromptUpdate: 'unsupported' }] },
  ])('rejects invalid composition input %#', (value) => {
    expect(() => resolveAdapterOptions(value as Config)).toThrow()
  })
})

describe('Messages images', () => {
  const ref: ImageAttachmentRef = { attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', width: 1, height: 1, bytes: 3 }
  const image: ImageBlock = { type: 'image', attachment: ref }
  const version: RequestImageAttachment = { attachment: ref, variantId: ImageVariantId(`sha256:${'b'.repeat(64)}`), mediaType: 'image/png', bytes: 3, data: Uint8Array.of(1, 2, 3), width: 1, height: 1, depth: 'uchar', space: 'srgb', hasAlpha: false }
  const access = () => ({ readonlyPath: '/workspace/image.png' })
  const model = 'deepseek-flash'
  // Only the read operation is consumed by image preparation; the transport is mocked, not durable content.
  const attachments = requestImageStore(async () => version)
  const signal = new AbortController().signal
  it('keeps image bytes inside tool results and deduplicates normalization', async () => {
    const history = [assistant([call()]), result('a', [image, image])]
    const prepared = await prepareImages(history, connection, model, attachments, access, signal)
    expect(prepared.versions.size).toBe(1)
    const request = serialize(options({ model }), connection, prepared.messages, prepared.versions, access)
    expect(request.messages[1]?.content[0]).toMatchObject({ type: 'tool_result', content: [
      { type: 'text', text: expect.stringContaining('/workspace/image.png') as string }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } },
      { type: 'text' }, { type: 'image' },
    ] })
    expect(imagePricing(connection, model, access).priceImages([image])[0]?.visualTokens).toBeGreaterThan(0)
    expect(imagePricing(connection, MODEL, access).priceImages([image])[0]?.visualTokens).toBe(0)
  })
  it('requires logged offload at exact encoded bytes and preserves durable references', async () => {
    const config = resolveAdapterOptions({
      maxInlineRequestImageBytes: 4, inlineImageOffloadByteQuantum: 1, maxImagesPerRequest: 2, imageOffloadCountQuantum: 1,
    })
    const offloadFailure: unknown = expect.objectContaining({ code: 'IMAGE_OFFLOAD_REQUIRED', offloadImages: 1 })
    const history = [result('a', [image, image])]
    const prepared = await prepareImages(history, config, model, attachments, access, signal)
    expect(prepared.messages[0]?.content).toMatchObject([image, image])
    expect(() => inlineImages(prepared.messages, prepared.versions, config)).toThrow(expect.objectContaining({
      failure: offloadFailure,
    }))
    const offloaded: ImageBlock = { ...image, offloaded: true }
    const retry = await prepareImages([result('a', [offloaded, image])], config, model, attachments, access, signal)
    expect(inlineImages(retry.messages, retry.versions, config)[0]?.content).toMatchObject([{ type: 'text' }, { type: 'image' }])
    expect(history[0]?.content).toMatchObject([image, image])
    expect(imagePricing(config, model, access).priceImages([image, image]).map(entry => entry.visualTokens))
      .toEqual([expect.any(Number), expect.any(Number)])
    const large = requestImageStore(async () => ({ ...version, bytes: 30, data: new Uint8Array(30) }))
    const exact = await prepareImages([result('a', [image])], config, model, large, access, signal)
    expect(() => inlineImages(exact.messages, exact.versions, config)).toThrow(expect.objectContaining({
      failure: offloadFailure,
    }))
  })

  it('maps the provider-neutral tool choice', () => {
    expect(serializeRequest(request({
      messages: history,
      tools: [{ name: 'a', description: 'A', parameters: {} }],
      toolChoice: 'required',
    })).tool_choice).toBe('required')
  })

  it('omits an empty tools array', () => {
    const wire = serializeRequest(request({ messages: history, tools: [] }))
    expect(wire.tools).toBeUndefined()
  })

  it.each(['low', 'high', 'max'] as const)('maps adapter-default thinking and request effort %s', (effort) => {
    const wire = serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId(effort) }),
      { thinking: 'enabled', reasoningEffort: 'high' },
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBe(effort)
  })

  it('maps off to disabled thinking without a wire reasoning effort', () => {
    const wire = serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('off') }),
      { thinking: 'enabled', reasoningEffort: 'max' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('re-enables thinking when max overrides an off default', () => {
    const wire = serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('max') }),
      { reasoningEffort: 'off' },
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBe('max')
  })

  it('rejects enabling thinking when the deployment is locked to disabled', () => {
    expect(() => serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('high') }),
      { thinking: 'disabled' },
    )).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REASONING_EFFORT' }))
  })

  it('disables thinking for session-title requests without changing adapter defaults', () => {
    const wire = serializeRequest(
      request({
        messages: history,
        purpose: 'session-title',
        reasoningEffort: ReasoningEffortId('max'),
      }),
      { thinking: 'enabled', reasoningEffort: 'max' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('omits thinking fields when unset (provider default applies)', () => {
    const wire = serializeRequest(request({ messages: history }))
    expect(wire.thinking).toBeUndefined()
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('preserves an explicit enabled default without inventing a wire effort', () => {
    const wire = serializeRequest(request({ messages: history }), { thinking: 'enabled' })
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('rejects an effort outside the DeepSeek capability', () => {
    expect(() => serializeRequest(request({
      messages: history,
      reasoningEffort: ReasoningEffortId('medium'),
    }))).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REASONING_EFFORT' }))
  })
})

describe('image serialization', () => {
  it.each([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
  ] as const)('preserves ordered text and %s image parts', async (mediaType) => {
    const resolveFileId = fileResolver()
    const ref = imageRef(mediaType)
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [
          { type: 'text', text: 'before' },
          { type: 'image', attachment: ref },
          { type: 'text', text: 'after' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), imageOptions([ref], resolveFileId))

    expect(wire.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'before' },
        { type: 'text', text: expect.stringContaining(`Image ${ref.attachmentId}; request preview 1x1px`) as string },
        { type: 'file', file_id: 'file-api-image' },
        { type: 'text', text: 'after' },
      ],
    }])
  })

  it.each([
    ['image/png', 'data:image/png;base64,AAAA'],
    ['image/jpeg', 'data:image/jpeg;base64,AAAA'],
    ['image/webp', 'data:image/webp;base64,AAAA'],
    ['image/gif', 'data:image/gif;base64,AAAA'],
  ] as const)('serializes every retained %s request version as an inline data URL', async (mediaType, url) => {
    const ref = imageRef(mediaType)
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), inlineImageOptions([ref]))

    expect(wire.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: expect.stringContaining(`Image ${ref.attachmentId}; request preview 1x1px`) as string },
        { type: 'image_url', image_url: { url } },
      ],
    }])
  })

  it('gives image-only input a stable handle and request dimensions', async () => {
    const ref = imageRef()
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), imageOptions([ref]))

    expect(wire.messages).toEqual([{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Image ${ref.attachmentId}; request preview 1x1px. It may be resized or re-encoded; source dimensions, format, and byte size may differ.`,
        },
        { type: 'file', file_id: 'file-api-image' },
      ],
    }])
  })

  it('includes provider-resolved normalized access in a retained image handle', async () => {
    const ref = { ...imageRef(), name: 'diagram.png', width: 2048, height: 1024 }
    const images = imageOptions([ref])
    const version = images.requestImages.get(ref.attachmentId) as RequestImageAttachment
    version.width = 1130
    version.height = 565
    images.resolveImageAccess = () => ({ readonlyPath: '/tmp/dsh/objects/aa/object' })
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), images)

    expect(wire.messages[0]).toMatchObject({
      role: 'user',
      content: [{
        type: 'text',
        text: expect.stringContaining('Image "diagram.png"') as string,
      }, { type: 'file' }],
    })
    expect(JSON.stringify(wire.messages[0])).toContain('/tmp/dsh/objects/aa/object')
    expect(JSON.stringify(wire.messages[0])).toContain('request preview 1130x565px')
  })

  it('rejects an image whose prepared request version is absent', async () => {
    const ref = imageRef()
    await expect(serializeMessagesWithImages([createUserMessage({
      content: [{ type: 'image', attachment: ref }],
      source: { kind: 'plugin', plugin: 'test' },
    })], imageOptions([]))).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('keeps tool content textual and groups consecutive tool-result images afterward', async () => {
    const messages = [
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: ToolCallId('first'),
          content: [{ type: 'image', attachment: imageRef() }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: ToolCallId('second'),
          content: [
            { type: 'text', text: 'caption' },
            { type: 'image', attachment: imageRef('image/jpeg') },
          ],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ]

    const png = imageRef()
    const jpeg = imageRef('image/jpeg')
    await expect(serializeMessagesWithImages(messages, imageOptions(
      [png, jpeg],
      vi.fn((version: RequestImageAttachment) => Promise.resolve(`file-api-${version.mediaType}`)),
    ))).resolves.toEqual([
      {
        role: 'tool',
        tool_call_id: 'first',
        content: expect.stringContaining(`Image ${png.attachmentId}`) as string,
      },
      {
        role: 'tool',
        tool_call_id: 'second',
        content: expect.stringContaining(`caption\nImage ${jpeg.attachmentId}`) as string,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Attached image(s) from tool result:' },
          { type: 'file', file_id: 'file-api-image/png' },
          { type: 'file', file_id: 'file-api-image/jpeg' },
        ],
      },
    ])
  })

  it('does not emit an empty user message for ignored content beside a tool result', async () => {
    const messages = [createUserMessage({
      content: [
        { type: 'text', text: '' },
        { type: 'chart', data: 'ignored' } as unknown as ContentBlock,
        {
          type: 'tool-result',
          toolCallId: ToolCallId('result'),
          content: [{ type: 'text', text: 'ok' }],
        },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })]

    await expect(serializeMessagesWithImages(messages, imageOptions([], fileResolver()))).resolves.toEqual([
      { role: 'tool', tool_call_id: 'result', content: 'ok' },
    ])
  })

  it('recursively converts nested tool-result content and preserves the empty fallback', async () => {
    const messages = [createUserMessage({
      content: [
        {
          type: 'tool-result',
          toolCallId: ToolCallId('nested'),
          content: [{
            type: 'tool-result',
            toolCallId: ToolCallId('inner'),
            content: [{ type: 'text', text: 'inside' }],
          }],
        },
        { type: 'tool-result', toolCallId: ToolCallId('empty'), content: [] },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })]

    await expect(serializeMessagesWithImages(messages, imageOptions([], fileResolver()))).resolves.toEqual([
      { role: 'tool', tool_call_id: 'nested', content: 'inside' },
      { role: 'tool', tool_call_id: 'empty', content: '(no output)' },
    ])
  })

  it('flushes tool-result images before system and assistant history', async () => {
    const imageResult = (id: string) => createUserMessage({
      content: [{
        type: 'tool-result',
        toolCallId: ToolCallId(id),
        content: [{ type: 'image', attachment: imageRef() }],
      }],
      source: { kind: 'plugin' as const, plugin: 'test' },
    })
    const messages = [
      imageResult('before-system'),
      createMessage({
        role: 'system',
        content: [{ type: 'text', text: 'system history' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      imageResult('before-assistant'),
      createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'assistant history' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ]

    const wire = await serializeMessagesWithImages(messages, imageOptions([imageRef()], fileResolver()))
    expect(wire).toEqual([
      {
        role: 'tool',
        tool_call_id: 'before-system',
        content: expect.stringContaining('request preview 1x1px') as string,
      },
      expect.objectContaining({ role: 'user' }),
      { role: 'system', content: 'system history' },
      {
        role: 'tool',
        tool_call_id: 'before-assistant',
        content: expect.stringContaining('request preview 1x1px') as string,
      },
      expect.objectContaining({ role: 'user' }),
      { role: 'assistant', content: 'assistant history' },
    ])
  })

  it('offloads oldest images before reads and keeps the newest image', async () => {
    const resolveFileId = fileResolver()
    const png = imageRef('image/png', 3)
    const jpeg = imageRef('image/jpeg', 3)
    const images = imageOptions([png, jpeg], resolveFileId, 4)
    images.resolveImageAccess = ref => ref.mediaType === 'image/png'
      ? { readonlyPath: '/tmp/dsh/objects/png' }
      : undefined
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [
          { type: 'image', attachment: png },
          { type: 'image', attachment: jpeg },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), images)

    expect(wire.messages[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'text',
          text: expect.stringContaining(`image omitted to fit request image limits; ${png.attachmentId}. Normalized copy (read-only; may be resized or re-encoded): "/tmp/dsh/objects/png"`) as string,
        },
        { type: 'text', text: expect.stringContaining(`Image ${jpeg.attachmentId}`) as string },
        { type: 'file', file_id: 'file-api-image' },
      ],
    })
    expect(resolveFileId).toHaveBeenCalledTimes(1)
    expect(resolveFileId.mock.calls[0]?.[0]).toMatchObject({ attachment: { mediaType: 'image/jpeg' } })
  })

  it('drops base64 history from a 20-unit high watermark to a 10-unit low watermark', async () => {
    const ref = imageRef('image/png', 3)
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: Array.from({ length: 21 }, () => ({ type: 'image' as const, attachment: ref })),
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), inlineImageOptions([ref], 80, 40))

    const content = wire.messages[0]?.content
    expect(JSON.stringify(content).match(/image omitted to fit request image limits/g)).toHaveLength(11)
    expect(JSON.stringify(content).match(/"type":"image_url"/g)).toHaveLength(10)
  })

  it('rejects an unprepared image while computing exact request bytes', async () => {
    const ref = imageRef()
    await expect(serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), imageOptions([]))).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it.each(['system', 'assistant'] as const)('rejects an image in %s history before reading attachments', async (role) => {
    const resolveFileId = vi.fn()
    await expect(serializeMessagesWithImages([createMessage({
      role,
      content: [{ type: 'image', attachment: imageRef() }],
      source: { kind: 'plugin', plugin: 'test' },
    })], imageOptions([imageRef()], resolveFileId)))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(resolveFileId).not.toHaveBeenCalled()
  })

  it('rejects unsupported image history before request offloading can replace it', async () => {
    const resolveFileId = vi.fn()
    await expect(serializeRequestWithImages(request({
      messages: [createMessage({
        role: 'system',
        content: [{ type: 'image', attachment: imageRef('image/png', 300) }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), imageOptions([imageRef('image/png', 300)], resolveFileId, 1)))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(resolveFileId).not.toHaveBeenCalled()
  })

  it('prepends the request system prompt on the image path', async () => {
    const ref = imageRef()
    const wire = await serializeRequestWithImages(request({
      system: 'system prompt',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), imageOptions([ref]))
    expect(wire.messages[0]).toEqual({ role: 'system', content: 'system prompt' })
  })

  it('preserves stable file-resolution failure codes', async () => {
    const failure = new Error('Stored attachment bytes are corrupt.') as Error & { code: string }
    failure.code = 'ATTACHMENT_CORRUPT'
    const resolveFileId = vi.fn(() => Promise.reject(failure))
    await expect(serializeMessagesWithImages([createUserMessage({
      content: [{ type: 'image', attachment: imageRef() }],
      source: { kind: 'plugin', plugin: 'test' },
    })], imageOptions([imageRef()], resolveFileId)))
      .rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('preserves non-attachment resolver failures', async () => {
    const failure = new Error('resolver failed')
    const resolveFileId = vi.fn(() => Promise.reject(failure))
    await expect(serializeMessagesWithImages([createUserMessage({
      content: [{ type: 'image', attachment: imageRef() }],
      source: { kind: 'plugin', plugin: 'test' },
    })], imageOptions([imageRef()], resolveFileId))).rejects.toBe(failure)
  })
})

describe('review fixes: assistant content shapes', () => {
  it('serializes a content-less, tool-call-less assistant message as "" content, never null', () => {
    // Aborted/empty assistant turns: no text, no calls → "". The earlier
    // null shape was live-falsified: the API 400s a null-content assistant
    // message without tool_calls ("content or tool_calls must be set").
    const wire = serializeMessages([createMessage({
      role: 'assistant', content: [],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{ role: 'assistant', content: '' }])
  })

  it('serializes a reasoning-ONLY assistant message as "" content beside its reasoning', () => {
    // The model can answer entirely in the reasoning channel (a v4-flash
    // greeting did, live). Content must still be SET — a null here poisoned
    // the session log and bricked every later turn of that session.
    const wire = serializeMessages([createMessage({
      role: 'assistant', content: [{ type: 'reasoning', text: '你好！有什么我可以帮你的吗？' }],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{
      role: 'assistant', content: '', reasoning_content: '你好！有什么我可以帮你的吗？',
    }])
  })

  it('serializes tool-call turns with empty string content, not null', () => {
    const wire = serializeMessages([createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: ToolCallId('c'), name: 'f', arguments: '{}' }],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire[0]).toMatchObject({ content: '' })
  })
})
