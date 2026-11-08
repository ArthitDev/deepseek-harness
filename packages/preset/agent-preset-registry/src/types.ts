/** Client-safe payloads and event declarations owned by the agent-preset domain. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Whether a preset's declaring row ships with the deployment or was authored in the active profile. */
export type PresetTrust = 'system' | 'user'

/**
 * One declared preset as a client reads it.
 */
export interface AgentPresetRow {
  /** Stable identifier; also the label's fallback. */
  readonly id: string
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean
  /** Whether the active profile's patch declares this preset (authorable) or the deployment ships it. */
  readonly trust: PresetTrust
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /** Why this preset cannot compose a session; absent when it can. */
  readonly broken?: string
}

/** One model route offered for a preset binding. */
export interface AgentPresetModelRow {
  /** Provider route and `models` settings-map key. */
  readonly provider: string
  /** Provider display name. */
  readonly providerName: string
  /** Provider-owned model id and `models` settings-map key. */
  readonly id: string
  /** Model display name. */
  readonly name: string
}

/** The roster one deployment currently supplies, with its authoring capability. */
export interface AgentPresetRoster {
  /** Every current declaration, including activation failures. */
  readonly presets: readonly AgentPresetRow[]
  /** Whether the active profile accepts authored preset declarations. */
  readonly authorable: boolean
  /** Whether visible mode selection is enabled for sessions that name no preset. */
  readonly modeSelectionEnabled: boolean
  /** Every model the live providers currently advertise. */
  readonly models: readonly AgentPresetModelRow[]
  /** User-selected preset ids by provider and model; absent routes use the default preset. */
  readonly modelPresets: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** Model a new session uses before it selects another one. */
  readonly defaultModel?: { readonly provider: string; readonly model: string }
}

/** One preset's declared composition, rendered for reading. */
export interface AgentPresetDocument {
  /** The preset the composition belongs to. */
  readonly agentPreset: string
  /** Whether the active profile's patch declares this preset (editable) or the deployment ships it. */
  readonly trust: PresetTrust
  /** The declared child plugin list as entry-list YAML, `!!js` expressions included. */
  readonly content: string
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No declaration supplies the requested identity. */
    'agent-preset/not-found': { readonly agentPreset: string; readonly available: readonly string[] }
    /** The id is unusable, already taken, or its composition cannot be installed. */
    'agent-preset/invalid': { readonly agentPreset: string; readonly reason: string }
    /** The preset ships with the deployment and is not the profile's to change. */
    'agent-preset/read-only': { readonly agentPreset: string; readonly reason: string }
    /** The session's conversation has started, so its composition is fixed. */
    'agent-preset/locked': { readonly sessionId: SessionId; readonly agentPreset: string }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Preset the Session runs, or null when the deployment composes none. */
    agentPreset: string | null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One session committed a different agent preset to its durable log.
     * Consumers invalidate only state derived from that session's composition.
     * @mode emit
     * @param sessionId - the session whose composition changed.
     * @param agentPreset - the preset recorded by the committed selection.
     */
    'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
  }
}

export {}
