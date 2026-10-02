/** Structural face shared by the composed preset roster and the legacy declarative registry. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'

/**
 * The preset-service members session controllers consume. Both the composed
 * roster (`agentPresets`) and the legacy declarative registry
 * (`agentPresetRegistry`) satisfy this face, so a controller reads whichever
 * service its composition mounts.
 */
export interface PresetServiceFace {
  /** Resolve the preset id bound to one provider/model route. */
  presetIdForModel(provider: string, model: string): string
  /** Resolve one preset definition by id, or the default when omitted. */
  resolve(id?: string): Promise<{ id: string }>
  /** The deployment's default preset id. */
  readonly defaultId: string
  /** Switch a live Agent's preset while its session is blank. */
  select(agent: Agent, agentPreset: string): Promise<string>
  /** Mount the preset's standing composition into one Agent scope. */
  mount(agentCtx: Context, id?: string): Promise<unknown>
  /** The scoped service instance one live Agent joined through its preset. */
  serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined
  /** Lease the standing scope of one preset id for cold reads. */
  acquireScope(id?: string): Promise<{ key: ScopeKey } & AsyncDisposable>
}

/** Read whichever preset service the composition mounts, preferring the composed roster.
 * @param ctx - the host context whose composition provides one of the preset services.
 * @returns the mounted preset service face, or undefined when the composition mounts none.
 */
export function presetServiceOf(ctx: Context): PresetServiceFace | undefined {
  return (ctx.get('agentPresets') as PresetServiceFace | undefined)
    ?? (ctx.get('agentPresetRegistry') as PresetServiceFace | undefined)
}
