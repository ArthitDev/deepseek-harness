/** Preset selection, user composition editing, deletion, and mode help. */
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Button, IconBrowseOutlineRegular, IconCopyOutlineRegular, IconEditOutlineRegular,
  IconPlusOutlineRegular, IconTrashOutlineRegular, Modal, Switch, Tag, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentPresetSectionState } from './section-store.ts'
import { isBuiltInPreset, presetDisplayText } from './locales.ts'
import { requiresCodingTools, type AgentPresetPreferences } from './settings-store.ts'
import { PresetGuideDialog, presetGuide, trapPresetReaderTab, type PresetGuidePage } from './PresetGuideDialog.tsx'
import { PresetCreateDialog } from './PresetCreateDialog.tsx'
import css from './AgentPresetSection.module.css'

/** Settings actions and their shared controller state. */
export interface AgentPresetSectionInjected {
  hooks: {
    agentPresetSection: SnapshotStore<AgentPresetSectionState>
    /** Shared Coding Tools preference; off hides the built-in PTC and Minimal cards. */
    developerTools: ObservableSnapshot<boolean>
    /** Accepted visibility preference shared with the new-session menu. */
    presetPreferences: ObservableSnapshot<AgentPresetPreferences>
  }
  /** Stage the `cordis` preset and start a Creator-mode task; absent without a conversation flow. */
  startCreatorDraft?: () => void
  load: () => Promise<void>
  /** Open one preset's declared composition in the read-only viewer. */
  view: (id: string) => Promise<void>
  /** Close the read-only viewer. */
  closeView: () => void
  /** Create a distinct preset without changing its source or the selected default. */
  create: (from: string, id: string, name: string, content: string) => Promise<boolean>
  /** Store a profile-owned preset's composition; false keeps its draft visible. */
  write: (id: string, content: string) => Promise<boolean>
  /** Remove a profile-owned preset after explicit confirmation. */
  remove: (id: string) => Promise<boolean>
  makeDefault: (id: string) => Promise<void>
  /** Persist shipped-preset visibility without changing the selected preset. */
  setShowBuiltInPresets: (show: boolean) => Promise<void>
}
/** Props assembled by the settings renderer. */
export type AgentPresetSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.agentPreset'> & InjectFace<AgentPresetSectionInjected>

function CardDescription({ text }: { text: string }): ReactNode {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    /* v8 ignore next -- the ref is attached before layout effects run. */
    if (el === null) return
    const measure = () => { setTruncated(el.scrollHeight > el.clientHeight) }
    measure()
    // Card width follows the settings pane, which resizes with the window.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [text])
  return (
    // Capped near the card's own width: the default half-viewport bubble would
    // spill a description out of the settings dialog and across the app behind it.
    <Tooltip label={text} side="bottom" delayMs={400} disabled={!truncated} maxWidth={360}>
      {/* The empty title stops the card body's native tooltip from climbing to
        this span: a cut-off description answers with one bubble, not two. */}
      <span ref={ref} className={css.cardDesc} title="">{text}</span>
    </Tooltip>
  )
}

/** Render the roster with its default, mode help, composition viewer, and the guidance to Creator mode.
 * @param props Settings actions, snapshot hooks and localized text.
 * @returns The preset settings section.
 */
