import type { Context } from '@deepseek-ai/cordis'
import { readWebProfileConfig } from './web-settings.js'

/**
 * Follow the Web suppression switch through the TUI's existing volatile policy.
 * @param ctx - TUI context with its Loader and pentest mode policy.
 */
export async function installWebPromptSettings(ctx: Context): Promise<void> {
  const loader = ctx.get('loader') as {
    resolve(id: string): {
      options: { config?: Record<string, unknown> }
      update(options: { config: Record<string, unknown> }): Promise<void>
    }
  } | undefined
  const policy = ctx.get('pentestModePolicy') as { current(): { suppressSections: boolean } } | undefined
  if (loader === undefined || policy === undefined) return
  const entry = loader.resolve('pentest-mode')
  const fallback = entry.options.config?.suppressSections ?? false
  const sync = async (): Promise<boolean> => {
    const suppressSections = readWebProfileConfig(ctx, 'pentest-mode')?.get('suppressSections') ?? fallback
    if (typeof suppressSections !== 'boolean') throw new Error('pi-tui: Web suppressSections must be a boolean')
    if (suppressSections === policy.current().suppressSections) return false
    await entry.update({ config: { ...entry.options.config, suppressSections } })
    return true
  }
  await sync()
  const refreshing = new WeakSet<object>()
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    if (refreshing.has(context) || !await sync()) return next()
    // The assembly waterfall runs after section selection; rebuild once when the switch changes.
    refreshing.add(context)
    try { return await ctx.systemPrompt.assemble(context) }
    finally { refreshing.delete(context) }
  })
}
