import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { WebSearchPolicySettings } from '@deepseek-ai/dsh-tool-web/settings'
import { WebSearchModeControl } from './WebSearchModeControl.tsx'
import { en, zh, type WebSearchModeKey } from './locales.ts'

export type { WebSearchModeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Global Web search policy copy. */
    webSearchMode: WebSearchModeKey
  }
}

const NS = 'webSearchMode'
const SETTINGS_NAMESPACE = 'web-search-policy'

/** Values injected into the General Settings row. */
export interface WebSearchModeInjected {
  hooks: {
    webSearchMode: ObservableSnapshot<SettingsScopeSnapshot<WebSearchPolicySettings>>
  }
  /** Persist the global always-search preference. */
  setAlways: (always: boolean) => Promise<void>
}

export const inject = ['slots', 'locale', 'remote', 'settingsScope']

/** Register the global always-search toggle in General Settings. */
export function apply(ctx: ClientContext): void {
  const settings = ctx.settingsScope.bind<WebSearchPolicySettings>({ namespace: SETTINGS_NAMESPACE })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-web-search-mode: dictionaries')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'web-search-mode',
    order: 13,
    locale: NS,
    inject: (): WebSearchModeInjected => ({
      hooks: { webSearchMode: settings },
      setAlways: always => settings.set('always', always),
    }),
  }, WebSearchModeControl))
}
