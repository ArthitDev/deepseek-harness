/**
 * The agent-preset picker on the new-session screen and in the Session header.
 *
 * The menu opens on the staged choice, which starts as the deployment default.
 * Picking changes the current idle Session or stages a choice until a blank Session appears.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconAgentPresetOutlineRegular, IconChevronDownOutlineRegular, IconWarningOutlineRegular, Menu, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the hero seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentPresetSeatState } from './seat-store.ts'
import { isBuiltInPreset, presetDisplayText } from './locales.ts'
import { requiresCodingTools, type AgentPresetPreferences } from './settings-store.ts'
import css from './AgentPresetSeat.module.css'

/** Registration-side business face for the hero chip. */
export interface AgentPresetSeatInjected {
  hooks: {
    /** Shared Developer tools preference; off hides the PTC and Minimal menu choices. */
    developerTools: ObservableSnapshot<boolean>
    /** Seat snapshot bound by the renderer as useAgentPresetSeat. */
    agentPresetSeat: SnapshotStore<AgentPresetSeatState>
    /** Shared Host-backed visibility of shipped presets. */
    presetPreferences: ObservableSnapshot<AgentPresetPreferences>
  }
  /** Read the roster when the chip first renders. */
  load: () => Promise<void>
  /** Select the current Session's preset or stage one for a new Session; resolves to a refusal, or undefined. */
  select: (id: string) => Promise<string | undefined>
  /** Acknowledge the refusal whose Toast finished. */
  dismissRefusal: (error: AgentPresetSeatState['error']) => void
  /** Clear the one-shot introduce cue once the chip has played it. */
  introduced: () => void
}

/* Introduce timeline: the icon eases in first (the CSS animation shares this
   duration); the name's characters start fading up the moment it lands, each
   taking the fade duration to settle. The cue clears after the last one. The
   stagger is capped twice: per tick for short CJK names, and by one shared
   reveal window so a long Latin name finishes in the same time as its CJK
   counterpart instead of dragging the run out per character. */
const INTRO_TEXT_DELAY_MS = 150
const INTRO_CHAR_STAGGER_MS = 40
const INTRO_TEXT_REVEAL_MS = 200
const INTRO_CHAR_FADE_MS = 400

/** Duration of a selection-refusal banner, including a revision becoming unavailable during a pick. */
const REFUSAL_HOLD_MS = 8000

/**
 * Per-character start offset for the introduce reveal.
 * @param count - character count of the shown preset name.
 * @returns milliseconds between successive character starts.
 */
function introStaggerMs(count: number): number {
  if (count <= 1) return 0
  return Math.min(INTRO_CHAR_STAGGER_MS, INTRO_TEXT_REVEAL_MS / (count - 1))
}

/** Full component props. */
export type AgentPresetSeatProps =
  (PropsRuntime<'conversation.hero.agentPreset'> | PropsRuntime<'conversation.session.header.actions'>)
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetSeatInjected>

/**
 * Render the agent-preset picker, disabled while the Session is running.
 * @param props - composed slot props.
 * @returns The chip and any pending selection refusal, or null outside the main view.
 */
