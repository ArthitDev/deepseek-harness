import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
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

function expectLastTurnError(handle: AgentHandle, expected: string): void {
  const turnEnd = handle.agent.session.snapshotEvents().findLast((event): event is SessionEvent<'turn/end'> => (
    event.type === 'turn/end'
  ))
  if (turnEnd?.data.reason.kind !== 'error') throw new Error('expected the latest Web turn to fail')
  expect(turnEnd.data.reason.error.message).toBe(expected)
}

describe('Web prompt integrity lifecycle', () => {
  let scaffold: WebScaffold
  let handle: AgentHandle
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
  })

  afterAll(async () => {
    const failures: unknown[] = []
    if (!handleDisposed) await handle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (stateRoot !== undefined) await rm(stateRoot, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Web prompt integrity cleanup failed')
  })

  it('switches preset, rejects invalid and empty required core before dispatch, recovers, then resumes', async () => {
    const send = async (requestId: string): Promise<void> => {
      await scaffold.ctx.sessionController.prompt({
        requestId: requestId as SessionRequestId,
        sessionId: SESSION_ID,
        mode: 'queue',
        content: [{ type: 'text', text: `prompt integrity ${requestId}` }],
      }, new AbortController().signal)
      const agent = scaffold.ctx.agents.get(SESSION_ID)
      if (agent === undefined) throw new Error('session controller did not resolve the prompt Agent')
      await agent.whenIdle()
      await scaffold.ctx.sessions.flush(agent.session)
    }

    await send('prompt-one')
    if (adapter.requests[0] === undefined) {
      throw new Error(`initial Web prompt made no provider request: ${JSON.stringify(handle.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1))}`)
    }
    expect(systemText(adapter.requests[0])).toContain('WEB_PROMPT_ONE')

    await writeFile(stateFile, 'WEB_PROMPT_TWO')
    expect(await scaffold.ctx.agentPresets.select(handle.agent, 'prompt-two')).toBe('prompt-two')
    await send('prompt-two')
    expect(systemText(adapter.requests[1])).toContain('WEB_PROMPT_TWO')
    expect(systemText(adapter.requests[1])).not.toBe(systemText(adapter.requests[0]))

    const wrongVersion = handle.agent.ctx.systemPrompt.section({
      name: 'tools:calling', version: '2', order: 100, text: 'invalid scoped version',
    })
    const beforeWrongVersion = adapter.requests.length
    await send('prompt-wrong-version')
    expect(adapter.requests).toHaveLength(beforeWrongVersion)
    expectLastTurnError(handle,
      'system-prompt: required section "tools:calling" has wrong version (expected "1", actual "2")')
    wrongVersion()

    await writeFile(stateFile, ' \n\t')
    const beforeBlank = adapter.requests.length
    await send('prompt-blank-core')
    expect(adapter.requests).toHaveLength(beforeBlank)
    expectLastTurnError(handle,
      'system-prompt: required section "deployment:persona-prefix" rendered empty')

    await writeFile(stateFile, 'WEB_PROMPT_RECOVERED')
    await send('prompt-recovered')
    expect(systemText(adapter.requests.at(-1))).toContain('WEB_PROMPT_RECOVERED')
    expect(adapter.requests).toHaveLength(beforeBlank + 1)

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
    expect(resumedUsers).toContain('prompt integrity prompt-two')
    expect(resumed.agent.session.snapshotEvents().some(event => event.type === 'agent-preset/selected'
      && event.data.agentPreset === 'prompt-two')).toBe(true)
    const persisted = await readPersistedEvents(scaffold, SESSION_ID)
    expect(persisted.some(event => event.type === 'agent-preset/selected' && event.data.agentPreset === 'prompt-two')).toBe(true)
    expect(persisted.filter(event => event.type === 'turn/end')).toHaveLength(6)
  }, 60_000)
})
