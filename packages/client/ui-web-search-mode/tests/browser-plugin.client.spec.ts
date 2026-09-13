import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { WebSearchModeControl } from '../src/client/WebSearchModeControl.tsx'
import type { WebSearchModeInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-web-search-mode' as SessionId

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.input.webSearch': { kind: 'single', scope: 'session' } },
  } as never, () => null)
  const execute = vi.fn((_sessionId: SessionId, _line: string) =>
    Promise.resolve({ ok: true, value: { commandId: 'c1', result: { kind: 'success' as const } } }))
  const commandsRemote = { execute }
  ctx.provide('remote', { commands: commandsRemote })
  ctx.provide('remote.commands', commandsRemote)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots, execute }
}

describe('ui-web-search-mode browser apply', () => {
  it('declares services and keeps the node half empty', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers the control, executes both modes, and unregisters', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.webSearch')[0]!
    expect(entry.component).toBe(WebSearchModeControl)
    const injected = (entry.inject as unknown as (id: SessionId) => WebSearchModeInjected)(SID)

    await expect(injected.setAlways(true)).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/web-search always', [])
    await expect(injected.setAlways(false)).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/web-search auto', [])

    b.execute.mockResolvedValueOnce({
      ok: false,
      error: new RemoteError('session/not-found', 'gone', { sessionId: SID }),
    } as never)
    await expect(injected.setAlways(true)).resolves.toBe('gone (session/not-found)')
    b.execute.mockResolvedValueOnce({ ok: true, value: undefined } as never)
    await expect(injected.setAlways(true)).resolves.toBe('unknown command: /web-search always')

    await fiber.dispose()
    expect(b.slots.entries('conversation.input.webSearch')).toHaveLength(0)
  })

  it('waits for the conversation seat', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('remote', { commands: {} })
    ctx.provide('remote.commands', {})
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.webSearch')).toHaveLength(0)
    ctx.slots.register({
      name: 'root', children: { 'conversation.input.webSearch': { kind: 'single', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.input.webSearch')).toHaveLength(1)
  })
})
