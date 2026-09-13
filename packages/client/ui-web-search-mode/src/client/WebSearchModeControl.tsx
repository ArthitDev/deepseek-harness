import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WebSearchModeInjected } from './index.ts'
import css from './WebSearchModeControl.module.css'

export type WebSearchModeControlProps =
  PropsRuntime<'conversation.input.webSearch'>
  & InjectFace<WebSearchModeInjected>
  & PropsLocale<'webSearchMode'>

/** Toggle automatic or required web search using host-projected state. */
export function WebSearchModeControl({ useProjection, locked, setAlways, t }: WebSearchModeControlProps) {
  const mode = useProjection('webSearchMode')
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  if (mode === undefined) return null
  const always = mode.always
  const toggle = (): void => {
    setSwitching(true)
    setError(null)
    void setAlways(!always).then((failure) => {
      if (!aliveRef.current) return
      setSwitching(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setSwitching(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={`${css.chip} ${always ? css.active : ''}`}
        aria-pressed={always}
        aria-label={t(always ? 'chip.always.aria' : 'chip.auto.aria')}
        title={t(always ? 'chip.always.title' : 'chip.auto.title')}
        disabled={locked || switching}
        onClick={toggle}
      >
        <IconGlobeOutline14 size={13} />
        {t('chip.label')}
      </button>
      {error !== null && <span className={css.error} role="status" title={error}>{t('chip.failed')}</span>}
    </span>
  )
}
