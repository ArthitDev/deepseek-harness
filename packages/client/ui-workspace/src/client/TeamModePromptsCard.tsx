/** Team-mode prompt overrides settings page. */

// Type-only: pulls the Plugins page's SlotMap merge (the 'plugins.item' row).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm, SettingsValueField, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceKey } from './locales.ts'
import { teamModeFormLabels } from './locales.ts'
import type { TeamModePromptsCardFace, TeamModePromptField } from './team-mode-prompts-controller.ts'

export type TeamModePromptsCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'workspace'>
  & InjectFace<TeamModePromptsCardFace>

const promptFields: readonly [TeamModePromptField, WorkspaceKey, WorkspaceKey][] = [
  ['bluePrompt', 'teamMode.blue', 'teamMode.blue.hint'],
  ['redPrompt', 'teamMode.red', 'teamMode.red.hint'],
  ['blackPrompt', 'teamMode.black', 'teamMode.black.hint'],
  ['deadPrompt', 'teamMode.dead', 'teamMode.dead.hint'],
]

/** Render the staged prompt-override editor for the global team-mode policy. */
export function TeamModePromptsCard(props: TeamModePromptsCardProps) {
  const { t } = props
  const state = props.useTeamModePromptsCard(snapshot => snapshot)
  if (props.view === 'summary') return t('teamMode.description')
  const suppressRow = (
    <div className="flex items-center justify-between gap-3 py-2">
      <div>
        <div>{t('teamMode.suppress')}</div>
        <div className="opacity-70">{t('teamMode.suppress.hint')}</div>
      </div>
      <Switch
        checked={state.suppress}
        disabled={!state.writable}
        label={t('teamMode.suppress')}
        onChange={() => props.toggleSuppress()}
      />
    </div>
  )
  return (
    <>
      {suppressRow}
      <SettingsForm
        labels={teamModeFormLabels(t)}
        state={state}
        onSave={props.save}
        onDiscard={props.discard}
      >
        {promptFields.map(([name, label, hint]) => (
          <SettingsValueField
            key={name}
            id={`plugin-config-pentest-mode-${name}`}
            label={t(label)}
            hint={t(hint)}
            overriddenLabel={t('teamMode.overridden')}
            resetLabel={t('teamMode.reset')}
            invalidLabel={t('teamMode.invalidValue')}
            disabled={!state.writable}
            multiline
            {...state.fields[name]}
            onEdit={(text) => { props.edit(name, text) }}
            onReset={() => { props.resetField(name) }}
          />
        ))}
      </SettingsForm>
    </>
  )
}
