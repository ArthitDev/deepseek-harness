import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as RunBudget from '@deepseek-ai/dsh-run-budget'
import type { Config } from '@deepseek-ai/dsh-run-budget'

/**
 * Behavior suite for the run-budget guard: token-ceiling denial via the
 * metering fold, wall-clock denial, direct-execute bypass, wrap-up instruction
 * text, and fail-loud config validation — budgeted calls run through a real
 * agent loop against a scripted mock adapter (no model, no network).
 */

/** Stand-in meter whose total is fixed at construction. */
class TokenMeter extends Service {
  static inject = []

  constructor(ctx: Context, config: { total: number }) {
    super(ctx, 'tokenMeter')
    this.total = config.total
  }

  private readonly total: number

  measure(): { totalTokens: number } {
    return { totalTokens: this.total }
  }
}

/** Boot the loop spine + meter + budget; the caller registers adapters. */
async function harness(config: Config, meterTotal?: number): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  if (meterTotal !== undefined) await ctx.plugin(TokenMeter, { total: meterTotal })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(RunBudget, config)
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text', text: 'done' }] } }))
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

async function runAgent(ctx: Context, provider: string): Promise<Agent> {
  const adapter = new MockAdapter([
    toolCallResponse('c1', 'probe', {}),
    textResponse('wrapping up with the partial report'),
  ])
  ctx.llm.registerAdapter([provider], adapter)
  const agent = await ctx.agentLoop.create(SessionId(provider), { provider, model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await waitForIdle(ctx, agent)
  return agent
}

/** Every tool result message in the agent's log, flattened to isError + text. */
function toolResults(agent: Agent): { isError: boolean; text: string }[] {
  return agent.session.snapshotEvents()
    .filter((e): e is SessionEvent<'tool/result'> => e.type === 'tool/result')
    .map(e => ({
      isError: e.data.message.isError === true,
      text: e.data.message.content.map(block => block.type === 'text' ? block.text : '').join(''),
    }))
}

describe('token ceiling', () => {
  it('delegates while the measured total stays under the limit', async () => {
    const ctx = await harness({ maxTotalTokens: 1_000 }, 500)
    const agent = await runAgent(ctx, 'mock-a')
    const results = toolResults(agent)
    expect(results).toHaveLength(1)
    expect(results[0]!.isError).toBe(false)
    expect(results[0]!.text).toBe('done')
  })

  it('denies with BUDGET_EXCEEDED once the measured total reaches the limit', async () => {
    const ctx = await harness({ maxTotalTokens: 500 }, 500)
    const agent = await runAgent(ctx, 'mock-b')
    const results = toolResults(agent)
    expect(results).toHaveLength(1)
    expect(results[0]!.isError).toBe(true)
    // The durable projection keeps the model-facing text; structured info is
    // not echoed into the log.
    expect(results[0]!.text).toContain('run budget exhausted (totalTokens=500)')
    expect(results[0]!.text).toContain('produce the partial report now')
  })

  it('fails loud when the token ceiling is set but no meter is mounted', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await expect(ctx.plugin(RunBudget, { maxTotalTokens: 100 })).rejects.toThrow(/token-meter service/)
  })
})

describe('wall clock', () => {
  it('denies once maxWallMs have passed since the agent\'s first observed call', async () => {
    const ctx = await harness({ maxWallMs: 60_000 })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      toolCallResponse('c2', 'probe', {}),
      textResponse('wrapping up with the partial report'),
    ])
    ctx.llm.registerAdapter(['mock-slow'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('slow'), { provider: 'mock-slow', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    const results = toolResults(agent)
    expect(results).toHaveLength(2)
    expect(results.every(r => !r.isError)).toBe(true)
  })

  it('denies a later call after the ceiling elapses between calls', async () => {
    const ctx = await harness({ maxWallMs: 40 })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      textResponse('turn one done'),
      toolCallResponse('c2', 'probe', {}),
      textResponse('wrapping up with the partial report'),
    ])
    ctx.llm.registerAdapter(['mock-two-turn'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('two-turn'), { provider: 'mock-two-turn', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    await new Promise(resolve => setTimeout(resolve, 55))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const results = toolResults(agent)
    expect(results).toHaveLength(2)
    expect(results[0]!.isError).toBe(false)
    expect(results[1]!.isError).toBe(true)
    expect(results[1]!.text).toContain('run budget exhausted (wallMs=')
    expect(results[1]!.text).toContain('produce the partial report now')
  })
})

describe('direct executes', () => {
  it('bypass the budget (no agent to key on)', async () => {
    const ctx = await harness({ maxTotalTokens: 1 }, 500)
    const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('d1'), name: 'probe', arguments: {} })
    expect(result.isError).toBe(false)
  })
})

describe('config validation fails loud', () => {
  it('rejects mounting with both ceilings disabled', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await expect(ctx.plugin(RunBudget, {})).rejects.toThrow(/at least one/)
  })

  it('rejects negative or fractional ceilings', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await expect(ctx.plugin(RunBudget, { maxTotalTokens: -1 })).rejects.toThrow(/maxTotalTokens/)
    const ctx2 = new Context()
    await mountAgentLoopTestDependencies(ctx2)
    await expect(ctx2.plugin(RunBudget, { maxWallMs: 1.5 })).rejects.toThrow(/maxWallMs/)
  })
})
