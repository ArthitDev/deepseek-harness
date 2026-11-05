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

/** One selectable model: a provider/model pair with display metadata. */
export interface ModelRoute {
  provider: string
  model: string
  /** Catalog labels used by Web; ids remain the selection and search keys. */
  name?: string
  providerName?: string
  /** Advertised context window in tokens, when the catalog discloses one. */
  contextWindow?: number
}

/** Minimal LlmRuntime surface we consume. */
export interface LlmRuntimeLike {
  listProviders(): readonly { id: string; name?: string }[]
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
 * @param llm - Runtime surface read for providers and their models.
 * @param profileContexts - Optional `provider/model` → context-window token counts from custom-provider profiles.
 * @returns One route per catalog model; providers whose listing rejects contribute none.
 */
export async function listAllModels(
  llm: LlmRuntimeLike,
  profileContexts?: ReadonlyMap<string, number>,
): Promise<ModelRoute[]> {
  const providers = llm.listProviders()
  const lists = await Promise.all(
    providers.map(provider => llm.listModels(provider.id).catch(() => [])),
  )
  return lists.flatMap((models, index) => models.map((info) => {
    const contextWindow = profileContexts?.get(`${info.provider}/${info.id}`)
    return {
      provider: info.provider,
      model: info.id,
      name: info.name,
      providerName: providers[index]?.name ?? info.provider,
      ...(contextWindow === undefined ? {} : { contextWindow }),
    }
  }))
}

function toItem(route: ModelRoute, current: ModelRoute | undefined, index: number): ListPickItem {
  const isCurrent =
    current !== undefined && current.provider === route.provider && current.model === route.model
  const context = route.contextWindow === undefined ? '' : ` · ctx ${shortTokens(route.contextWindow)}`
  const name = route.name ?? route.model
  const providerName = route.providerName ?? route.provider
  return {
    value: `${route.provider}\u0000${route.model}`,
    label: `${isCurrent ? '✓ ' : '  '}${name} (${providerName})`,
    description: `${isCurrent ? 'active · ' : ''}#${index} · ${route.provider}/${route.model}${context}`,
    searchText: `${name} ${providerName} ${route.provider}/${route.model}`,
  }
}

/**
 * Split a picked `provider\u0000model` value back into its route.
 * @param value - Picker item value of the form `provider<NUL>model`.
 * @returns The route, or undefined when the value carries no separator.
 */
export function parseRoute(value: string): ModelRoute | undefined {
  const separator = value.indexOf('\u0000')
  if (separator === -1) return undefined
  return { provider: value.slice(0, separator), model: value.slice(separator + 1) }
}

/**
 * Picker overlay over the model catalog; resolves undefined on Esc.
 * @param tui - Terminal UI hosting the overlay.
 * @param llm - Runtime surface read for the catalog.
 * @param profileContexts - Optional `provider/model` → context-window map for descriptions.
 * @param current - Route to mark as active, when one is set.
 * @returns The picked route, or undefined on Esc or when the catalog is empty.
 */
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
