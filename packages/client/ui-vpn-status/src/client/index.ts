/** Additive Host VPN status presentation over the shared resource cache. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-vpn-status/remote'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { VpnStatusBar } from './VpnStatusBar.tsx'
import { en, zh, ja, es, fr, de, ru, pt } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap { 'vpn-status': Extract<Awaited<ReturnType<TypertClientRemote['vpnStatus']['read']>>, { ok: true }>['value'] }
}

/** Client services required by this status contribution. */
export const inject = ['slots', 'locale', 'resources', 'remote', 'remote.vpnStatus']

/** Register the status resource and its frame contribution for this plugin's lifetime.
 * @param ctx - Client plugin owner.
 */
export function apply(ctx: Context): void {
  const remote = ctx.remote.vpnStatus
  ctx.effect(() => ctx.locale.register('vpn.status', { en, zh, ja, es, fr, de, ru, pt }))
  ctx.effect(() => ctx.resources.register({
    protocol: 'vpn-status',
    async *open(_address, { signal }) {
      while (!signal.aborted) {
        try { yield await remote.read(signal) } catch (error) {
          // A disconnected transport must remove verified presentation immediately on the next read.
          void error
          yield { ok: true, value: { state: 'unknown', evidence: null, checkedAt: null, validUntil: null } }
        }
        await new Promise<void>((resolve) => {
          const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
          const timer = setTimeout(finish, 15000)
          signal.addEventListener('abort', finish, { once: true })
          if (signal.aborted) finish()
        })
      }
    },
  }))
  ctx.slots.inject('shell.status', () => ctx.slots.register({
    name: 'shell.status', id: 'vpn', locale: 'vpn.status',
  }, VpnStatusBar))
}
