import { useEffect, useRef, useState } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { WebSearchPolicySettings } from '@deepseek-ai/dsh-tool-web/settings'
import type { WebSearchModeInjected } from './index.ts'
import css from './WebSearchModeControl.module.css'

export interface WebSearchModeHooks {
  webSearchMode: ObservableSnapshot<SettingsScopeSnapshot<WebSearchPolicySettings>>
}

export type WebSearchModeControlProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'webSearchMode'>
  & InjectFace<WebSearchModeInjected>

/** Global always-search toggle in General Settings. */
export function WebSearchModeControl({ useWebSearchMode, setAlways, t }: WebSearchModeControlProps) {
  const settings = useWebSearchMode(value => value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  if (settings.status === 'unavailable') return null

  const always = settings.value?.always ?? false
  const change = (next: boolean): void => {
    setSaving(true)
    setError(null)
    void setAlways(next).then(() => {
      if (alive.current) setSaving(false)
    }, (reason: unknown) => {
      if (!alive.current) return
      setSaving(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('title')}</div>
        <div className={css.desc} role={error === null ? undefined : 'alert'}>
          {error ?? t('description')}
        </div>
      </div>
      <Switch
        checked={always}
        onChange={change}
        label={t('toggle.aria')}
        disabled={saving || settings.status === 'loading' || !settings.writable}
      />
    </div>
  )
}
