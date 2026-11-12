/** Read-only presentation of one sampled Host HTTPS egress verification. */
import { useEffect, useState } from 'react'
export type { VpnLocaleKey } from './locales.ts'
import type { PropsLocale, GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import css from './VpnStatusBar.module.css'

/** Derived locale and resource hooks are bound by the Slot renderer. */
export type VpnStatusBarProps = PropsLocale<'vpn.status'> & Pick<GlobalStandardProps, 'useResource'>

/** Show verification only while the result is live and unexpired.
 * @param props - localized copy and the shared resource hook.
 * @returns the compact status row without public IP data.
 */
export function VpnStatusBar({ t, useResource }: VpnStatusBarProps) {
  const resource = useResource<'vpn-status'>('dsh-resource://vpn-status/host')
  const sample = resource.status === 'live' ? resource.value : undefined
  const expiry = sample?.validUntil ?? null
  const [expired, setExpired] = useState<number | null>(null)
  useEffect(() => {
    if (expiry === null) return
    const timer = setTimeout(() => { setExpired(expiry) }, Math.max(0, expiry - Date.now()))
    return () => { clearTimeout(timer) }
  }, [expiry])
  const fresh = expiry !== null && Date.now() < expiry && expired !== expiry
  const state = sample?.state === 'verified' && !fresh ? 'unknown' : sample?.state ?? 'unknown'
  const evidence = state === 'verified' ? sample?.evidence : null
  const checked = sample?.checkedAt
  return <div className={css.bar} data-vpn-state={state} role="status">
    <span className={state === 'verified' ? css.verified : css.pending}>{t(state)}</span>
    {evidence != null && <span>{t(evidence === 'mullvad' ? 'mullvad' : 'expected')}</span>}
    <span>{t('host')}</span>
    <span>{checked == null ? t('never') : t('checked') + ' ' + new Date(checked).toISOString().slice(11, 19) + 'Z'}</span>
  </div>
}
