import { describe, expect, it } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import { createMessage, createUserMessage, markAgentLoopRequest, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createSystemMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { installContextCapture, readContextSnapshot } from '../src/core/context.ts'

describe('TUI context capture', () => {
  it('keeps only main-request metadata per Session and associates provider usage', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    installContextCapture(ctx)
    const first = ctx.sessions.create(SessionId('context-first'))
    const second = ctx.sessions.create(SessionId('context-second'))
    first.append('request/context', { provider: 'mock', model: 'small', contextWindow: 64_000 })
    const request = markAgentLoopRequest<GenerateOptions>({
      provider: 'mock', model: 'small', sessionId: first.id, maxTokens: 1_024,
      messages: [
        createSystemMessage('private prompt text'),
        ...Array.from({ length: 22 }, (_, index) => createUserMessage({
          source: { kind: 'user' }, content: [{ type: 'text', text: `private history ${index}` }],
        })),
        createMessage({
          role: 'tool', toolCallId: ToolCallId('private-tool-call'),
          source: { kind: 'tool', callId: ToolCallId('private-tool-call') },
          content: [{ type: 'text', text: 'private tool result' }],
        }),
      ],
      tools: [{ name: 'search', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
    })
    const chunks: StreamChunk[] = []
    const stream = ctx.waterfall('llm/stream', request, () => (async function* () {
      yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24, cacheReadTokens: 6 } }
    })())
    for await (const chunk of stream) chunks.push(chunk)
    expect(chunks).toHaveLength(1)
    const inbox = { nextStep: [], nextTurn: [] }
    const snapshot = readContextSnapshot(ctx, first, inbox)
    expect(snapshot.lastRequest).toMatchObject({
      provider: 'mock', model: 'small', contextWindow: 64_000, maxTokens: 1_024,
      messageCount: 24, toolCount: 1, usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24, cacheReadTokens: 6 },
    })
    expect(snapshot.lastRequest?.messageTokens).toBeGreaterThan(0)
    expect(snapshot.lastRequest?.toolSchemaTokens).toBeGreaterThan(0)
    expect(snapshot.lastRequest?.categories.system.count).toBe(1)
    expect(snapshot.lastRequest?.categories.history.count).toBe(22)
    expect(snapshot.lastRequest?.categories.toolResults.count).toBe(1)
    expect(snapshot.lastRequest?.seq).toBe(first.seq)
    expect(JSON.stringify(snapshot)).not.toContain('private prompt text')
    expect(JSON.stringify(snapshot)).not.toContain('private tool result')
    expect(readContextSnapshot(ctx, second, inbox).lastRequest).toBeUndefined()
    const generation = snapshot.lastRequest?.generation
    first.append('user/message', createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'later retained state' }],
    }), { surfaceOp: 'append' })
    expect(first.seq).toBeGreaterThan(snapshot.lastRequest!.seq)
    expect(readContextSnapshot(ctx, first, inbox).lastRequest).toEqual(snapshot.lastRequest)
    const auxiliary = { ...request, purpose: 'session-title' as const }
    const auxiliaryStream = ctx.waterfall('llm/stream', auxiliary, () => (async function* () {
      yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 2 } }
    })())
    for await (const _chunk of auxiliaryStream) { /* consume */ }
    expect(readContextSnapshot(ctx, first, inbox).lastRequest?.generation).toBe(generation)
    await ctx.fiber.dispose()
  })

  it('removes its process-wide listener when the owning Cordis scope unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const owner = await ctx.plugin(() => {})
    const session = ctx.sessions.create(SessionId('context-dispose'))
    installContextCapture(owner.ctx)
    const request = (): GenerateOptions => markAgentLoopRequest({
      provider: 'mock', model: 'small', sessionId: session.id,
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'private' }] })],
    })
    const run = async (options: GenerateOptions) => {
      const stream = ctx.waterfall('llm/stream', options, () => (async function* () {
        yield { type: 'finish', reason: { kind: 'stop' } }
      })())
      for await (const _chunk of stream) { /* drain the request */ }
    }
    await run(request())
    const before = readContextSnapshot(ctx, session, { nextStep: [], nextTurn: [] }).lastRequest
    expect(before?.generation).toBe(1)
    await owner.ctx.fiber.dispose()
    await run(request())
    expect(readContextSnapshot(ctx, session, { nextStep: [], nextTurn: [] }).lastRequest).toEqual(before)
    await ctx.fiber.dispose()
  })

  it.each([
    { description: 'missing', entries: [] },
    { description: 'inactive', entries: [{ options: { id: 'system-prompt', config: { requiredSections: { tools: '1' } } }, fiber: { state: FiberState.DISPOSED } }] },
  ])('reports required sections as unknown when the system-prompt Loader row is $description', async ({ entries }) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.provide('loader', { entries: () => entries })
    const session = ctx.sessions.create(SessionId(`context-loader-${entries.length}`))
    expect(readContextSnapshot(ctx, session, { nextStep: [], nextTurn: [] }).configuredSections).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
