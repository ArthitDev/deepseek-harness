import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { LlmAdapter, createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-token-meter-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-token-meter', TokenMeter],
    ['@deepseek-ai/dsh-compaction-tool-result-pruner', ToolResultPruner],
    ['@deepseek-ai/dsh-compaction-basic', BasicCompactionEngine],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads bounded output recovery from YAML and records its follow-up', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-token-meter'",
      "- name: '@deepseek-ai/dsh-compaction-basic'",
      '  config:',
      '    maxOutputContinuations: 1',
    ])
    await loaded.plugin(SystemPrompt)
    await loaded.plugin(ToolRuntime)
    await loaded.plugin(AgentRegistry)
    await loaded.plugin(AgentLoop, { agents: [] })
    let calls = 0
    class CappedAdapter extends LlmAdapter {
      override async * stream(): AsyncIterable<StreamChunk> {
        calls += 1
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      }
    }
    loaded.llm.registerAdapter(['mock'], new CappedAdapter())
    const agent = await loaded.agentLoop.create(SessionId('loader-output-cap'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(calls).toBe(2)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end')).toHaveLength(2)
    expect(agent.session.deriveMessages().some(message =>
      message.source.kind === 'output-limit-continuation')).toBe(true)
  })

  it('keeps the original surface when the Loader auto-hook receives an acknowledgement', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-token-meter'",
      "- name: '@deepseek-ai/dsh-compaction-basic'",
      '  config:',
      '    thresholdRatio: 0.8',
      '    headroomTokens: 0',
      '    retainTokens: 0',
      '    maxTokens: 8',
      '    auto: true',
    ])
    await loaded.plugin(SystemPrompt)
    await loaded.plugin(ToolRuntime)
    await loaded.plugin(AgentRegistry)
    await loaded.plugin(AgentLoop, { agents: [] })
    const calls: GenerateOptions[] = []
    class AcknowledgingAdapter extends LlmAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        return Promise.resolve({
          provider,
          id: model,
          name: model,
          context: { contextWindow: 256 },
        })
      }

      override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        calls.push(options)
        const isCompaction = options.purpose === 'compaction'
        const text = isCompaction ? 'BASELINE_ACK' : 'turn response'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    loaded.llm.registerAdapter(['mock'], new AcknowledgingAdapter())
    const seed = Session.create(SessionId('loader-ack-seed'))
    for (let turn = 1; turn <= 2; turn += 1) {
      seed.append('turn/start', { turn })
      seed.append('user/message', createUserMessage({
        content: [{ type: 'text', text: `seed request ${turn} ${'long history '.repeat(200)}` }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      seed.append('step/start', { turn, step: 1 })
      if (turn === 1) {
        seed.append('request/header', {
          header: { config: { provider: 'mock', model: 'mock' } },
          reason: 'initial',
        })
      }
      seed.append('assistant/message', {
        stream: [],
        turn,
        step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: `seed answer ${turn} ${'detail '.repeat(200)}` }],
          source: { kind: 'model', provider: 'mock', model: 'mock' },
        }),
      }, { surfaceOp: 'append' })
      seed.append('step/end', { turn, step: 1 })
      seed.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    const { agent } = await loaded.agentLoop.createAgent(loaded, {
      sessionId: SessionId('loader-ack-compaction'),
      seed: seed.snapshotEvents(),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const originalSurface = [...agent.session.surface.nodes]
    const originalMessages = agent.session.deriveMessages()
    const request = 'continue after compaction failure'
    agent.followup(createUserMessage({ content: [{ type: 'text', text: request }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(calls.map(call => call.purpose)).toContain('compaction')
    expect(calls.some(call => call.purpose !== 'compaction')).toBe(true)
    expect(originalSurface.every(seq => agent.session.surface.nodes.includes(seq))).toBe(true)
    expect(agent.session.deriveMessages().slice(0, originalMessages.length)).toEqual(originalMessages)
    expect(agent.session.snapshotEvents().some(event =>
      event.type === 'user/message' && isCompactCheckpointSource(event.data.source),
    )).toBe(false)
    expect(agent.session.snapshotEvents().some(event => event.type === 'compaction/summary')).toBe(false)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'compaction/end')).toHaveLength(1)
    const failedEnd = agent.session.snapshotEvents().findLast(event => event.type === 'compaction/end')
    expect(failedEnd?.type).toBe('compaction/end')
    if (failedEnd?.type === 'compaction/end') {
      expect(failedEnd.data.error).toBe('summarization produced an invalid structured checkpoint')
    }
  })

  it('loads the shipped token-meter, pruning, and compaction-basic YAML order', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-token-meter'",
      "- name: '@deepseek-ai/dsh-compaction-tool-result-pruner'",
      '  config:',
      '    thresholdChars: 100',
      '    headChars: 20',
      '    tailChars: 10',
      "- name: '@deepseek-ai/dsh-compaction-basic'",
      '  config:',
      '    thresholdRatio: 0.5',
      '    headroomTokens: 4000',
      '    modelPolicies:',
      '      - provider: mock',
      '        model: small',
      '        headroomTokens: 0',
      '        maxTokens: 32',
      '    retainRatio: 0.125',
      '    auto: false',
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(loaded.get('toolResultPruner')).toBeInstanceOf(ToolResultPruner)
    expect(loaded.get('compaction')).toBeInstanceOf(BasicCompactionEngine)
    expect((loaded.compaction as BasicCompactionEngine).config).toMatchObject({
      thresholdRatio: 0.5,
      headroomTokens: 4000,
      modelPolicies: [{ provider: 'mock', model: 'small', headroomTokens: 0, maxTokens: 32 }],
      retainRatio: 0.125,
      auto: false,
    })
  })

  it('rejects stale token-meter config after Schemastery normalization', async () => {
    context = new Context()
    await context.plugin(SessionProjectionRegistry)
    await expect(context.plugin(TokenMeter, {
      contextWindow: 4096,
    } as never)).rejects.toThrow(/TokenMeterConfig: unknown key "contextWindow"/)
  })

  it('rejects stale compaction-basic config after Schemastery normalization', async () => {
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(SessionStore)
    await context.plugin(SessionProjectionRegistry)
    await context.plugin(TokenMeter)
    await expect(context.plugin(BasicCompactionEngine, {
      models: { legacy: { thresholdRatio: 0.5 } },
    } as never)).rejects.toThrow(/BasicCompactionConfig: unknown key "models"/)
  })

  it('rejects a capacity-independent merged ratio conflict during plugin load', async () => {
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(SessionStore)
    await context.plugin(SessionProjectionRegistry)
    await context.plugin(TokenMeter)
    await expect(context.plugin(BasicCompactionEngine, {
      retainRatio: 0.2,
      modelPolicies: [{
        provider: 'test-provider',
        model: 'test-model',
        thresholdRatio: 0.1,
      }],
    })).rejects.toThrow(/modelPolicies\[0\]: retainRatio \(0.2\).*thresholdRatio \(0.1\)/)
  })

  it('rejects an incomplete model-policy summarization pair during plugin load', async () => {
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(SessionStore)
    await context.plugin(SessionProjectionRegistry)
    await context.plugin(TokenMeter)
    await expect(context.plugin(BasicCompactionEngine, {
      summarizationProvider: 'default-provider',
      summarizationModel: 'default-model',
      modelPolicies: [{
        provider: 'test-provider',
        model: 'test-model',
        summarizationModel: '',
      }],
    })).rejects.toThrow(/modelPolicies\[0\].*must be set together/)
  })
})
