import { useState, type FormEvent } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconListPenOutlineRegular,
  Menu,
  Modal,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ReconTargetInjected } from './index.ts'
import { ReconLoading } from './ReconView.tsx'
import css from './ReconTargetControl.module.css'

function TargetIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="4.75" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export type ReconTargetControlProps = PropsRuntime<'conversation.input.left'>
  & PropsLocale<'recon'>
  & InjectFace<ReconTargetInjected>

/** Toolbar shortcut that collects a target before opening the Recon view. */
export function ReconTargetControl({ enqueue, openRecon, t }: ReconTargetControlProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState('')
  const [aiAssisted, setAiAssisted] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = (): void => {
    if (running) return
    setOpen(false)
    setError(null)
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const value = target.trim()
    if (value === '' || running) return
    setRunning(true)
    setError(null)
    void (async () => {
      try {
        await enqueue(value, aiAssisted)
        openRecon()
        setOpen(false)
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setRunning(false)
      }
    })()
  }

  return (
    <>
      <Menu
        open={menuOpen}
        side="top"
        portal
        autoFocus
        items={[
          { id: 'new', label: t('recon.menu.new'), icon: <TargetIcon /> },
          { id: 'view', label: t('recon.menu.view'), icon: <IconListPenOutlineRegular size={16} /> },
        ]}
        onClose={() => { setMenuOpen(false) }}
        onSelect={(id) => {
          setMenuOpen(false)
          if (id === 'new') setOpen(true)
          if (id === 'view') openRecon()
        }}
        anchor={(
          <button
            type="button"
            className={css.trigger}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => { setMenuOpen(value => !value) }}
          >
            <TargetIcon />
            <span>{t('command.reconTarget')}</span>
            {menuOpen ? <IconChevronUpOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />}
          </button>
        )}
      />
      <Modal
        open={open}
        onClose={close}
        title={t('command.reconTarget')}
        description={t('recon.target.description')}
        closeLabel={t('recon.close')}
        footer={(
          <>
            <Button variant="ghost" disabled={running} onClick={close}>{t('recon.cancel')}</Button>
            <Button
              form="recon-target-form"
              type="submit"
              variant="primary"
              disabled={running || target.trim() === ''}
            >
              {running ? t('recon.scan.running') : t('recon.scan.button')}
            </Button>
          </>
        )}
      >
        {running
          ? <ReconLoading message={t('recon.queue.adding', { target: target.trim() })} />
          : <form id="recon-target-form" className={css.form} onSubmit={submit}>
            <label className={css.field}>
              <span>{t('recon.scan.target')}</span>
              <input
                autoFocus
                type="url"
                value={target}
                placeholder="https://target.example"
                disabled={running}
                onChange={(event) => { setTarget(event.currentTarget.value) }}
              />
            </label>
            <div className={css.aiOption}>
              <span>
                <strong>{t('recon.ai.label')}</strong>
                <small>{t('recon.ai.description')}</small>
              </span>
              <Switch
                checked={aiAssisted}
                disabled={running}
                label={t('recon.ai.label')}
                onChange={setAiAssisted}
              />
            </div>
            {error !== null && <p className={css.error} role="alert">{error}</p>}
          </form>}
      </Modal>
    </>
  )
}
