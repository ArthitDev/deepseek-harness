import { isAgentLoopRequest, type GenerateOptions, type Message } from '@deepseek-ai/dsh-llm'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-token-meter'
import { estimateContent, estimateMessage, estimateToolsTokens, ROLE_OVERHEAD } from '@deepseek-ai/dsh-token-meter/estimate'

/** Metadata retained for the last main-loop request in this process. */
export interface ContextCapture {
  readonly provider: string
  readonly model: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly messageCount: number
  readonly messageTokens: number
  readonly toolCount: number
  readonly toolSchemaTokens: number
  readonly usage?: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens?: number
    readonly cacheReadTokens?: number
    readonly cacheWriteTokens?: number
  }
  readonly seq: number
  readonly generation: number
  readonly categories: Readonly<Record<'system' | 'agentInstructions' | 'runtimeContext' | 'checkpoint' | 'toolResults' | 'history', { readonly count: number; readonly tokens: number }>>
}

/** Current request pressure and queued input estimates for one live session. */
export interface ContextSnapshot {
  readonly lastRequest?: ContextCapture
  readonly currentTokens?: number
  readonly contextWindow?: number
  readonly currentBaseline?: 'none' | 'estimated' | 'usage'
  readonly currentSurfaceTokens?: number
  readonly currentSurfaceDelta?: number
  readonly currentBaselineTokens?: number
  readonly configuredSections?: readonly { readonly name: string; readonly version: string }[]
  readonly nextStep: { readonly count: number; readonly tokens: number }
  readonly nextTurn: { readonly count: number; readonly tokens: number }
}

function isDurableMessage(message: GenerateOptions['messages'][number]): message is Message {
  return 'id' in message && typeof message.id === 'string'
}

const captures = new WeakMap<Session, ContextCapture>()
const generations = new WeakMap<Session, number>()
const installed = new WeakSet<Context>()

/** Observe main loop requests while retaining numeric metadata only.
 * @param ctx - Context that owns the global request observer and its cleanup effect.
 */
export function installContextCapture(ctx: Context): void {
  if (installed.has(ctx)) return
  installed.add(ctx)
  const dispose = ctx.on('llm/stream', async function* (options, next) {
    if (!isAgentLoopRequest(options) || options.sessionId === undefined) {
      yield* next()
      return
    }
    const session = ctx.get('sessions')?.get(options.sessionId)
    if (session === undefined) {
      yield* next()
      return
    }
    const categorize = (
      message: GenerateOptions['messages'][number],
    ): 'system' | 'agentInstructions' | 'runtimeContext' | 'checkpoint' | 'toolResults' | 'history' => {
      if (message.role === 'system') return 'system'
      if (message.role === 'tool') return 'toolResults'
      const sourceKind = message.role === 'user' && 'source' in message ? message.source.kind : undefined
      const extendedKind: string | undefined = sourceKind
      if (extendedKind === 'agent-instructions') return 'agentInstructions'
      if (extendedKind === 'runtime-context') return 'runtimeContext'
      if (extendedKind === 'compact-checkpoint') return 'checkpoint'
      return 'history'
    }
    const estimate = (message: GenerateOptions['messages'][number]) => isDurableMessage(message)
      ? estimateMessage(message)
      : estimateContent(message.content) + ROLE_OVERHEAD
    const categories = {
      system: { count: 0, tokens: 0 },
      agentInstructions: { count: 0, tokens: 0 },
      runtimeContext: { count: 0, tokens: 0 },
      checkpoint: { count: 0, tokens: 0 },
      toolResults: { count: 0, tokens: 0 },
      history: { count: 0, tokens: 0 },
    }
    for (const message of options.messages) {
      const category = categories[categorize(message)]
      const messageTokens = estimate(message)
      category.count++
      category.tokens += messageTokens
    }
    const messageTokens = Object.values(categories).reduce((sum, category) => sum + category.tokens, 0)
    const requestTools = options.tools === undefined ? 0 : estimateToolsTokens({
      config: { provider: options.provider, model: options.model },
      tools: options.tools,
    })
    const contextWindow = session.requestContext()?.contextWindow
    const nextGeneration = (generations.get(session) ?? 0) + 1
    generations.set(session, nextGeneration)
    const capture: ContextCapture = {
      provider: options.provider,
      model: options.model,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
      messageCount: options.messages.length,
      messageTokens,
      toolCount: options.tools?.length ?? 0,
      toolSchemaTokens: requestTools,
      seq: session.seq,
      generation: nextGeneration,
      categories,
    }
    captures.set(session, capture)
    for await (const chunk of next()) {
      if (chunk.type === 'usage') {
        if (captures.get(session)?.generation === capture.generation) {
          captures.set(session, {
            ...capture,
            usage: {
              inputTokens: chunk.usage.inputTokens,
              outputTokens: chunk.usage.outputTokens,
              ...(chunk.usage.totalTokens === undefined ? {} : { totalTokens: chunk.usage.totalTokens }),
              ...(chunk.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: chunk.usage.cacheReadTokens }),
              ...(chunk.usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: chunk.usage.cacheWriteTokens }),
            },
          })
        }
      }
      yield chunk
    }
  }, { global: true, prepend: true })
  ctx.effect(() => () => {
    installed.delete(ctx)
    dispose()
  })
}

