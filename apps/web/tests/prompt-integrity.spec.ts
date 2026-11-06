import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { launchWebScaffold, readPersistedEvents, type WebScaffold } from './scaffold.ts'

const PRESET_PLUGIN = fileURLToPath(new URL('./fixtures/prompt-preset.mjs', import.meta.url))
const SESSION_ID = SessionId('prompt-integrity-web-lifecycle')

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 12, outputTokens: 4 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class PromptAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  // The 0.2.2 prompt path requires the selection to be advertised by the
  // provider catalog (`modelAvailable`), so the fixture advertises its model.
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'local', name: 'local' }])
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield* textChunks('ok')
  }
}

function systemText(request: GenerateOptions | undefined): string {
  if (request === undefined) throw new Error('expected a model request')
  return request.messages.filter(message => message.role === 'system')
    .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
    .join('\n\n')
}

describe('Web prompt integrity lifecycle', () => {
  let scaffold: WebScaffold
  let handle: AgentHandle
  let handleTwo: AgentHandle | undefined
  let handleTwoDisposed = false
  let stateRoot: string
  let stateFile: string
  let adapter: PromptAdapter
  let handleDisposed = false

  beforeAll(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), 'dsh-web-prompt-integrity-'))
    stateFile = join(stateRoot, 'prompt.txt')
    await writeFile(stateFile, 'WEB_PROMPT_ONE')
    scaffold = await launchWebScaffold({
      agentPresets: {
        default: 'prompt-one',
        definitions: ['prompt-one', 'prompt-two'].map(id => ({
          id,
          name: id,
          description: 'Prompt integrity lifecycle fixture.',
          plugins: [{ name: pathToFileURL(PRESET_PLUGIN).href, config: { stateFile } }],
        })),
      },
    })
    adapter = new PromptAdapter()
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['prompt-integrity'], adapter), 'prompt integrity adapter')
    handle = await scaffold.ctx.agents.create({
      sessionId: SESSION_ID,
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'prompt-one' },
      agentOptions: { provider: 'prompt-integrity', model: 'local' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'prompt-one').then(() => undefined),
    })
    await scaffold.ctx.sessionController.create({
      sessionId: SESSION_ID,
      cwd: scaffold.workspaceCwd,
      agentPreset: 'prompt-one',
    })
    await scaffold.ctx.sessionController.selectModel({
      sessionId: SESSION_ID,
      provider: 'prompt-integrity',
      model: 'local',
    })
  }, 30_000)

  afterAll(async () => {
    const failures: unknown[] = []
    if (!handleDisposed) await handle?.dispose().catch((error: unknown) => failures.push(error))
    if (!handleTwoDisposed) await handleTwo?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (stateRoot !== undefined) await rm(stateRoot, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Web prompt integrity cleanup failed')
  }, 30_000)

  it('switches preset, applies scoped core shadowing, dispatches a blank core, recovers, then resumes', async () => {
    const send = async (requestId: string, sessionId: SessionId = SESSION_ID): Promise<void> => {
      await scaffold.ctx.sessionController.prompt({
        requestId: requestId as SessionRequestId,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: `prompt integrity ${requestId}` }],
      }, new AbortController().signal)
      const agent = scaffold.ctx.agents.get(sessionId)
      if (agent === undefined) throw new Error('session controller did not resolve the prompt Agent')
      await agent.whenIdle()
      await scaffold.ctx.sessions.flush(agent.session)
    }

    await send('prompt-one')
    if (adapter.requests[0] === undefined) {
      throw new Error(`initial Web prompt made no provider request: ${JSON.stringify(handle.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1))}`)
    }
    expect(systemText(adapter.requests[0])).toContain('WEB_PROMPT_ONE')

    // 0.2.2 locks preset selection once a Session has run its first turn, so the switch
    // leg runs on a second session whose first turn has not started yet.
    await writeFile(stateFile, 'WEB_PROMPT_TWO')
    const SESSION_TWO = SessionId('prompt-integrity-web-lifecycle-two')
    handleTwo = await scaffold.ctx.agents.create({
      sessionId: SESSION_TWO,
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'prompt-one' },
      agentOptions: { provider: 'prompt-integrity', model: 'local' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'prompt-one').then(() => undefined),
    })
    await scaffold.ctx.sessionController.create({
      sessionId: SESSION_TWO,
      cwd: scaffold.workspaceCwd,
      agentPreset: 'prompt-one',
    })
    await scaffold.ctx.sessionController.selectModel({
      sessionId: SESSION_TWO,
      provider: 'prompt-integrity',
      model: 'local',
    })
    expect(await scaffold.ctx.agentPresets.select(handleTwo.agent, 'prompt-two')).toBe('prompt-two')
    await send('prompt-two', SESSION_TWO)
    expect(systemText(adapter.requests[1])).toContain('WEB_PROMPT_TWO')
    expect(systemText(adapter.requests[1])).not.toBe(systemText(adapter.requests[0]))

    // 0.2.2 removed the v2 required-section version guard ("tools:calling" and its
    // validation no longer exist); the surviving contract is scoped shadowing, so this
    // leg pins that a scoped section shadows the same-name global and dispatch proceeds.
    const shadowedIdentity = handle.agent.ctx.systemPrompt.section({
      name: 'harness:identity',
      order: handle.agent.ctx.systemPrompt.getSectionOrder('HARNESS_IDENTITY'),
      text: 'scoped shadow identity',
    })
    const beforeShadow = adapter.requests.length
    await send('prompt-shadowed-identity')
    expect(adapter.requests).toHaveLength(beforeShadow + 1)
    expect(systemText(adapter.requests.at(-1))).toContain('scoped shadow identity')
    expect(systemText(adapter.requests.at(-1))).not.toContain('Runtime host: Shield Break Harness.')
    shadowedIdentity()

    // 0.2.2 also removed the empty-required-core pre-dispatch rejection: the turn
    // dispatches with the blank persona rendered as-is, so only the request count pins it.
    await writeFile(stateFile, ' \n\t')
    const beforeBlank = adapter.requests.length
    await send('prompt-blank-core')
    expect(adapter.requests).toHaveLength(beforeBlank + 1)

    await writeFile(stateFile, 'WEB_PROMPT_RECOVERED')
    await send('prompt-recovered')
    expect(systemText(adapter.requests.at(-1))).toContain('WEB_PROMPT_RECOVERED')
    expect(adapter.requests).toHaveLength(beforeBlank + 2)

    const disposedAgent = handle.agent
    await handle.dispose()
    handleDisposed = true
    expect(scaffold.ctx.agents.get(SESSION_ID)).toBeUndefined()
    const resumed = await scaffold.ctx.sessionController.resolveAgent(SESSION_ID)
    if ('error' in resumed) throw resumed.error
    expect(resumed.agent).not.toBe(disposedAgent)
    await send('prompt-resumed')
    expect(systemText(adapter.requests.at(-1))).toContain('WEB_PROMPT_RECOVERED')
    const resumedUsers = adapter.requests.at(-1)!.messages
      .filter(message => message.role === 'user')
      .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
    expect(resumedUsers).toContain('prompt integrity prompt-one')
    expect(resumedUsers).not.toContain('prompt integrity prompt-two')
    expect(resumed.agent.session.snapshotEvents().some(event => event.type === 'agent-preset/selected'
      && event.data.agentPreset === 'prompt-two')).toBe(false)
    const persisted = await readPersistedEvents(scaffold, SESSION_ID)
    expect(persisted.filter(event => event.type === 'turn/end')).toHaveLength(5)
    const persistedTwo = await readPersistedEvents(scaffold, SESSION_TWO)
    expect(persistedTwo.some(event => event.type === 'agent-preset/selected' && event.data.agentPreset === 'prompt-two')).toBe(true)
    expect(persistedTwo.filter(event => event.type === 'turn/end')).toHaveLength(1)
    handleTwoDisposed = true
  }, 60_000)
})
