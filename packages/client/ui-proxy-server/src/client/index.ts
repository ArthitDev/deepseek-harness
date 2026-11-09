/** Proxy Server settings page over generated Host methods and the shared resource cache. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import '@deepseek-ai/dsh-proxy-server/remote'
import type { ProxyServerRow } from '@deepseek-ai/dsh-proxy-server/types'
import { ProxyServerSection, type ProxyServerInjected } from './ProxyServerSection.tsx'
import { en, zh, type ProxySettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Embedded proxy management copy. */
    proxyServers: ProxySettingsKey
  }
  interface ResourceProtocolMap {
    /** Secret-free embedded proxy roster. */
    'proxy-servers': ProxyServerRow[]
  }
}

/** Host methods, shared resources and Settings registration services. */
export const inject = ['slots', 'locale', 'remote', 'remote.proxyServers', 'resources', 'configForms']

/** Register the operator section; reading it never starts a proxy.
 * @param ctx Browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('proxyServers', { en, zh, ja: en, es: en, fr: en, de: en, ru: en, pt: en }), 'proxy-server: dictionaries')
  const preferences = ctx.configForms.get<Record<string, boolean>>('proxy-servers')
  ctx.effect(() => ctx.resources.register<'proxy-servers'>({
    protocol: 'proxy-servers', async *open() { yield await ctx.remote.proxyServers.list() },
  }), 'proxy-server: roster resource')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'proxy-server', order: 25, locale: 'proxyServers',
    label: () => ctx.locale.bind('proxyServers')('nav'),
    inject: (): ProxyServerInjected => ({
      hooks: { preferences },
      setEnabled: async (id, enabled) => {
        const response = await ctx.remote.proxyServers.setEnabled(id, enabled)
        if (!response.ok) throw new Error(response.error.message)
      },
    }),
  }, ProxyServerSection))
}