/** Read the process-local capture and fresh session/inbox estimates.
 * @param ctx - Context that supplies the token meter and active prompt-section configuration.
 * @param session - Session used for its latest request capture, current measurements, and context window.
 * @param inbox - Queue whose next-step and next-turn messages are estimated.
 * @returns The latest request capture, current session measurements, and separate queued-message estimates.
 */
export function readContextSnapshot(ctx: Context, session: Session, inbox: {
  readonly nextStep: readonly GenerateOptions['messages'][number][]
  readonly nextTurn: readonly GenerateOptions['messages'][number][]
}): ContextSnapshot {
  const meter = ctx.get('tokenMeter')
  const estimate = (messages: readonly GenerateOptions['messages'][number][]) => ({
    count: messages.length,
    tokens: messages.reduce((sum, message) => sum + (isDurableMessage(message)
      ? estimateMessage(message)
      : estimateContent(message.content) + ROLE_OVERHEAD), 0),
  })
  const lastRequest = captures.get(session)
  const contextWindow = session.requestContext()?.contextWindow
  const measurement = meter?.measure(session)
  const loader = ctx.get('loader') as {
    entries(): IterableIterator<{
      options: { id?: string; config?: Record<string, unknown> }
      fiber?: { state: FiberState }
    }>
  } | undefined
  let configuredSections: readonly { name: string; version: string }[] | undefined
  if (loader !== undefined) {
    const entry = [...loader.entries()].find(candidate => candidate.options.id === 'system-prompt' && candidate.fiber?.state === FiberState.ACTIVE)
    if (entry !== undefined) {
      const values = entry.options.config?.requiredSections
      configuredSections = values !== undefined && values !== null && typeof values === 'object' && !Array.isArray(values)
        ? Object.entries(values).flatMap(([name, version]) => typeof version === 'string' ? [{ name, version }] : [])
        : []
    }
  }
  return {
    ...(lastRequest === undefined ? {} : { lastRequest }),
    ...(measurement === undefined ? {} : {
      currentTokens: measurement.totalTokens,
      currentBaseline: measurement.baseline.kind,
      currentSurfaceTokens: measurement.surfaceTokens,
      currentSurfaceDelta: measurement.surfaceDeltaTokens,
      currentBaselineTokens: measurement.baseline.tokens,
    }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(configuredSections === undefined ? {} : { configuredSections }),
    nextStep: estimate(inbox.nextStep),
    nextTurn: estimate(inbox.nextTurn),
  }
}