export function AgentPresetSeat({
  sessionId, useSessions, useSessionRetainInfo, load, select, dismissRefusal, introduced,
  useAgentPresetSeat, useDeveloperTools, usePresetPreferences, t,
}: AgentPresetSeatProps) {
  const developerTools = useDeveloperTools(value => value)
  const showBuiltIns = usePresetPreferences(value => value.value?.showBuiltInPresets ?? true)
  const state = useAgentPresetSeat(snapshot => snapshot)
  const running = useSessions(snapshot => sessionId !== undefined && snapshot.byId[sessionId]?.running === true)
  const started = useSessions(snapshot => sessionId !== undefined && snapshot.byId[sessionId]?.blank === false)
  const main = useSessionRetainInfo(info => sessionId === undefined
    || (info?.retainedBy.mainView ?? 0) > 0)
  const [open, setOpen] = useState(false)
  // The seq keys the banner, so picking the same broken preset twice replays
  // it rather than leaving the first one silently in place.
  const toastSeq = useRef(0)
  const [toast, setToast] = useState<{ seq: number; error: Exclude<AgentPresetSeatState['error'], string | null> } | null>(null)

  useEffect(() => {
    if (state.error !== null && typeof state.error === 'object') {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, error: state.error })
    } else setToast(null)
  }, [state.error])

  useEffect(() => {
    void load()
  }, [load])

  const options = useMemo(
    () => state.options.filter(option => (showBuiltIns || !isBuiltInPreset(option))
      && (developerTools || !requiresCodingTools(option))),
    [state.options, developerTools, showBuiltIns],
  )

  useEffect(() => {
    setOpen(false)
  }, [developerTools, showBuiltIns, options.length, running])

  const chosen = state.options.find(option => option.id === state.current)
  const chosenText = chosen === undefined ? undefined : presetDisplayText(chosen, t)
  const label = chosenText?.name ?? state.current
  const ready = state.options.length > 0 && state.current !== ''

  // The introduce cue: the pick was staged from another screen (the settings
  // creator entry), so the chip announces it — the icon eases in and each
  // character of the name fades up on a stagger (CSS owns the motion; this
  // effect only arms it and acknowledges the cue once the run is over).
  const [introducing, setIntroducing] = useState(false)
  useEffect(() => {
    if (!state.introduce || !ready) return
    const characters = Array.from(label)
    if (characters.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      introduced()
      return
    }
    setIntroducing(true)
    const done = window.setTimeout(() => {
      setIntroducing(false)
      introduced()
    }, INTRO_TEXT_DELAY_MS + (characters.length - 1) * introStaggerMs(characters.length) + INTRO_CHAR_FADE_MS)
    return () => { window.clearTimeout(done) }
  }, [state.introduce, ready, label, introduced])

  // A refused initial composition still needs its Toast when there is no chip to show.
  if (!main) return null

  // One wrapper span: the chip is a flex row with a gap, so loose character
  // spans would each pick up the gap between them.
  const characters = Array.from(label)
  const stagger = introStaggerMs(characters.length)
  const shownLabel = introducing
    ? (
      <span className={css.introText}>
        {characters.map((character, index) => (
          <span
            key={index}
            className={css.introChar}
            style={{ animationDelay: `${INTRO_TEXT_DELAY_MS + index * stagger}ms` }}
          >
            {character}
          </span>
        ))}
      </span>
    )
    : label

  return (
    <>
      {ready && <Menu
        open={open && options.length > 0}
        onClose={() => { setOpen(false) }}
        items={options.map((option) => {
          const text = presetDisplayText(option, t)
          return {
            id: option.id,
            // Name and description together: the id alone never says what a
            // preset does, which is why the roster carries display copy.
            label: (
              <span className={css.item}>
                <span className={css.itemName}>{text.name}</span>
                <span className={css.itemDesc}>{text.description ?? t('noDescription')}</span>
              </span>
            ),
          }
        })}
        selectedId={state.current}
        onSelect={(id) => {
          setOpen(false)
          void select(id)
        }}
        align="start"
        portal
        className={css.menuAnchor}
        anchor={(
          <button
            type="button"
            className={css.seat}
            aria-haspopup="menu"
            aria-expanded={open && options.length > 0}
            title={(typeof state.error === 'object' ? state.error?.reason : state.error) ?? t(started ? 'headerHint' : 'seatHint')}
            disabled={state.busy || running || options.length === 0}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconAgentPresetOutlineRegular aria-hidden="true" className={introducing ? `${css.seatIcon} ${css.introIcon}` : css.seatIcon} />
            <span className={css.seatLabel}>{shownLabel}</span>
            <IconChevronDownOutlineRegular aria-hidden="true" className={css.chevron} />
          </button>
        )}
      />}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={t('switchRefused', { name: presetDisplayText(toast.error.preset, t).name, reason: toast.error.reason })}
          icon={<IconWarningOutlineRegular />}
          holdMs={REFUSAL_HOLD_MS}
          // The composer card, which is the content column this chip sits
          // above rather than inside — hence a page query, not `closest`.
          // Absent, the banner centers on the window, which is off-center
          // whenever the sidebar is open.
          anchor={document.querySelector<HTMLElement>('[data-composer-card]')}
          onDone={() => { dismissRefusal(toast.error) }}
        />
      )}
    </>
  )
}
