import { useEffect, useState, type ReactNode } from 'react'
import type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
import css from './PluginInventorySettingsTab.module.css'

type Document = Awaited<ReturnType<NonNullable<PluginInventorySettingsTabInjected['edit']>>>

/** Confirmed switch edits retain the read revision and display persisted versus runtime state separately. */
export function PluginToggle({ entryId, moduleName, preset, edit, setEnabled, onSaved, t }: {
  entryId: string
  moduleName: string
  preset?: string
  edit: NonNullable<PluginInventorySettingsTabInjected['edit']>
  setEnabled: NonNullable<PluginInventorySettingsTabInjected['setEnabled']>
  onSaved?: () => void
  t: PluginInventorySettingsTabProps['t']
}): ReactNode {
  const [document, setDocument] = useState<Document>()
  const [draft, setDraft] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    setDocument(undefined)
    setDraft(undefined)
    setError('')
    setSaved(false)
    void edit(entryId, moduleName, preset).then(
      (value) => { if (current) setDocument(value) },
      (failure: unknown) => { if (current) setError(String(failure)) },
    )
    return () => { current = false }
  }, [entryId, moduleName, preset, edit, retry])

  const save = async (): Promise<void> => {
    if (!document || draft === undefined || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await setEnabled(entryId, moduleName, draft, document.revision, preset)
      setDocument(result)
      setDraft(undefined)
      setSaved(true)
      onSaved?.()
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.togglePanel} aria-busy={busy}>
      {document?.reason ? <p>{document.reason}</p> : document ? (
        <>
          <label className={css.toggleLabel}>
            <input
              type="checkbox"
              role="switch"
              aria-label={t('toggleLabel', { name: moduleName })}
              checked={draft ?? document.enabled}
              disabled={busy}
              onChange={(event) => { setDraft(event.target.checked); setSaved(false) }}
            />
            {t('enablePlugin')}
          </label>
          {draft !== undefined && draft !== document.enabled ? (
            <div>
              <p>{t(preset === undefined ? 'confirmGlobal' : 'confirmPreset')}</p>
              <button type="button" disabled={busy} onClick={() => { void save() }}>{t(busy ? 'saving' : 'save')}</button>
              <button type="button" disabled={busy} onClick={() => { setDraft(undefined) }}>{t('cancel')}</button>
            </div>
          ) : null}
          {saved ? <p role="status">{t(preset === undefined ? 'savedGlobal' : 'savedPreset')}</p> : null}
        </>
      ) : !error ? <p>{t('loading')}</p> : null}
      {error ? <div role="alert">{error}<button type="button" disabled={busy} onClick={() => { setRetry(value => value + 1) }}>{t('retry')}</button></div> : null}
    </div>
  )
}
