import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, RequestMessage, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-compaction'

export const name = 'compaction-glm-auto-observer'

type Observation = {
  phase: 'baseline'
  pressureTokens: number
  contextWindow: number
  reservedTokens: number
} | {
  phase: 'automatic'
  pressureTokens: number
  thresholdTokens: number
  contextWindow: number
  reservedTokens: number
  aboveThreshold: boolean
} | {
  phase: 'compaction-llm'
  selectedMessageCount: number
  roleTail: string[]
  lastInstructionRole: string | null
  lastInstructionHasDirective: boolean
  selectedTailIsNeutralUser: boolean
  inputCheckIds: Record<string, boolean>
  inputCheckMethods: Record<string, boolean>
  inputOutputFingerprints: Record<string, boolean>
  inputJobIdPresent: boolean
  inputJobFields: Record<string, boolean>
  outputHeadings: Record<string, boolean>
  outputIsExactNeutralAck: boolean
  outputCharacters: number
  outputTextBlocks: number
  finishCategory: string
}

interface PressureReading {
  pressureTokens: number
  thresholdTokens: number
  contextWindow: number
  reservedTokens: number
}

export function apply(ctx: Context): void {
  const measurements = new WeakMap<Agent, PressureReading>()
  const evidencePath = join(process.cwd(), '.auto-compaction-observations.jsonl')

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    const isBaseline = messages.some(message => textOf(message).includes('AUTO_THRESHOLD_BASELINE'))
    const isResume = messages.some(message => textOf(message).includes('RESUME_AFTER_AUTO_COMPACTION'))
    if (!isBaseline && !isResume) return next()

    const reading = await readPressure(ctx, agent, signal)
    if (isBaseline) measurements.set(agent, reading)
    if (isResume) {
      await record(evidencePath, {
        phase: 'automatic',
        ...reading,
        aboveThreshold: reading.pressureTokens >= reading.thresholdTokens,
      })
    }
    const decision = await next()
    if (isResume) {
      const after = await readPressure(ctx, agent, signal)
      await record(evidencePath, {
        phase: 'automatic',
        ...after,
        aboveThreshold: after.pressureTokens >= after.thresholdTokens,
      })
    }
    return decision
  }, { prepend: true })

  ctx.on('agent/turn-stopping', async ({ agent }) => {
    const reading = measurements.get(agent)
    if (reading === undefined) return
    const events = agent.session.snapshotEvents()
    const baselineSeen = events.some(event => event.type === 'user/message'
      && eventText(event).includes('AUTO_THRESHOLD_BASELINE'))
    if (!baselineSeen) return
    await record(evidencePath, {
      phase: 'baseline',
      pressureTokens: ctx.tokenMeter.measure(agent.session).totalTokens,
      contextWindow: reading.contextWindow,
      reservedTokens: reading.reservedTokens,
    })
    measurements.delete(agent)
  })

  ctx.on('llm/stream', (options, next) => {
    if (options.purpose !== 'compaction') return next()
    return observeCompactionStream(options, next, evidencePath)
  })
}

export const inject = ['compaction', 'llm', 'tokenMeter']

async function readPressure(
  ctx: Context,
  agent: Agent,
  signal?: AbortSignal,
): Promise<PressureReading> {
  const route = agent.session.requestHeader()?.config
  if (route === undefined || route.provider.length === 0 || route.model.length === 0) {
    throw new Error('automatic compaction observer found no durable model route')
  }
  const info = await ctx.llm.resolveModelInfo(route.provider, route.model, signal)
  const contextWindow = info.context?.contextWindow
  if (contextWindow === undefined) throw new Error('automatic compaction observer found no model capacity')
  const thresholdRatio = Number(process.env.DSH_AUTO_THRESHOLD_RATIO)
  if (!Number.isFinite(thresholdRatio) || thresholdRatio <= 0 || thresholdRatio > 1) {
    throw new Error('automatic compaction observer found no test threshold ratio')
  }
  const reservedTokens = route.maxTokens ?? info.defaultMaxTokens ?? 0
  const thresholdTokens = Math.floor(Math.min(
    contextWindow * thresholdRatio,
    contextWindow - reservedTokens,
  ))
  return {
    pressureTokens: ctx.tokenMeter.measure(agent.session).totalTokens,
    thresholdTokens,
    contextWindow,
    reservedTokens,
  }
}

