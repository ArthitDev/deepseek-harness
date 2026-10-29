import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { createDeveloperMessage, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let ctx: Context
let dir: string
let wiki: string

class Recorder extends LlmAdapter {
  requests: GenerateOptions[] = []
  overflow = false
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    if (this.overflow) {
      this.overflow = false
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'context overflow', code: 'CONTEXT_WINDOW_EXCEEDED' } } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answer' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class ShortCompaction extends BasicCompactionEngine {
  override async summarize() {
    return { summary: [{ type: 'text' as const, text: 'retained conversation' }], provider: 'mock', model: 'mock' }
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-wiki-context-'))
  wiki = join(dir, 'wiki')
  await mkdir(wiki)
  await writeFile(join(wiki, 'INDEX.md'), 'PRIVATE_WIKI_CONTENT')
  ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { personaPrefix: 'PRESET_SENTINEL' } })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(AgentLoop, { agents: [] })
})

afterEach(async () => {
  await ctx.fiber.dispose()
  expect(dirname(resolve(dir))).toBe(resolve(tmpdir()))
  await rm(dir, { recursive: true, force: true })
})

const mountWiki = () => ctx.plugin(ToolFsSearch, {
  sampleOverCapGlobResults: false, knowledgeOnly: true, knowledgeRoots: [{ name: 'cyber', path: wiki }],
})
const notices = (agent: Agent) => agent.session.deriveMessages().filter(message => message.role === 'user' && message.source.kind === 'knowledge-context')
const send = async (agent: Agent, text = 'user task'): Promise<void> => {
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
  await agent.whenIdle()
}
const recorder = (): Recorder => {
  const adapter = new Recorder()
  ctx.llm.registerAdapter(['mock'], adapter)
  return adapter
}

describe('Wiki context lifecycle', () => {
  it('restores the notice once after a real manual compaction and keeps preset text unchanged', async () => {
    await mountWiki()
    const adapter = recorder()
    await ctx.plugin(TokenMeter)
    const compact = new ShortCompaction(ctx, { auto: false })
    const agent = await ctx.agentLoop.create(SessionId('compact-wiki'), { provider: 'mock', model: 'mock' })
    const preset = renderPrompt(await ctx.systemPrompt.assemble({ agent, scope: agent }))
    await send(agent, 'previous question '.repeat(100))
    expect(notices(agent)).toHaveLength(1)
    expect(await compact.compactNow(agent, new AbortController().signal)).not.toBeNull()
    expect(notices(agent)).toHaveLength(0)
    await send(agent, 'continue')
    await send(agent, 'continue again')
    expect(notices(agent)).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'knowledge-context')).toHaveLength(2)
    expect(adapter.requests.at(-1)?.messages.find(message => message.role === 'system')?.content).toEqual([{ type: 'text', text: preset }])
    expect(JSON.stringify(adapter.requests)).not.toContain('PRIVATE_WIKI_CONTENT')
  })

  it.each([false, true])('restores a notice on overflow retry with compactor mounted first=%s', async (compactorFirst) => {
    if (!compactorFirst) await mountWiki()
    const adapter = recorder()
    const agent = await ctx.agentLoop.create(SessionId('retry-wiki'), { provider: 'mock', model: 'mock' })
    // The compactor owns replacement; the retry waterfall sees the resulting active history.
    ctx.on('agent/request-error', async ({ agent: current }, next) => {
      await next()
      for (const seq of [...current.session.surface.nodes]) {
        const event = current.session.snapshotEvents().find(item => item.seq === seq)
        if (event?.type !== 'user/message' || event.data.source.kind !== 'knowledge-context') continue
        current.session.append('developer/message', {
          turn: 1, step: 1, message: createDeveloperMessage({ content: [], source: { kind: 'session-edit' } }),
        }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
      }
      return { kind: 'retry' }
    })
    if (compactorFirst) await mountWiki()
    adapter.overflow = true
    await send(agent)
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[1]?.messages.filter(message => message.role === 'user' && message.source?.kind === 'knowledge-context')).toHaveLength(1)
    expect(adapter.requests[1]?.messages.some(message => message.role === 'developer')).toBe(false)
  })

  it('keeps resumed history without duplicate notices, and gives a fresh session its own notice', async () => {
    await mountWiki()
    recorder()
    const original = await ctx.agentLoop.create(SessionId('original-wiki'), { provider: 'mock', model: 'mock' })
    await send(original)
    const resumed = await ctx.agents.create({
      sessionId: SessionId('resumed-wiki'), seed: original.session.snapshotEvents(),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await send(resumed.agent)
    expect(notices(resumed.agent)).toHaveLength(1)
    expect(resumed.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'knowledge-context')).toHaveLength(1)
    const fresh = await ctx.agentLoop.create(SessionId('new-wiki'), { provider: 'mock', model: 'mock' })
    await send(fresh)
    expect(notices(fresh)).toHaveLength(1)
  })

  it('withdraws context and publishes disabled status on unload, then restores once on reload', async () => {
    const fiber = await mountWiki()
    const adapter = recorder()
    const agent = await ctx.agentLoop.create(SessionId('toggle-wiki'), { provider: 'mock', model: 'mock' })
    const statuses: unknown[] = []
    ctx.sessionProjections.onChanged((_session, key, value) => {
      if (key === 'knowledgeStatus') statuses.push(value)
    })
    await send(agent)
    await fiber.dispose()
    expect(notices(agent)).toHaveLength(0)
    expect(agent.session.snapshotEvents().findLast(event => event.type === 'developer/message')).toMatchObject({ data: { turn: 2, step: 1 } })
    expect(statuses).toContainEqual({ libraries: [] })
    await send(agent)
    expect(adapter.requests.at(-1)?.messages.some(message => message.role === 'developer')).toBe(false)
    expect(adapter.requests.at(-1)?.tools?.some(tool => tool.name === 'knowledge_list')).not.toBe(true)
    await mountWiki()
    expect(ctx.sessionProjections.snapshot(agent.session).values.knowledgeStatus).toEqual({ libraries: ['cyber'] })
    await send(agent)
    expect(notices(agent)).toHaveLength(1)
  })

  it('respects an explicit per-agent discovery restriction', async () => {
    await mountWiki()
    const adapter = recorder()
    const agent = await ctx.agentLoop.create(SessionId('denied-wiki'), { provider: 'mock', model: 'mock' })
    await send(agent)
    agent.ctx.tools.restrict({ deny: ['knowledge_list'] })
    expect(ctx.sessionProjections.snapshot(agent.session).values.knowledgeStatus).toEqual({ libraries: [] })
    await send(agent)
    expect(notices(agent)).toHaveLength(0)
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).not.toContain('CONTRIBUTING.md')
  })

  it('withdraws a saved Wiki notice when resumed with discovery disabled', async () => {
    const fiber = await mountWiki()
    const adapter = recorder()
    const original = await ctx.agentLoop.create(SessionId('before-disable'), { provider: 'mock', model: 'mock' })
    await send(original)
    const saved = original.session.snapshotEvents()
    await fiber.dispose()
    await ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: false, knowledgeOnly: true, knowledgeRoots: [] })
    const resumed = await ctx.agents.create({
      sessionId: SessionId('after-disable'), seed: saved, agentOptions: { provider: 'mock', model: 'mock' },
    })
    await send(resumed.agent)
    expect(notices(resumed.agent)).toHaveLength(0)
    expect(ctx.sessionProjections.snapshot(resumed.agent.session).values.knowledgeStatus).toBeUndefined()
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).not.toContain('CONTRIBUTING.md')
  })
})