export function AgentPresetSection({
  useAgentPresetSection, load, view, closeView, create, write, remove, makeDefault, startCreatorDraft,
  close: closeSettings, useDeveloperTools, usePresetPreferences, setShowBuiltInPresets, t,
}: AgentPresetSectionProps) {
  const state = useAgentPresetSection(value => value)
  const developerTools = useDeveloperTools(enabled => enabled)
  const preferences = usePresetPreferences(value => value)
  const showBuiltIns = preferences.value?.showBuiltInPresets ?? true
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState<'createPreset' | 'copyPreset' | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  const [guide, setGuide] = useState<{
    content: NonNullable<ReturnType<typeof presetGuide>>
    page: PresetGuidePage
  } | null>(null)
  const viewTrigger = useRef<HTMLButtonElement | null>(null)
  const closeViewOnUnmount = useRef(closeView)
  useEffect(() => { void load() }, [load])
  useLayoutEffect(() => { closeViewOnUnmount.current = closeView }, [closeView])
  useEffect(() => () => { closeViewOnUnmount.current() }, [])
  const closeViewer = () => { if (!state.saving) { closeView(); setCreating(null); viewTrigger.current?.focus() } }
  const viewed = state.view
  const viewedRow = viewed === null ? undefined : state.rows.find(row => row.id === viewed.id)
  const viewedTitle = viewed === null ? '' : viewedRow === undefined ? viewed.title : presetDisplayText(viewedRow, t).name
  const createSource = state.rows.find(row => row.isDefault && row.broken === undefined)
    ?? state.rows.find(row => row.broken === undefined)
  // Creator mode authors presets in conversation; it needs the flow to land a
  // session in and the self-referential preset on the roster.
  const creator = startCreatorDraft !== undefined && state.rows.some(row => row.id === 'cordis') ? startCreatorDraft : undefined
  /* The custom group is where a preset of one's own appears, so its entry
     stays on screen even while the group is empty. */
  const creatorButton = creator === undefined
    ? null
    : (
      <button
        type="button"
        className={css.creatorButton}
        disabled={state.saving}
        onClick={() => { creator(); closeSettings() }}
      >
        <IconPlusOutlineRegular size={14} />
        {t('creatorDraft')}
      </button>
    )
  return <section className={css.section}>
    <h2 className={css.title}>{t('nav')}</h2>
    <p className={css.intro}>{t('sectionIntro')}</p>
    <div className={css.visibility}>
      <span>{t('showBuiltInPresets')}</span>
      <Switch checked={showBuiltIns} label={t('showBuiltInPresets')}
        disabled={state.saving || preferences.status !== 'ready' || !preferences.writable}
        onChange={(show) => { void setShowBuiltInPresets(show) }} />
    </div>
    {state.error === null ? null : <p className={css.error} role="alert">{state.error}</p>}
    {([true, false] as const).map((builtIn) => {
      if (builtIn && !showBuiltIns) return null
      const rows = state.rows.filter(row => isBuiltInPreset(row) === builtIn
        && (developerTools || !requiresCodingTools(row)))
      const canCreate = !builtIn && state.authorable === true && createSource !== undefined
      const entry = builtIn ? null : creatorButton
      if (rows.length === 0 && entry === null && !canCreate) return null
      return <section key={String(builtIn)} className={css.group}>
        <h3 className={css.groupHead}>{t(builtIn ? 'builtInGroup' : 'customGroup')}</h3>
        {rows.length === 0 ? null : <ul className={css.cards}>
          {rows.map((row) => {
            const display = presetDisplayText(row, t)
            const help = presetGuide(row.id, builtIn ? 'system' : 'user')
            const selectionAction = row.broken !== undefined ? t('brokenBadge')
              : t(row.isDefault ? 'inUse' : 'setDefault')
            return <li key={row.id} data-agent-preset-id={row.id} className={[
              css.card, row.broken === undefined ? undefined : css.cardBroken,
              row.isDefault ? css.cardActive : undefined,
            ].filter(Boolean).join(' ')}>
              <button type="button" className={css.cardMain} aria-pressed={row.isDefault}
                disabled={row.isDefault || (row.broken === undefined && state.saving)}
                aria-disabled={row.broken !== undefined} aria-label={`${selectionAction}: ${display.name}`} title={selectionAction}
                onClick={() => { if (row.broken === undefined) void makeDefault(row.id) }}>
                <span className={css.cardHead}>
                  <span className={css.cardIdentity}>
                    <span className={css.cardName} title={display.name}>{display.name}</span>
                    {row.broken === undefined ? null : <span className={css.brokenBadge}>
                      {t('brokenBadge')}<span className={css.brokenTip} aria-hidden="true">{row.broken}</span>
                    </span>}
                    <Tag tone={row.isDefault ? 'solid' : 'outline'}>
                      {row.isDefault ? t('inUse') : t(builtIn ? 'builtInGroup' : 'customGroup')}
                    </Tag>
                  </span>
                  <code className={css.cardId} title={row.id}>{row.id}</code>
                </span>
                <CardDescription text={display.description ?? t('noDescription')} />
                {row.broken === undefined ? null : <span className={css.cardBrokenReason} role="alert">{row.broken}</span>}
              </button>
              <div className={css.cardFoot}>
                {help === undefined ? null : <div className={css.cardHelp}>
                  <Button variant="ghost" className={css.helpButton} aria-label={`${t('modeExplanation')}: ${display.name}`}
                    onClick={() => { setGuide({ content: help, page: 'explanation' }) }}>{t('modeExplanation')}</Button>
                  <Button variant="ghost" className={css.helpButton} aria-label={`${t('howToUse')}: ${display.name}`}
                    onClick={() => { setGuide({ content: help, page: 'usage' }) }}>{t('howToUse')}</Button>
                </div>}
                {state.authorable !== true ? null : <Tooltip label={t('copyPreset')} side="top" portal disabled={state.saving}>
                  <button type="button" className={css.iconButton} disabled={state.saving}
                    aria-label={`${t('copyPreset')}: ${display.name}`} onClick={(event) => {
                      viewTrigger.current = event.currentTarget; setCreating('copyPreset'); setEditingId(null); void view(row.id)
                    }}><IconCopyOutlineRegular /></button>
                </Tooltip>}
                {state.authorable === true && row.trust === 'user' ? <>
                  <Tooltip label={t('edit')} side="top" portal disabled={state.saving}>
                    <button type="button" className={css.iconButton} disabled={state.saving} aria-label={`${t('edit')}: ${display.name}`}
                      onClick={(event) => {
                        viewTrigger.current = event.currentTarget; setCreating(null); setEditingId(row.id); void view(row.id)
                      }}><IconEditOutlineRegular /></button>
                  </Tooltip>
                  <Tooltip label={t('deletePreset')} side="top" portal disabled={state.saving}>
                    <button type="button" className={css.iconButton} disabled={state.saving} aria-label={`${t('deletePreset')}: ${display.name}`}
                      onClick={() => { setDeleting({ id: row.id, name: display.name }) }}><IconTrashOutlineRegular /></button>
                  </Tooltip>
                </> : null}
                <Tooltip label={t('view')} side="top" portal disabled={state.saving}>
                  <button type="button" className={css.iconButton} aria-label={`${t('view')}: ${display.name}`}
                    disabled={state.saving}
                    onClick={(event) => {
                      viewTrigger.current = event.currentTarget; setCreating(null); setEditingId(null); void view(row.id)
                    }}><IconBrowseOutlineRegular /></button>
                </Tooltip>
              </div>
            </li>
          })}
        </ul>}
        {!canCreate ? null : <Button variant="outline" disabled={state.saving} icon={<IconPlusOutlineRegular size={16} />} onClick={(event) => {
          viewTrigger.current = event.currentTarget; setCreating('createPreset'); setEditingId(null); void view(createSource.id)
        }}>{t('createPreset')}</Button>}
        {entry}
      </section>
    })}
    {guide === null ? null : <PresetGuideDialog guide={guide.content} initialPage={guide.page} t={t} onClose={() => { setGuide(null) }} />}
    {viewed !== null && creating !== null ? <PresetCreateDialog key={viewed.id}
      title={t(creating)} source={viewedTitle} content={viewed.content} saving={state.saving} error={state.error} t={t}
      onClose={closeViewer} onSave={async (id, name, content) => {
        if (await create(viewed.id, id, name, content)) closeViewer()
      }} /> : viewed !== null && editingId === viewed.id ? <PresetEditor key={viewed.id}
      content={viewed.content} title={`${t('edit')} · ${viewedTitle}`} saving={state.saving} error={state.error} t={t}
      onClose={closeViewer} onSave={async (content) => {
        if (await write(viewed.id, content)) { closeView(); viewTrigger.current?.focus() }
      }} /> :
      <Modal open={viewed !== null} onClose={closeViewer} closeLabel={t('close')}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeViewer()
          } else trapPresetReaderTab(event)
        }}
        title={viewed === null ? '' : `${t('view')} · ${viewedTitle}`} className={css.dialog as string}
        footer={<Button variant="outline" autoFocus onClick={closeViewer}>{t('close')}</Button>}>
        {viewed === null ? null : <pre className={css.viewerCode}>{viewed.content}</pre>}
      </Modal>}
    <Modal open={deleting !== null} title={t('deletePreset')} closeLabel={t('cancel')}
      onClose={() => { if (!state.saving) setDeleting(null) }}
      footer={<>
        <Button variant="outline" disabled={state.saving} onClick={() => { setDeleting(null) }}>{t('cancel')}</Button>
        <Button disabled={state.saving} onClick={() => { if (deleting !== null) void remove(deleting.id).then((ok) => { if (ok) setDeleting(null) }) }}>{t('deletePreset')}</Button>
      </>}>
      <p>{t('confirmDelete').replace('{name}', deleting?.name ?? '')}</p>
      {state.error === null ? null : <p className={css.error} role="alert">{state.error}</p>}
    </Modal>
  </section>
}

/** A draft stays local to its open editor and survives a refused save. */
function PresetEditor({ content, title, saving, error, t, onClose, onSave }: {
  content: string
  title: string
  saving: boolean
  error: string | null
  t: AgentPresetSectionProps['t']
  onClose: () => void
  onSave: (content: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(content)
  return <Modal open title={title} closeLabel={t('cancel')} onClose={onClose} className={css.dialog as string}
    footer={<>
      <Button variant="outline" disabled={saving} onClick={onClose}>{t('cancel')}</Button>
      <Button disabled={saving || draft === content} onClick={() => { void onSave(draft) }}>{t('save')}</Button>
    </>}>
    <label className={css.editorLabel}>{t('composition')}
      <textarea className={`${css.viewerCode} ${css.editor}`} value={draft} disabled={saving}
        data-modal-autofocus spellCheck={false} onChange={(event) => { setDraft(event.currentTarget.value) }} />
    </label>
    {error === null ? null : <p className={css.error} role="alert">{error}</p>}
  </Modal>
}
