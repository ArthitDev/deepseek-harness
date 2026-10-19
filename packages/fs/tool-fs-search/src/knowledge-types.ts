/**
 * Wiki availability and model-context metadata shared with browser consumers.
 * @module @deepseek-ai/dsh-tool-fs-search/knowledge-types
 */
import type {} from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Library names currently exposed to this session; an empty list means disabled. */
export interface KnowledgeStatus {
  readonly libraries: readonly string[]
}

/** Identifies the short Wiki usage notice without inspecting conversation text. */
export interface KnowledgeContextSource {
  readonly kind: 'knowledge-context'
  readonly form: 'instructions'
  /** Hash of the configured library paths and this version of the guidance. */
  readonly digest: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** @persistenceAttribution */
    'knowledge-context': KnowledgeContextSource
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Current Wiki availability for UI readers, without note contents or model input.
     * @param data - Whole current library-name list; empty when discovery is unavailable.
     */
    'knowledge/status': KnowledgeStatus
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    knowledgeStatus: KnowledgeStatus
  }
  interface SessionProjectionMap {
    /** Current Wiki discovery availability, independent of prompt suppression. */
    knowledgeStatus: KnowledgeStatus
  }
}
