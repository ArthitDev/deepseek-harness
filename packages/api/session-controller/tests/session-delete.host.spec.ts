/** Deletion releases idle API writers without stopping active or externally owned work. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionTestController } from './test-remote.ts'

const contexts: Context[] = []
const roots: string[] = []
const signal = (): AbortSignal => new AbortController().signal

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-delete-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
  const forget = vi.fn(() => Promise.resolve())
  ctx.provide('workspaceRegistry', { archivedSessionIds: [], forgetSession: forget, list: () => [] } as never)
  const controller = await createSessionTestController(ctx, {
    cwd: root, defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture' }),
  })
  await mountAgentLoopTestHarness(ctx)
  return { ctx, root, controller, forget }
}

describe('session.delete writer lifecycle', () => {
  it('deletes an API-created idle Agent after releasing its real JSONL writer', async () => {
    const { ctx, root, controller, forget } = await harness()
    const { sessionId } = await controller.create({ cwd: root })
    const agent = ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('created Agent missing')
    agent.session.append('session/title', { title: 'stored idle session', messageSeqs: [], source: { kind: 'fallback' } })
    expect(ctx.agents.get(sessionId)?.status).toBe('idle')
    const result = await controller.delete({ sessionId }, signal())
    expect({ result, live: ctx.agents.get(sessionId) !== undefined,
      stored: await ctx.sessionPersistence.stat(sessionId) !== undefined }).toMatchInlineSnapshot(`
      {
        "live": false,
        "result": {
          "deleted": true,
        },
        "stored": false,
      }
    `)
    expect(forget).toHaveBeenCalledWith(sessionId)
  })

  it('rejects a running turn, then deletes after Stop settles to idle', async () => {
    const { ctx, root, controller, forget } = await harness()
    const entered = Promise.withResolvers<undefined>()
    ctx.on('agent/pre-step', async ({ signal: turnSignal }, next) => {
      entered.resolve(undefined)
      await new Promise<void>((resolve) => {
        if (turnSignal.aborted) resolve()
        else turnSignal.addEventListener('abort', () => { resolve() }, { once: true })
      })
      turnSignal.throwIfAborted()
      return next()
    })
    const { sessionId } = await controller.create({ cwd: root })
    const agent = ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('created Agent missing')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'wait for Stop' }], source: { kind: 'user' } }))
    await entered.promise
    await expect(controller.delete({ sessionId }, signal())).rejects.toMatchObject({ code: 'session/agent-busy' })
    expect(forget).not.toHaveBeenCalled()
    controller.cancel({ sessionId })
    await agent.whenIdle()
    expect(ctx.agents.get(sessionId)).toBe(agent)
    await expect(controller.delete({ sessionId }, signal())).resolves.toEqual({ deleted: true })
    expect(await ctx.sessionPersistence.stat(sessionId)).toBeUndefined()
  })

  it('retains a resumed writer handle for deletion', async () => {
    const { ctx, root, controller } = await harness()
    const sessionId = SessionId('delete-resumed')
    const session = ctx.sessions.prepare(sessionId, { meta: { cwd: root } })
    const writer = await ctx.sessionPersistence.create(session.header)
    await writer.flush()
    await writer.close()
    const resolved = await controller.resolveAgent(sessionId)
    if ('error' in resolved) throw resolved.error
    expect(ctx.agents.get(sessionId)).toBeDefined()
    await expect(controller.delete({ sessionId }, signal())).resolves.toEqual({ deleted: true })
  })

  it('retains a forked writer handle without deleting its source', async () => {
    const { ctx, root, controller } = await harness()
    const { sessionId } = await controller.create({ cwd: root })
    const agent = ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('created Agent missing')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const child = await controller.fork({ sessionId })
    await expect(controller.delete(child, signal())).resolves.toEqual({ deleted: true })
    expect(ctx.agents.get(sessionId)).toBe(agent)
    expect(await ctx.sessionPersistence.stat(sessionId)).toBeDefined()
  })

  it('does not dispose an idle Agent owned outside the API', async () => {
    const { ctx, root, controller, forget } = await harness()
    const handle = await ctx.agents.create({ sessionId: SessionId('foreign-owner'), meta: { cwd: root } })
    await expect(controller.delete({ sessionId: handle.agent.id }, signal())).rejects.toMatchObject({ code: 'session/agent-busy' })
    expect(ctx.agents.get(handle.agent.id)).toBe(handle.agent)
    expect(forget).not.toHaveBeenCalled()
    await handle.dispose()
  })

  it('waits for deletion before admitting a concurrent resume', async () => {
    const { ctx, root, controller } = await harness()
    const closing = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const create = ctx.agents.create.bind(ctx.agents)
    vi.spyOn(ctx.agents, 'create').mockImplementation(async (request) => {
      const handle = await create(request)
      return { agent: handle.agent, dispose: async () => {
        closing.resolve(undefined)
        await release.promise
        await handle.dispose()
      } }
    })
    const { sessionId } = await controller.create({ cwd: root })
    const agent = ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('created Agent missing')
    agent.session.append('session/title', { title: 'delete race', messageSeqs: [], source: { kind: 'fallback' } })
    const deletion = controller.delete({ sessionId }, signal())
    await closing.promise
    let settled = false
    const resume = controller.resolveAgent(sessionId).then((result) => { settled = true; return result })
    await Promise.resolve()
    expect(settled).toBe(false)
    release.resolve(undefined)
    await expect(deletion).resolves.toEqual({ deleted: true })
    await expect(resume).resolves.toMatchObject({ error: { code: 'session/not-found' } })
    expect(ctx.agents.get(sessionId)).toBeUndefined()
  })

  it('rejects an unchanged model selection when deletion wins during validation', async () => {
    const { ctx, root, controller } = await harness()
    const { sessionId } = await controller.create({ cwd: root })
    const agent = ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('created Agent missing')
    const selected = { provider: 'fixture', model: 'fixture' }
    agent.model.select(selected)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.llm, 'listProviders').mockReturnValue([{ id: 'fixture', name: 'Fixture' }])
    vi.spyOn(ctx.llm, 'listModels').mockResolvedValue([{ provider: 'fixture', id: 'fixture', name: 'Fixture' }])
    vi.spyOn(ctx.llm, 'resolveCallConfig').mockImplementation(async () => {
      entered.resolve(undefined)
      await release.promise
      return selected
    })
    const save = vi.spyOn(ctx.agentDefaultModel, 'saveSelection')
    const selection = controller.selectModel({ sessionId, ...selected }).then(
      value => ({ value }), (error: unknown) => ({ error }),
    )
    try {
      await Promise.race([entered.promise, selection.then(() => { throw new Error('selection settled before validation') })])
      await expect(controller.delete({ sessionId }, signal())).resolves.toEqual({ deleted: true })
    } finally {
      release.resolve(undefined)
    }
    expect(await selection).toMatchObject({ error: { code: 'session/not-found' } })
    expect(save).not.toHaveBeenCalled()
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(await ctx.sessionPersistence.stat(sessionId)).toBeUndefined()
  })

  it('retains history while another activity provider reports work', async () => {
    const { ctx, root, controller, forget } = await harness()
    const { sessionId } = await controller.create({ cwd: root })
    ctx.on('workspace/session-activity', async (_request, next) => [{ kind: 'turn' }, ...await next()])
    await expect(controller.delete({ sessionId }, signal())).rejects.toMatchObject({ code: 'session/agent-busy' })
    expect(ctx.agents.get(sessionId)).toBeDefined()
    expect(await ctx.sessionPersistence.stat(sessionId)).toBeDefined()
    expect(forget).not.toHaveBeenCalled()
  })

  it('stops before deleting or changing workspace membership if disposal fails', async () => {
    const { ctx, root, controller, forget } = await harness()
    const create = ctx.agents.create.bind(ctx.agents)
    vi.spyOn(ctx.agents, 'create').mockImplementation(async (request) => {
      const handle = await create(request)
      return { agent: handle.agent, dispose: () => Promise.reject(new Error('writer close failed')) }
    })
    const { sessionId } = await controller.create({ cwd: root })
    await expect(controller.delete({ sessionId }, signal())).rejects.toThrow('writer close failed')
    expect(forget).not.toHaveBeenCalled()
    expect(await ctx.sessionPersistence.stat(sessionId)).toBeDefined()
  })

  it('does not dispose an Agent for an already cancelled deletion', async () => {
    const { ctx, root, controller, forget } = await harness()
    const { sessionId } = await controller.create({ cwd: root })
    const abort = new AbortController()
    abort.abort()
    await expect(controller.delete({ sessionId }, abort.signal)).rejects.toThrow()
    expect(ctx.agents.get(sessionId)).toBeDefined()
    expect(forget).not.toHaveBeenCalled()
  })
})
