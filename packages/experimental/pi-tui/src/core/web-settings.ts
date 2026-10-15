import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { isMap, isSeq, parseDocument, type YAMLMap } from 'yaml'
import type { AgentDefaultModelService } from './services.js'

/**
 * Read TUI model defaults, using the Web effort for an otherwise unspecified matching route.
 * Explicit TUI model and effort defaults retain precedence.
 * @param ctx - context with the default-model service and shared profile home.
 * @returns the selected defaults, or undefined when neither profile supplies them.
 */
export function defaultModelSelection(ctx: Context): ReturnType<AgentDefaultModelService['currentSelection']> | undefined {
  const defaults = (ctx.get('agentDefaultModel') as AgentDefaultModelService | undefined)?.currentSelection()
  const config = readWebProfileConfig(ctx, 'agent-default-model')
  if (config === undefined) return defaults
  const provider = defaults?.provider ?? config.get('provider')
  const model = defaults?.model ?? config.get('model')
  if (typeof provider !== 'string' || provider.trim() === '' || typeof model !== 'string' || model.trim() === '') {
    throw new Error('pi-tui: Web model defaults must contain a provider and model')
  }
  const effort = defaults?.reasoningEffort ?? (provider === config.get('provider') && model === config.get('model')
    ? config.get('reasoningEffort') : undefined)
  if (effort !== undefined && (typeof effort !== 'string' || effort.trim() === '')) {
    throw new Error('pi-tui: Web reasoning effort must be a non-empty string')
  }
  return { provider, model, ...effort === undefined ? {} : { reasoningEffort: effort } }
}

/**
 * Read one saved Web profile override without evaluating executable YAML tags.
 * @param ctx - context with the shared profile home.
 * @param id - plugin row whose config to read.
 * @returns the saved config, or undefined when the file or row is absent.
 */
export function readWebProfileConfig(ctx: Context, id: string): YAMLMap | undefined {
  return readProfileConfig(ctx, id, 'web')
}

/**
 * Read a saved profile override without evaluating executable YAML tags.
 * @param ctx - context with the shared profile home and current patch path.
 * @param id - plugin row whose config to read.
 * @param profileName - named profile; omitted selects the current TUI profile.
 * @returns the saved config, or undefined when the file or row is absent.
 */
export function readProfileConfig(ctx: Context, id: string, profileName?: string): YAMLMap | undefined {
  const profile = ctx.get('profileContext') as { home: string; name?: string; patchPath?: string } | undefined
  if (profile === undefined) return undefined
  const path = profileName === undefined
    ? profile.patchPath ?? join(profile.home, 'profiles', profile.name ?? 'tui', 'cordis.patch.yml')
    : join(profile.home, 'profiles', profileName, 'cordis.patch.yml')
  let source: string
  try { source = readFileSync(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  const document = parseDocument(source, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  })
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error(`pi-tui: ${path} must contain a patch sequence`)
  const index = document.contents.items.findLastIndex((item, index) =>
    isMap(item) && document.getIn([index, 'id']) === id)
  if (index < 0) return undefined
  const config = document.getIn([index, 'config'], true)
  if (!isMap(config)) throw new Error(`pi-tui: ${id} config in ${path} must be a mapping`)
  return config
}
