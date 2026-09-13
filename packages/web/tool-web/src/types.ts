/** Client-safe types for the per-session web-search mode. */

/** Whether the agent must search before every answer. */
export interface WebSearchModeProjection {
  always: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host fold state for the web-search mode. */
    webSearchMode: WebSearchModeProjection
  }
  interface SessionProjectionMap {
    /** Browser-visible web-search mode. */
    webSearchMode: WebSearchModeProjection
  }
}