async function record(path: string, observation: Observation): Promise<void> {
  await appendFile(path, `${JSON.stringify(observation)}\n`)
}

function observeCompactionStream(
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>,
  evidencePath: string,
): AsyncIterable<StreamChunk> {
  return (async function* (): AsyncGenerator<StreamChunk> {
    const selected = options.messages.slice(0, -1)
    const selectedText = selected.map(textOfRequestMessage).join('\n')
    const lastInstruction = options.messages.at(-1)
    const instructionText = lastInstruction === undefined ? '' : textOfRequestMessage(lastInstruction)
    const checkIds = ['CHK-1042', 'CHK-1043', 'CHK-1044']
    const checkMethods = [
      'compare local SHA-256 with release manifest',
      'GET /health and require status 200',
      'run migration dry-run and capture exit code',
    ]
    const fingerprints = ['4f20a1', '503']
    const jobFields = {
      id: 'SIM-JOB-17',
      reported_status: 'running',
      last_observed_status: 'unknown',
      completion: 'unknown',
      results: 'unknown',
      output_location: 'unknown',
      check_method: 'consult simulator report; no real job exists',
      evidence: 'simulated',
      note: 'synthetic report only; no production job was started',
    }
    const headings = [
      'Primary Request and Intent', 'Key Technical Concepts', 'Files and Code',
      'Errors and Fixes', 'Pending Jobs', 'Current Work', 'Next Step', 'Critical Context',
    ]
    const roleTail = options.messages.slice(-4).map(message => message.role)
    const tailMessage = selected.at(-1)
    const outputByIndex = new Map<number, string>()
    const textDeltaIndexes = new Set<number>()
    let textBlockCount = 0
    let finishCategory = 'missing'
    for await (const chunk of next()) {
      if (chunk.type === 'block-start' && chunk.blockType === 'text') textBlockCount += 1
      if (chunk.type === 'text-delta') {
        textDeltaIndexes.add(chunk.index)
        outputByIndex.set(chunk.index, (outputByIndex.get(chunk.index) ?? '') + chunk.text)
      }
      if (chunk.type === 'block-end' && chunk.block.type === 'text' && !textDeltaIndexes.has(chunk.index)) {
        outputByIndex.set(chunk.index, chunk.block.text)
      }
      if (chunk.type === 'finish') finishCategory = chunk.reason.kind
      yield chunk
    }
    const outputText = [...outputByIndex.values()].join('')
    await record(evidencePath, {
      phase: 'compaction-llm',
      selectedMessageCount: selected.length,
      roleTail,
      lastInstructionRole: lastInstruction?.role ?? null,
      lastInstructionHasDirective: instructionText.includes('Create a structured checkpoint from the conversation above')
        && headings.every(heading => instructionText.includes(`## ${heading}`)),
      selectedTailIsNeutralUser: tailMessage?.role === 'user'
        && textOfRequestMessage(tailMessage).includes('AUTO_THRESHOLD_BASELINE'),
      inputCheckIds: Object.fromEntries(checkIds.map(id => [id, selectedText.includes(id)])),
      inputCheckMethods: Object.fromEntries(checkMethods.map((method, index) => [checkIds[index]!, selectedText.includes(method)])),
      inputOutputFingerprints: Object.fromEntries(fingerprints.map(fingerprint => [fingerprint, selectedText.includes(fingerprint)])),
      inputJobIdPresent: selectedText.includes(jobFields.id),
      inputJobFields: Object.fromEntries(Object.entries(jobFields).map(([field, value]) => [field, selectedText.includes(value)])),
      outputHeadings: Object.fromEntries(headings.map(heading => [heading, outputText.includes(`## ${heading}`)])),
      outputIsExactNeutralAck: outputText.trim() === 'BASELINE_ACK',
      outputCharacters: outputText.length,
      outputTextBlocks: textBlockCount,
      finishCategory,
    })
  })()
}

function textOfRequestMessage(message: RequestMessage): string {
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function textOf(message: UserMessage): string {
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function eventText(event: { data: unknown }): string {
  const payload = event.data
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return ''
  const data = payload as Record<string, unknown>
  const message = data.message ?? data
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return ''
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return ''
  return content.flatMap((block) => {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) return []
    const text = (block as Record<string, unknown>).text
    return typeof text === 'string' ? [text] : []
  }).join('\n')
}
