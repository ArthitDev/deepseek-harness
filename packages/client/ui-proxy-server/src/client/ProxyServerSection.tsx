/** Settings roster over the Host-owned proxy lifecycle. */
import { useState } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ProxyId } from '@deepseek-ai/dsh-proxy-server/types'
import css from './ProxyServerSection.module.css'

/** Narrow operator actions and accepted settings access. */
export interface ProxyServerInjected {
  hooks: { preferences: HostObservable<ConfigFormSnapshot<Record<string, boolean>>> }
  setEnabled: (id: ProxyId, enabled: boolean) => Promise<void>
}
type Props = PropsRuntime<'settings.section'> & PropsLocale<'proxyServers'> & InjectFace<ProxyServerInjected>

/** Render real proxy status, usage switches, and recoverable failures.
 * @param props Framework data hooks, actions and localized copy.
 * @returns The embedded proxy settings section.
 */
export function ProxyServerSection({ t, useResource, usePreferences, setEnabled }: Props) {
  const [revision, setRevision] = useState(0)
  const roster = useResource<'proxy-servers'>(`dsh-resource://proxy-servers/list?revision=${revision}`)
  const preferences = usePreferences(value => value)
  const [busy, setBusy] = useState<ProxyId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = (): void => { setRevision(value => value + 1) }
  const change = (id: ProxyId, enabled: boolean): void => {
    if (busy !== null) return
    setBusy(id); setError(null)
    void setEnabled(id, enabled).catch((reason: unknown) => {
      setError(t('failure', { message: reason instanceof Error ? reason.message : String(reason) }))
    }).finally(() => { setBusy(null); refresh() })
  }
  return <section className={css.section} aria-busy={busy !== null}>
    <div className={css.heading}><h2>{t('title')}</h2><Button variant="outline" size="sm" disabled={busy !== null} onClick={refresh}>{t('refresh')}</Button></div>
    <p className={css.description}>{t('description')}</p>
    <p className={css.description}>{t('externalNote')}</p>
    {(error !== null || roster.failure !== undefined) && <p role="alert" className={css.error}>{error ?? t('failure', { message: roster.failure?.message ?? '' })}</p>}
    {roster.value === undefined ? roster.failure === undefined ? <p role="status">{t('loading')}</p>
      : <Button variant="outline" size="sm" onClick={refresh}>{t('retry')}</Button>
      : <ul className={css.list}>{roster.value.map(server => <li key={server.id} className={css.row} data-proxy-id={server.id}>
        <div className={css.details}>
          <span className={css.name}>{server.name}</span>
          <span className={css.endpoint}>{server.endpoint}</span>
          <span className={css.description}>{t('routes', { routes: server.providers.join(', ') })}</span>
          <span className={css.status}>{t(server.status)}{!server.available && server.status === 'stopped' ? ` · ${t('missing')}` : ''}</span>
        </div>
        <Switch checked={preferences.value?.[`${server.id}Enabled`] ?? server.enabled}
          label={t('enabled', { name: server.name })} disabled={busy !== null || preferences.status !== 'ready' || !preferences.writable}
          onChange={(enabled) => { change(server.id, enabled) }} />
      </li>)}</ul>}
    {preferences.status === 'unavailable' && <p role="alert">{t('unavailable')}</p>}
  </section>
}
