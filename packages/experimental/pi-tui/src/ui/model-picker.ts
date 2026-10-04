/**
 * Model selection: catalog listing and picker overlay.
 *
 * Uses the same surface as the official web/grok clients — `ctx.llm`
 * catalog read + `installModelSelection` apply (the apply call lives in
 * ChatScreen, which owns the one-per-agent selection ref).
 */
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { TUI } from '@earendil-works/pi-tui'
import { pickFromListWithSearch, type ListPickItem } from './overlays.js'

export interface ModelRoute {
  provider: string
  model: string
  /** Advertised context window in tokens, when the catalog discloses one. */
  contextWindow?: number
}

/** Minimal LlmRuntime surface we consume. */
export interface LlmRuntimeLike {
  listProviders(): readonly { id: string }[]
  listModels(provider: string): Promise<readonly LlmModelInfo[]>
}

/** Compact token-count form for picker descriptions (1000000 → 1M). */
function shortTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

/**
 * Flatten the full provider catalog into provider/model routes, enriching
 * context windows from the shared custom-provider profiles: the catalog
 * itself does not carry sizes, but every /provider registration does.
 */
export async function listAllModels(
  llm: LlmRuntimeLike,
  profileContexts?: ReadonlyMap<string, number>,
): Promise<ModelRoute[]> {
  const providers = llm.listProviders()
  const lists = await Promise.all(
    providers.map(provider => llm.listModels(provider.id).catch(() => [])),
  )
  return lists.flat().map((info) => {
    const contextWindow = profileContexts?.get(`${info.provider}/${info.id}`)
    return {
      provider: info.provider,
      model: info.id,
      ...(contextWindow === undefined ? {} : { contextWindow }),
    }
  })
}

function toItem(route: ModelRoute, current: ModelRoute | undefined, index: number): ListPickItem {
  const isCurrent =
    current !== undefined && current.provider === route.provider && current.model === route.model
  const context = route.contextWindow === undefined ? '' : ` · ctx ${shortTokens(route.contextWindow)}`
  return {
    value: `${route.provider}\u0000${route.model}`,
    label: `${isCurrent ? '✓ ' : '  '}${route.model}${route.model !== route.provider ? ` (${route.provider})` : ''}`,
    description: isCurrent ? `active · #${index}${context}` : `#${index}${context}`,
  }
}

export function parseRoute(value: string): ModelRoute | undefined {
  const separator = value.indexOf('\u0000')
  if (separator === -1) return undefined
  return { provider: value.slice(0, separator), model: value.slice(separator + 1) }
}

/** Picker overlay over the model catalog; resolves undefined on Esc. */
export async function pickModel(
  tui: TUI,
  llm: LlmRuntimeLike,
  profileContexts?: ReadonlyMap<string, number>,
  current?: ModelRoute,
): Promise<ModelRoute | undefined> {
  const routes = await listAllModels(llm, profileContexts)
  if (routes.length === 0) return undefined
  const picked = await pickFromListWithSearch(tui, {
    title: 'Select model',
    ...(current !== undefined ? { body: `current: ${current.model} (${current.provider})` } : {}),
    items: routes.map((route, index) => toItem(route, current, index)),
  })
  return picked === undefined ? undefined : parseRoute(picked)
}
