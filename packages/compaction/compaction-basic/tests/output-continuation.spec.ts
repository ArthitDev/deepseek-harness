import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import BasicCompactionEngine from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'

class CappedAdapter extends LlmAdapter {
  calls: GenerateOptions[] = []
  constructor(private readonly caps: number) { super() }
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    if (this.calls.length <= this.caps) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId('unfinished'), name: 'never_execute', argumentsDelta: '{"value":' }
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Done' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.each([
  { caps: 0, limit: 2, expected: 1, ending: 'completed' },
  { caps: 1, limit: 2, expected: 2, ending: 'completed' },
  { caps: 5, limit: 2, expected: 3, ending: 'max-tokens' },
  { caps: 5, limit: 0, expected: 1, ending: 'max-tokens' },
])('bounds output continuation: $caps caps, limit $limit', async ({ caps, limit, expected, ending }) => {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    await ctx.plugin(BasicCompactionEngine, { maxOutputContinuations: limit })
    const adapter = new CappedAdapter(caps)
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('output-continuation'), { provider: 'mock', model: 'current-model' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Finish the task' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.calls).toHaveLength(expected)
    expect(adapter.calls.every(call => call.model === 'current-model')).toBe(true)
    const events = agent.session.snapshotEvents()
    expect(events.some(event => event.type === 'tool/call')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: ending } } })
    const notices = events.filter(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin' && event.data.source.plugin === 'output-limit-continuation')
    expect(notices).toHaveLength(expected - 1)
    if (expected > 1) {
      expect(notices[0]).toMatchObject({ data: {
        source: { form: 'notice', summary: `Output limit reached; auto-continue 1/${limit}` },
      } })
      expect(adapter.calls[1]?.messages.some(message => message.content.some(block =>
        block.type === 'text' && block.text.includes('Continue only the unfinished work')))).toBe(true)
    }
    if (ending === 'max-tokens' && limit > 0) {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Try again' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      expect(adapter.calls).toHaveLength(6)
    }
  } finally {
    await ctx.fiber.dispose()
  }
})

it.each([-1, 1.5, Number.NaN])('rejects invalid continuation limit %s', (value) => {
  expect(() => resolveConfig({ maxOutputContinuations: value })).toThrow('maxOutputContinuations')
})

it.each(['cancel', 'queued', 'manual', 'dispose'] as const)('respects %s at the turn boundary', async (mode) => {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    const intercept = ctx.on('agent/turn-stopping', ({ agent }) => {
      if (mode === 'cancel') agent.cancel({ kind: 'user' })
      if (mode === 'queued') {
        intercept()
        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'New task' }], source: { kind: 'user' } }))
      }
    })
    const fiber = ctx.plugin(BasicCompactionEngine, { auto: mode !== 'manual' })
    await fiber
    if (mode === 'dispose') await fiber.dispose()
    const adapter = new CappedAdapter(1)
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('boundary'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.calls).toHaveLength(mode === 'queued' ? 2 : 1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin' && event.data.source.plugin === 'output-limit-continuation')).toEqual([])
    if (mode === 'cancel') expect(agent.session.snapshotEvents().at(-1)).toMatchObject({
      type: 'turn/end', data: { reason: { kind: 'aborted' } },
    })
  } finally {
    await ctx.fiber.dispose()
  }
})
