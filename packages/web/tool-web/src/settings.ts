/** Host-owned preference for forcing web search on every user request. */

import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
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

export const WEB_SEARCH_POLICY_SETTINGS_SCHEMA = z.object({
  always: z.boolean().default(false).volatile(),
})

/** Optional deployment default beneath the user setting. */
export interface Config {
  always: Volatile<boolean>
}

/** Own the global setting read by every preset-scoped tool-web instance. */
export class WebSearchPolicyConfig extends Service {
  static Config = WEB_SEARCH_POLICY_SETTINGS_SCHEMA

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'webSearchPolicy')
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  }

  /**
   * Read the setting at request time so changes apply without a restart.
   * @returns the current global web-search policy.
   */
  current(): WebSearchPolicySettings {
    return { always: this.config.always.get() }
  }
}

export const name = 'tool-web-settings'
export default WebSearchPolicyConfig
