import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-tool-web/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { WebSearchModeControl } from './WebSearchModeControl.tsx'
import { en, zh, type WebSearchModeKey } from './locales.ts'

export type { WebSearchModeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Composer Web search mode copy. */
    webSearchMode: WebSearchModeKey
  }
}

const NS = 'webSearchMode'

/** Values injected into the Web search mode control. */
export interface WebSearchModeInjected {
  /** Select required or automatic web search. */
  setAlways: (always: boolean) => Promise<string | null>
}

export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/** Register the Web search mode control beside the permission selector. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-web-search-mode: dictionaries')
  ctx.slots.inject('conversation.input.webSearch', () => ctx.slots.register({
    name: 'conversation.input.webSearch',
    locale: NS,
    inject: (sessionId: SessionId): WebSearchModeInjected => ({
      setAlways: async (always) => {
        const line = `/web-search ${always ? 'always' : 'auto'}`
        const result = await ctx.remote.commands.execute(sessionId, line, [])
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return `unknown command: ${line}`
        return null
      },
    }),
  }, WebSearchModeControl))
}
