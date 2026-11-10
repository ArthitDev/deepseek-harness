/** Preset changes between real turns preserve the Session and affect the next request. */
import Include from '@deepseek-ai/cordis-plugin-include'
import { createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, onTestFinished, vi } from 'vitest'
import { agentOn, contribution, declare, harness } from './harness.ts'

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly inHistory = false) { super() }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, ...this.inHistory ? { systemPromptUpdate: 'in-history' } as const : {} })
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const text = 'retained answer'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it.each([false, true])('changes an idle conversation in place and retains history (system updates in history: %s)', async (inHistory) => {
  const ctx = await harness()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: './mid-session.yml' } })
  await ctx.loader.await()
  const adapter = new RecordingAdapter(inHistory)
  ctx.llm.registerAdapter(['mock'], adapter)
  const errors: unknown[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(error) })
  const handle = await ctx.agents.create({
    sessionId: SessionId('mid-session'), agentOptions: { provider: 'mock', model: 'mock' },
    meta: { agentPreset: 'standard' }, setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'standard') },
  })
  const agent = handle.agent
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'retained question' }] }))
  await agent.whenIdle()
  expect(errors).toEqual([])
  expect(adapter.requests).toHaveLength(1)
  const before = agent.session.snapshotEvents()
  const messages = agent.session.deriveMessages()
  await expect(ctx.agentPresets.select(agent, 'reviewing')).resolves.toBe('reviewing')
  expect(agent.id).toBe(SessionId('mid-session'))
  expect(agent.session.snapshotEvents().slice(0, before.length)).toEqual(before)
  expect(agent.session.deriveMessages()).toEqual(messages)
  expect(ctx.agentPresets.presetForSession(agent.session)).toBe('reviewing')
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'continue reviewing' }] }))
  await agent.whenIdle()
  expect(errors).toEqual([])
  expect(adapter.requests).toHaveLength(2)
  const request = adapter.requests[1]!
  expect(request.tools?.map(tool => tool.name)).toEqual(['reviewing'])
  const text = JSON.stringify(request.messages)
  expect(text).toContain('section for reviewing')
  if (!inHistory) expect(text).not.toContain('section for standard')
  expect(JSON.stringify(request.messages.filter(message => message.role === 'system').at(-1))).toContain('section for reviewing')
  expect(text).toContain('retained question')
  expect(text).toContain('retained answer')
  expect(request.messages.map(message => ({ role: message.role, content: message.content })))
    .toMatchSnapshot('next request after a preset change')
  const selected = agent.session.snapshotEvents()
  await expect(ctx.agentPresets.select(agent, 'absent')).rejects.toMatchObject({ code: 'agent-preset/not-found' })
  expect(agent.session.snapshotEvents()).toEqual(selected)
  expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('reviewing')
})

it.each([false, true])('holds new turns until preset acquisition settles (cancelled: %s)', async (cancelled) => {
  const ctx = await harness()
  onTestFinished(() => ctx.fiber.dispose())
  await declare(ctx, contribution('standard'))
  const agent = await agentOn(ctx, 'maintenance')
  agent.model.select({ provider: 'mock', model: 'mock' })
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const gate = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  ctx.loader.builtins.delayed = { async apply() { entered.resolve(undefined); await gate.promise } }
  const declaring = ctx.agentPresets.register({ id: 'delayed', plugins: [{ name: 'cordis:delayed' }] })
  onTestFinished(async () => { gate.resolve(undefined); await declaring })
  await entered.promise
  const maintenance = vi.spyOn(agent, 'runMaintenance')
  const selection = ctx.agentPresets.select(agent, 'delayed')
  const outcome = cancelled ? expect(selection).rejects.toBeDefined() : expect(selection).resolves.toBe('delayed')
  await vi.waitFor(() => { expect(maintenance).toHaveBeenCalledOnce() })
  const before = agent.session.snapshotEvents()
  if (cancelled) agent.cancel({ kind: 'user' })
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'queued behind selection' }] }))
  expect(ctx.agents.turnBoundaryOf(agent.session).openTurnStartSeq).toBeNull()
  expect(adapter.requests).toHaveLength(0)
  gate.resolve(undefined)
  await outcome
  await declaring
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(agent.session.snapshotEvents().slice(0, before.length)).toEqual(before)
  expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe(cancelled ? 'standard' : 'delayed')
  expect(adapter.requests[0]!.tools?.map(tool => tool.name)).toEqual(cancelled ? ['standard'] : undefined)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'agent-preset/selected'))
    .toHaveLength(cancelled ? 0 : 1)
})
