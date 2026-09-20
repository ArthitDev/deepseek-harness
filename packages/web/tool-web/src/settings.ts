/** Host-owned preference for forcing web search on every user request. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live global web-search policy. */
    webSearchPolicy: WebSearchPolicyConfig
  }
}

/** Settings namespace shared with the browser row. */
export const WEB_SEARCH_POLICY_SETTINGS_NAMESPACE = 'web-search-policy'

/** Durable global web-search preference. */
export interface WebSearchPolicySettings {
  /** Require web_search before every answer. */
  always: boolean
}

export const WEB_SEARCH_POLICY_SETTINGS_SCHEMA: z<WebSearchPolicySettings> = z.object({
  always: z.boolean().default(false),
})

/** Optional deployment default beneath the user setting. */
export interface Config {
  always?: boolean
}

/** Own the global setting read by every preset-scoped tool-web instance. */
export class WebSearchPolicyConfig extends Service {
  static Config: z<Config> = z.object({ always: z.boolean().default(false) })

  private source: () => WebSearchPolicySettings

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'webSearchPolicy')
    const entry = { always: config.always ?? false }
    this.source = () => entry
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(
        ctx,
        WEB_SEARCH_POLICY_SETTINGS_NAMESPACE,
        WEB_SEARCH_POLICY_SETTINGS_SCHEMA,
        entry,
        {
          setSource: (source) => { this.source = source },
          onChange: () => {},
        },
      )
    })
  }

  /**
   * Read the setting at request time so changes apply without a restart.
   * @returns the current global web-search policy.
   */
  current(): WebSearchPolicySettings {
    return { ...this.source() }
  }
}

export const name = 'tool-web-settings'
export default WebSearchPolicyConfig
