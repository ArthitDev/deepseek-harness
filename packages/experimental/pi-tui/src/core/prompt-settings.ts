import { type Context, FiberState } from '@deepseek-ai/cordis'
import { readProfileConfig, readWebProfileConfig } from './web-settings.js'
import { TEAM_MODE_OPTIONS } from './team-mode.js'

/**
 * Apply saved TUI team settings and suppression, falling back to Web, with current system prompts.
 * @param ctx - TUI context with its Loader and pentest mode policy.
 */
export async function installWebPromptSettings(ctx: Context): Promise<void> {
  const loader = ctx.get('loader') as {
    entries(): IterableIterator<{
      options: { id?: string; config?: Record<string, unknown> }
      fiber?: { state: FiberState }
      update(options: { config: Record<string, unknown> }): Promise<void>
    }>
  } | undefined
  const policy = ctx.get('pentestModePolicy') as { current(): Record<string, unknown> & { suppressSections: boolean } } | undefined
  if (loader === undefined || policy === undefined) return
  const entry = [...loader.entries()].find(entry => entry.options.id === 'pentest-mode' && entry.fiber?.state === FiberState.ACTIVE)
  if (entry === undefined) throw new Error('pi-tui: active pentest-mode entry not found')
  const fallback = { ...entry.options.config }
  const sync = async (): Promise<boolean> => {
    const local = readProfileConfig(ctx, 'pentest-mode')
    const web = readWebProfileConfig(ctx, 'pentest-mode')
    const suppressSections = local?.get('suppressSections') ?? web?.get('suppressSections') ?? fallback.suppressSections ?? false
    if (typeof suppressSections !== 'boolean') throw new Error('pi-tui: suppressSections must be a boolean')
    const mode = local?.get('mode') ?? web?.get('mode') ?? fallback.mode ?? 'red'
    if (!TEAM_MODE_OPTIONS.some(option => option.value === mode)) {
      throw new Error('pi-tui: mode must be blue, red, black, or dead')
    }
    const updates: Record<string, unknown> = { suppressSections, mode }
    for (const option of TEAM_MODE_OPTIONS) {
      const key = `${option.value}Prompt`
      const value = web?.get(key) ?? fallback[key]
      if (value === undefined) continue
      if (typeof value !== 'string') throw new Error(`pi-tui: ${key} must be a string`)
      updates[key] = value
    }
    const current = policy.current()
    if (Object.entries(updates).every(([key, value]) => current[key] === value)) return false
    await entry.update({ config: { ...entry.options.config, ...updates } })
    return true
  }
  await sync()
  ctx.on('agent/pre-step', async ({ agent }, next) => {
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
  const refreshing = new WeakSet<object>()
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    if (refreshing.has(context) || !await sync()) return next()
    // Section selection precedes this waterfall; reassemble once when settings change.
    refreshing.add(context)
    try { return await ctx.systemPrompt.assemble(context) }
    finally { refreshing.delete(context) }
  })
}
