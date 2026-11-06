import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { WebSearchPolicySettings } from '@deepseek-ai/dsh-tool-web/settings'
import { WebSearchModeControl } from '../src/client/WebSearchModeControl.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  const settings = stubConfigForm<WebSearchPolicySettings>()
  const get = vi.fn(() => settings.scope)
  ctx.provide('configForms', { get })
  ctx.provide('remote', {})
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots, settings, get }
}

describe('ui-web-search-mode browser apply', () => {
  it('declares services and keeps the node half empty', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'configForms'])
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers a General Settings row and writes the global preference', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(b.get).toHaveBeenCalledWith('web-search-policy')
    const entry = b.slots.entries('settings.general.item')[0]!
    expect(entry.component).toBe(WebSearchModeControl)
    // The registry stores the factory loosely typed; this row's contract is the
    // plugin's own WebSearchModeInjected, asserted structurally here.
    const injected = entry.inject!() as {
      hooks: { webSearchMode: unknown }
      setAlways: (always: boolean) => Promise<void>
    }
    expect(injected.hooks.webSearchMode).toBe(b.settings.scope)
    await injected.setAlways(true)
    expect(b.settings.set).toHaveBeenCalledWith('always', true)

    await fiber.dispose()
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
  })
})
