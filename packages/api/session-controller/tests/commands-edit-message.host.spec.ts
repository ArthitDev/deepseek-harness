/** Host-side editMessage: surface replacement + followup regeneration. */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SessionCommandController } from '../src/commands.ts'
import { installSessionReadTestServices } from './test-remote.ts'

function controllerAgents(): unknown {
  return {
    ensureSession: () => Promise.resolve(),
    composeAgent: () => Promise.resolve({ setup: () => {} }),
    adoptHandle: () => {},
    presetForSession: () => undefined,
    presetForObservation: () => undefined,
    resolveAgent: (sessionId: SessionId) => Promise.resolve({ agent: { id: sessionId, status: 'idle', ctx: {} } as Agent }),
  }
}

/** One exchange: turn 1 with a user question and a completed turn closer. */
function exchange(ctx: Context, id: string, question: string): void {
  const session = ctx.sessions.create(SessionId(id), { meta: {} })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: question }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

async function harness(id: string, question: string, status: 'idle' | 'running' = 'idle'): Promise<{
  ctx: Context
  controller: SessionCommandController
  followup: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  exchange(ctx, id, question)
  const followup = vi.fn()
  const resolved = { id: SessionId(id), status, ctx } as unknown as Agent
  Object.defineProperty(resolved, 'session', { value: ctx.sessions.get(SessionId(id)) })
  resolved.followup = followup as unknown as Agent['followup']
  const agents = controllerAgents() as { resolveAgent: (id: SessionId) => Promise<{ agent: Agent }> }
  agents.resolveAgent = () => Promise.resolve({ agent: resolved })
  const controller = new SessionCommandController(ctx, agents as never, '/default')
  return { ctx, controller, followup }
}

describe('editMessage', () => {
  it('shadows the old exchange and follows up with the edited question', async () => {
    const { ctx, controller, followup } = await harness('edit-1', 'original question')
    const session = ctx.sessions.get(SessionId('edit-1'))!

    const questionSeq = session.snapshotEvents().find(event => event.type === 'user/message')!.seq
    const tailSeq = session.surface.nodes.at(-1)!
    await controller.editMessage({ sessionId: SessionId('edit-1'), seq: questionSeq, text: 'edited question' })

    const events = session.snapshotEvents()
    const replace = events.at(-1)!
    expect(replace.type).toBe('developer/message')
    expect(replace.surfaceOp).toEqual({ op: 'replace', startSeq: questionSeq, endSeq: tailSeq })
    expect(replace.sourceEventSeqs).toEqual([questionSeq])
    // The followup carries the edited text; its append happens through the
    // real loop driver, which the mock here only records.
    const followupMessage = followup.mock.calls[0]?.[0] as { content: { type: string; text: string }[] }
    expect(followupMessage.content).toContainEqual({ type: 'text', text: 'edited question' })
    expect(followup).toHaveBeenCalledOnce()
    // The surface folds the replacement: the old exchange is shadowed.
    const surface = session.surface.nodes
    expect(surface.includes(questionSeq)).toBe(false)
    expect(surface.includes(tailSeq)).toBe(false)
  })

  it('rejects a non-user-message seq, a running Agent, and blank text', async () => {
    const { ctx, controller } = await harness('edit-2', 'question')
    ctx.sessions.get(SessionId('edit-2'))!.append('assistant/message', {
      source: { model: { provider: 'mock', model: 'mock' } },
      content: [{ type: 'text', text: 'answer' }],
    } as never, { surfaceOp: 'append' })

    const assistantSeq = ctx.sessions.get(SessionId('edit-2'))!.snapshotEvents()
      .find(event => event.type === 'assistant/message')!.seq
    await expect(controller.editMessage({ sessionId: SessionId('edit-2'), seq: assistantSeq, text: 'x' }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(controller.editMessage({ sessionId: SessionId('edit-2'), seq: SessionSeq(9999), text: 'x' }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })

    const running = await harness('edit-3', 'question', 'running')
    const editedSeq = running.ctx.sessions.get(SessionId('edit-3'))!.snapshotEvents()
      .find(event => event.type === 'user/message')!.seq
    await expect(running.controller.editMessage({ sessionId: SessionId('edit-3'), seq: editedSeq, text: 'x' }))
      .rejects.toMatchObject({ code: 'session/agent-busy' })
    const blankSeq = ctx.sessions.get(SessionId('edit-2'))!.snapshotEvents()
      .find(event => event.type === 'user/message')!.seq
    await expect(controller.editMessage({ sessionId: SessionId('edit-2'), seq: blankSeq, text: '  ' }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
  })
})
