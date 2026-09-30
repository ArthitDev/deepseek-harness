/**
 * The session header's agent-preset switcher.
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  IconAgentPresetOutlineRegular, IconChevronDownOutlineRegular, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the header actions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText } from './locales.ts'
import css from './AgentPresetLabel.module.css'

/** Registration-side business face for the header label. */
export interface AgentPresetLabelInjected {
  hooks: {
    /** Roster snapshot bound by the renderer as useAgentPresets. */
    agentPresets: SnapshotStore<AgentPresetSettingsState>
  }
  /** Read the roster, so the label can show a name rather than an id. */
  load: () => Promise<void>
  /** Recompose one idle session under another preset. */
  select: (sessionId: SessionId, presetId: string) => Promise<string | undefined>
}

/** Full component props. */
export type AgentPresetLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetLabelInjected>

/**
 * Render this session's agent-preset name beside its title.
 * @param props - composed slot props.
 * @returns the label, or null when the session records no preset.
 */
export function AgentPresetLabel({
  sessionId, useSessions, useAgentPresets, load, select, t,
}: AgentPresetLabelProps) {
  const preset = useSessions((state) => {
    const value = state.byId[sessionId]?.projectionValues?.agentPreset
    return typeof value === 'string' ? value : undefined
  })
  const roster = useAgentPresets(state => state)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Deployments that compose no presets never label anything, so the roster
    // is only worth a request once a session reports one.
    if (preset !== undefined) void load()
  }, [preset, load])

  if (preset === undefined) return null

  const option = roster.options.find(entry => entry.id === preset)
  const text = option === undefined ? undefined : presetDisplayText(option, t)
  if (!roster.modeSelectionEnabled || roster.options.length === 0) {
    return (
      <span className={css.label} title={text?.description ?? t('headerHint')}>
        <IconAgentPresetOutlineRegular size={14} className={css.icon} />
        {text?.name ?? preset}
      </span>
    )
  }
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={roster.options.map(entry => ({
        id: entry.id,
        label: presetDisplayText(entry, t).name,
      }))}
      selectedId={preset}
      onSelect={(id) => {
        setOpen(false)
        setBusy(true)
        setError(null)
        void select(sessionId, id).then(
          (refusal) => {
            setBusy(false)
            setError(refusal ?? null)
          },
          (cause: unknown) => {
            setBusy(false)
            setError(cause instanceof Error ? cause.message : String(cause))
          },
        )
      }}
      align="start"
      portal
      anchor={(
        <button
          type="button"
          className={`${css.label} ${css.button}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={busy}
          title={error ?? text?.description ?? t('headerHint')}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconAgentPresetOutlineRegular size={14} className={css.icon} />
          <span className={css.text}>{text?.name ?? preset}</span>
          <IconChevronDownOutlineRegular size={12} className={css.chevron} />
        </button>
      )}
    />
  )
}
