import { type Context, FiberState } from '@deepseek-ai/cordis'
// Type-only: pulls the loader's `loader/volatile-update` event augmentation
// into this program for the re-lock listener below.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-compaction-basic'
import type {} from '@deepseek-ai/dsh-pentest-executor'
import { readProfileConfig, readWebProfileConfig } from './web-settings.js'
import { TEAM_MODE_OPTIONS } from './team-mode.js'

/**
 * Install the TUI's web-profile prompt settings: validate the saved team
 * settings against the active pentest-mode plugin entry, require intact
 * system prompts for model requests, and mount the synchronous re-lock
 * listener that refreshes the policy when the profile changes.
 * @param ctx - TUI context carrying the Loader and the pentest mode policy.
 * @throws when the Loader or the pentest mode policy is missing, or the
 * active pentest-mode entry cannot be found.
 */
export function installWebPromptSettings(ctx: Context): void {
  const loader = ctx.get('loader') as {
    entries(): IterableIterator<{
      options: { id?: string; config?: Record<string, unknown> }
      fiber?: { state: FiberState }
      update(options: { config: Record<string, unknown> }): Promise<void>
    }>
  } | undefined
  const policy = ctx.get('pentestModePolicy') as
    | { current(): Record<string, unknown> & { suppressSections: boolean }; apply?(updates: Record<string, unknown>): void }
    | undefined
  if (loader === undefined || policy === undefined) throw new Error('pi-tui: prompt integrity requires loader and pentestModePolicy')
  const entry = [...loader.entries()].find(entry => entry.options.id === 'pentest-mode' && entry.fiber?.state === FiberState.ACTIVE)
  if (entry === undefined) throw new Error('pi-tui: active pentest-mode entry not found')
  const fallback = { ...entry.options.config }
  const syncCompute = (persist = true): boolean => {
    const local = readProfileConfig(ctx, 'pentest-mode')
    const web = readWebProfileConfig(ctx, 'pentest-mode')
    const suppressSections = local?.get('suppressSections') ?? web?.get('suppressSections') ?? fallback.suppressSections ?? false
    if (typeof suppressSections !== 'boolean') throw new Error('pi-tui: suppressSections must be a boolean')
    const mode = local?.get('mode') ?? web?.get('mode') ?? fallback.mode ?? 'red'
    if (!TEAM_MODE_OPTIONS.some(option => option.value === mode)) {
      throw new Error('pi-tui: mode must be blue, red, black, or dead')
    }
    const updates: Record<string, unknown> = { suppressSections: false, mode }
    for (const option of TEAM_MODE_OPTIONS) {
      const key = `${option.value}Prompt`
      const value = web?.get(key) ?? fallback[key]
      if (value === undefined) continue
      if (typeof value !== 'string') throw new Error(`pi-tui: ${key} must be a string`)
      updates[key] = value
    }
    const current = policy.current()
    if (Object.entries(updates).every(([key, value]) => current[key] === value)) return false
    // Same-turn visibility: the section text evaluates synchronously during
    // prompt assembly, before any async config restart settles. Apply the
    // values on the live policy now; persist through the config restart after.
    if (typeof policy.apply === 'function') policy.apply(updates)
    if (!persist) return true
    void entry.update({ config: { ...entry.options.config, ...updates } }).catch((error: unknown) => {
      ctx.logger.error(error)
    })
    return true
  }
  // Sibling scopes (the policy plugin) resolve this from the shared root.
  ctx.root.provide('promptSettingsSync', () => { syncCompute() })
  syncCompute()
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    // Saved web-profile edits land between turns; 0.2.2 has no system-prompt
    // change to key on, so each turn re-reads the profile before assembling.
    syncCompute()
    let decision = await next()
    if (decision.kind === 'reject') return decision
    // In-history updates must not retain a prior preset or team policy, including after resume.
    if (agent.session.requestContext()?.systemPromptUpdate === 'in-history'
      || (agent.session.header.parentSession !== undefined && !agent.session.header.isSeeded
        && !agent.session.deriveMessages().some(message => message.role === 'system'))) {
      decision = { ...decision, startsRequestSeries: true }
    }
    return decision
  }, { prepend: true })
  ctx.on('system-prompt/change', () => { syncCompute() })
  // Volatile config commits restart no fiber, so a raw settings write that
  // flips a locked field would otherwise hold until the next turn. Re-lock in
  // memory immediately; the next turn sync persists it. The global flag beats
  // the per-fiber event filter, and unrelated entries' commits only rerun the
  // file reads and no-op on the comparison.
  ctx.on('loader/volatile-update', () => {
    try { syncCompute(false) } catch (error: unknown) { ctx.logger.error(error) }
  }, { global: true })
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    const sections = structuredClone(assembly.sections)
    const result = await next()
    let previous = -1
    for (const section of sections) {
      const index = result.sections.findIndex(candidate => candidate.name === section.name)
      const candidate = result.sections[index]
      if (index <= previous || candidate?.text !== section.text || candidate.interpolate !== section.interpolate) {
        throw new Error(`pi-tui: system prompt integrity failed: section "${section.name}" was removed, changed, or reordered`)
      }
      previous = index
    }
    return result
  }, { prepend: true })
  ctx.on('llm/stream', (options, next) => {
    if (!isAgentLoopRequest(options) && options.purpose !== 'compaction') return next()
    const session = options.sessionId === undefined ? undefined : ctx.get('sessions')?.get(options.sessionId)
    const expected = session?.deriveMessages().filter(message => message.role === 'system')
    const actual = options.messages.filter(message => message.role === 'system')
    if (options.system !== undefined || options.messages[0]?.role !== 'system'
      || expected?.[0]?.content.some(block => block.type === 'text' && block.text.trim().length > 0) !== true
      || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('pi-tui: system prompt integrity failed: request must include the complete session system prompt')
    }
    return next()
  }, { global: true, prepend: true })
}
