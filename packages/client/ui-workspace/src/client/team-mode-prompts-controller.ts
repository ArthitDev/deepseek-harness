/** Staged settings form for the per-mode prompt overrides of the global team-mode policy. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsTextField,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions,
  type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Settings namespace owning the global team mode and its prompt overrides. */
export const TEAM_MODE_SETTINGS_NS = 'pentest-mode'

/** The `pentest-mode` settings document as edited on the prompts card; every field is optional so the form renders defaults. */
export interface TeamModePromptsSettings {
  mode?: string
  bluePrompt?: string
  redPrompt?: string
  blackPrompt?: string
  deadPrompt?: string
  suppressSections?: boolean
}

/** Team Mode Prompts field names in settings-form order. */
export const TEAM_MODE_PROMPT_FIELDS = ['bluePrompt', 'redPrompt', 'blackPrompt', 'deadPrompt'] as const

/** One Team Mode Prompts field name. */
export type TeamModePromptField = typeof TEAM_MODE_PROMPT_FIELDS[number]

/** Snapshot state of the team-mode prompts card: form shell plus per-field state. */
export interface TeamModePromptsCardState extends SettingsFormShell {
  fields: Record<TeamModePromptField, SettingsFieldState>
  /** Whether non-mode prompt sections are currently withheld from assembly. */
  suppress: boolean
}

/** View contract for the team-mode prompts card: snapshot hooks plus form actions. */
export interface TeamModePromptsCardFace extends SettingsFormActions {
  hooks: { teamModePromptsCard: SnapshotStore<TeamModePromptsCardState> }
  /** Flip the section-suppression switch; writes immediately, not with the staged save. */
  toggleSuppress: () => void
}

/** Connect the `pentest-mode` namespace to one staged prompts page. */
export class TeamModePromptsCardController {
  private readonly form: SettingsFormModel<TeamModePromptsSettings>
  private readonly store: SnapshotStore<TeamModePromptsCardState>

  constructor(private readonly scope: SettingsFormScope<TeamModePromptsSettings>) {
    const specOf = (field: TeamModePromptField): SettingsFieldSpec => settingsTextField(field)
    this.form = new SettingsFormModel(scope, TEAM_MODE_PROMPT_FIELDS.map(specOf))
    this.store = this.form.bind(() => this.projection())
  }

  private suppressValue(): boolean {
    const section = this.scope.getSnapshot().value as Record<string, unknown> | undefined
    return section?.suppressSections === true
  }

  private projection(): TeamModePromptsCardState {
    return {
      ...this.form.shell(),
      fields: Object.fromEntries(
        TEAM_MODE_PROMPT_FIELDS.map(field => [field, this.form.field(field)]),
      ) as Record<TeamModePromptField, SettingsFieldState>,
      suppress: this.suppressValue(),
    }
  }

  /**
   * Flip section suppression with one revision-fenced write. Unlike the prompt
   * fields this lands immediately: the switch governs assembly behavior, not
   * staged text.
   */
  async toggleSuppress(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) return
    const next = !this.suppressValue()
    await this.scope.mutate([{ op: 'set', path: ['suppressSections'], value: next }], snapshot.revision)
  }

  /** Expose the card's snapshot store and form actions to the renderer.
   * @returns The render face for the team-mode prompts card.
   */
  inject(): TeamModePromptsCardFace {
    return {
      hooks: { teamModePromptsCard: this.store },
      toggleSuppress: () => { void this.toggleSuppress() },
      ...this.form.actions(),
    }
  }

  /** Release the underlying settings form model and its snapshot store. */
  dispose(): void { this.form.dispose() }
}
