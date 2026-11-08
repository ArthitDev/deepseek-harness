/** Client-safe types for the per-session web-search mode. */

/** Whether the agent must search before every answer. */
export interface WebSearchModeProjection {
  always: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable operator choice for the per-session always-search mode. */
    'web-search/mode': { always: boolean }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Browser-visible web-search mode. */
    webSearchMode: WebSearchModeProjection
  }
}
