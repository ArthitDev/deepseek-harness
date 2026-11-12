/** Profile preset creation keeps identity and composition drafts until the Host accepts them. */
import { useId, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentPresetSectionProps } from './AgentPresetSection.tsx'
import css from './AgentPresetSection.module.css'

/** Render a new preset draft based on an existing declaration.
 * @param props Source composition, localized labels and persistence callbacks.
 * @returns The creation dialog.
 */
export function PresetCreateDialog({ title, source, content, saving, error, t, onClose, onSave }: {
  title: string
  source: string
  content: string
  saving: boolean
  error: string | null
  t: AgentPresetSectionProps['t']
  onClose: () => void
  onSave: (id: string, name: string, content: string) => Promise<void>
}) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [draft, setDraft] = useState(content)
  const hintId = useId()
  return <Modal open title={title} closeLabel={t('cancel')} className={css.dialog as string}
    onClose={() => { if (!saving) onClose() }}
    footer={<>
      <Button variant="outline" disabled={saving} onClick={onClose}>{t('cancel')}</Button>
      <Button disabled={saving || id.trim() === ''} onClick={() => { void onSave(id, name, draft) }}>{t('save')}</Button>
    </>}>
    <div className={css.createFields}>
      <p className={css.intro}>{t('basedOn').replace('{name}', source)}</p>
      <label className={css.editorLabel}>{t('presetName')}
        <Input value={name} disabled={saving} data-modal-autofocus onChange={(event) => { setName(event.currentTarget.value) }} />
      </label>
      <label className={css.editorLabel}>{t('presetId')}
        <Input value={id} disabled={saving} spellCheck={false} autoCapitalize="none" autoCorrect="off"
          aria-describedby={hintId} onChange={(event) => { setId(event.currentTarget.value) }} />
      </label>
      <p className={css.intro} id={hintId}>{t('presetIdHint')}</p>
      <label className={css.editorLabel}>{t('composition')}
        <textarea className={`${css.viewerCode} ${css.editor}`} value={draft} disabled={saving} spellCheck={false}
          onChange={(event) => { setDraft(event.currentTarget.value) }} />
      </label>
      {error === null ? null : <p className={css.error} role="alert">{error}</p>}
    </div>
  </Modal>
}
