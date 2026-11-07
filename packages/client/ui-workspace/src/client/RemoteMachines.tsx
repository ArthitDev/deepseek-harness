/** Saved remote-machine management and the team-mode switch rendered in Settings. */
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { RemoteMachineAuth, RemoteMachineSaveRequest, RemoteMachineView } from '@deepseek-ai/dsh-remote-machines/types'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular,
  IconGlobeOutlineRegular, IconGoalOutlineRegular, IconPlusOutlineRegular, IconShieldOutlineRegular,
  Menu, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteMachineController, RemoteMachineSnapshot } from './remote-machine-store.ts'
import type { AgentMode, AgentModeController } from './agent-mode.ts'
import css from './RemoteMachines.module.css'
/**
 * Parse a `__dsh_ssh__/<machine>/<path>` execution path client-side.
 * Mirrors the host helper without crossing the client bundle purity boundary.
 * @param value - Candidate path.
 * @returns the machine id and path, or undefined for a local path.
 */
function parseRemoteExecutionPath(value: string): { machineId: string; path: string } | undefined {
  const ROOT = '/__dsh_ssh__/'
  if (!value.startsWith(ROOT)) return undefined
  const rest = value.slice(ROOT.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return undefined
  return { machineId: rest.slice(0, slash), path: rest.slice(slash) }
}

/** Share the settings section consumes: the machine controller, the mode controller, and roster facts. */
export interface RemoteMachineInjected {
  controller: RemoteMachineController
  agentMode: AgentModeController
  hooks: {
    remoteMachines: { getSnapshot: () => RemoteMachineSnapshot; subscribe: (fn: () => void) => () => void }
  }
  /** Adopt a machine-qualified path as a real Workspace. */
  createWorkspace: (path: string) => Promise<WorkspaceView>
}

const AGENT_MODES: readonly AgentMode[] = ['blue', 'red', 'black', 'dead']
const MODE_TRANSITION_MS = 1100

const BlackTeamIcon = ({ size = 16, className }: {
  size?: number | undefined
  className?: string | undefined
}) => (
  <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M3 6.7A5 5 0 0 1 13 6.7c0 2-.8 3.4-2.2 4.2v2.2H9.2v-1.4H8.6v1.4H7.4v-1.4h-.6v1.4H5.2v-2.2C3.8 10.1 3 8.7 3 6.7Z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <circle cx="6" cy="7.3" r="1.15" fill="currentColor" />
    <circle cx="10" cy="7.3" r="1.15" fill="currentColor" />
    <path d="m8 8.8-1 1.5h2L8 8.8Z" fill="currentColor" />
  </svg>
)

const DeadModeIcon = ({ size = 16, className }: {
  size?: number | undefined
  className?: string | undefined
}) => (
  <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.8 13 4.7v6.6L8 14.2 3 11.3V4.7L8 1.8Z" stroke="currentColor" strokeWidth="1.3" />
    <path d="m6.2 5.7 3.6 4.6m0-4.6-3.6 4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const AGENT_MODE_ICONS = {
  blue: IconShieldOutlineRegular,
  red: IconGoalOutlineRegular,
  black: BlackTeamIcon,
  dead: DeadModeIcon,
} satisfies Record<AgentMode, typeof IconShieldOutlineRegular>

/** Local-machine glyph used by the picker and machine rows. */
export function ComputerIcon({ remote = false }: { remote?: boolean }) {
  return remote
    ? <IconGlobeOutlineRegular size={14} />
    : (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
        <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" stroke="currentColor" />
        <path d="M5 13.5h6M8 11v2.5" stroke="currentColor" strokeLinecap="round" />
      </svg>
    )
}

/**
 * The team-mode switch shown at the top of the Remote machines section.
 * @param props - injected controller, lock state, and locale.
 * @returns the mode switch menu and its transition overlay.
 */
export function AgentModeControl({ controller, locked, t }: {
  controller: AgentModeController
  locked: boolean
  t: PropsLocale<'workspace'>['t']
}) {
  const mode = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [open, setOpen] = useState(false)
  const [transitioning, setTransitioning] = useState<AgentMode | null>(null)
  const label = t(`agentMode.${mode}`)
  const ActiveIcon = AGENT_MODE_ICONS[mode]
  useEffect(() => {
    if (transitioning === null) return
    const timeout = window.setTimeout(() => { setTransitioning(null) }, MODE_TRANSITION_MS)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [transitioning])
  return (
    <>
      <Menu
        open={open}
        side="top"
        items={AGENT_MODES.map((value) => {
          const Icon = AGENT_MODE_ICONS[value]
          return {
            id: value,
            label: t(`agentMode.${value}`),
            icon: <span className={css.modeMenuIcon} data-agent-mode={value}><Icon size={14} /></span>,
          }
        })}
        selectedId={mode}
        onSelect={(id) => {
          const next = id as AgentMode
          if (next !== mode) {
            controller.set(next)
            setTransitioning(next)
          }
          setOpen(false)
        }}
        onClose={() => { setOpen(false) }}
        portal
        anchor={(
          <button
            type="button"
            className={css.agentMode}
            aria-label={t('agentMode.aria', { mode: label })}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={locked}
            onClick={() => { setOpen(value => !value) }}
          >
            <ActiveIcon size={14} />
            <span>{label}</span>
            {open ? <IconChevronUpOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />}
          </button>
        )}
      />
      {transitioning !== null && (
        <div className={css.modeLoading} role="status" aria-live="polite">
          <div className={css.modeLoadingBrand}>
            <span className={css.modeLoadingLogo} aria-hidden="true" />
            <span>{t('agentMode.agent', { mode: t(`agentMode.${transitioning}`) })}</span>
          </div>
          <span className={css.modeLoadingSpinner} aria-hidden="true" />
          <span className={css.modeLoadingHint}>{t('agentMode.loading', { mode: t(`agentMode.${transitioning}`) })}</span>
        </div>
      )}
    </>
  )
}

/** Props of the Remote machines entry in `settings.section`. */
export type RemoteMachinesSectionProps =
  PropsRuntime<'settings.section'>
  & InjectFace<RemoteMachineInjected>
  & PropsLocale<'workspace'>

interface MachineDraft {
  name: string
  host: string
  port: string
  username: string
  auth: RemoteMachineAuth
  defaultPath: string
  password: string
  privateKey: string
  passphrase: string
}

const EMPTY_DRAFT: MachineDraft = {
  name: '', host: '', port: '22', username: '', auth: 'agent', defaultPath: '',
  password: '', privateKey: '', passphrase: '',
}

function draftOf(machine?: RemoteMachineView): MachineDraft {
  if (machine === undefined) return { ...EMPTY_DRAFT }
  return {
    name: machine.name,
    host: machine.host,
    port: String(machine.port),
    username: machine.username,
    auth: machine.auth,
    defaultPath: machine.defaultPath ?? '',
    password: '',
    privateKey: '',
    passphrase: '',
  }
}

function MachineEditor({ open, machine, controller, onClose, onSaved, t }: {
  open: boolean
  machine?: RemoteMachineView | undefined
  controller: RemoteMachineController
  onClose: () => void
  onSaved: (machine: RemoteMachineView) => void
  t: RemoteMachinesSectionProps['t']
}) {
  const [draft, setDraft] = useState<MachineDraft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(open ? draftOf(machine) : { ...EMPTY_DRAFT })
    setError(null)
  }, [open, machine])

  const field = <K extends keyof MachineDraft>(key: K) =>
    (value: MachineDraft[K]): void => { setDraft(current => ({ ...current, [key]: value })) }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const port = Number(draft.port)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      setError(t('remote.error.port'))
      return
    }
    const request: RemoteMachineSaveRequest = {
      ...(machine === undefined ? {} : { id: machine.id }),
      name: draft.name,
      host: draft.host,
      port,
      username: draft.username,
      auth: draft.auth,
      defaultPath: draft.defaultPath,
      ...(draft.password === '' ? {} : { password: draft.password }),
      ...(draft.privateKey === '' ? {} : { privateKey: draft.privateKey }),
      ...(draft.passphrase === '' ? {} : { passphrase: draft.passphrase }),
    }
    setSaving(true)
    setError(null)
    void controller.save(request).then((saved) => {
      setSaving(false)
      setDraft({ ...EMPTY_DRAFT })
      onSaved(saved)
    }, (reason: unknown) => {
      setSaving(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      closeLabel={t('remote.close')}
      title={t(machine === undefined ? 'remote.add.title' : 'remote.edit.title')}
      description={t('remote.editor.description')}
      {...css.dialog === undefined ? {} : { className: css.dialog }}
      footer={(
        <>
          <Button variant="outline" disabled={saving} onClick={onClose}>{t('remote.cancel')}</Button>
          <Button type="submit" form="remote-machine-form" disabled={saving}>
            {t(saving ? 'remote.saving' : 'remote.save')}
          </Button>
        </>
      )}
    >
      <form id="remote-machine-form" className={css.form} onSubmit={submit}>
        <label className={css.field}>
          <span>{t('remote.field.name')}</span>
          <input required value={draft.name} onChange={(event) => { field('name')(event.target.value) }} />
        </label>
        <div className={css.fieldPair}>
          <label className={css.field}>
            <span>{t('remote.field.host')}</span>
            <input required value={draft.host} onChange={(event) => { field('host')(event.target.value) }} />
          </label>
          <label className={css.fieldSmall}>
            <span>{t('remote.field.port')}</span>
            <input required inputMode="numeric" value={draft.port} onChange={(event) => { field('port')(event.target.value) }} />
          </label>
        </div>
        <label className={css.field}>
          <span>{t('remote.field.username')}</span>
          <input required autoComplete="username" value={draft.username} onChange={(event) => { field('username')(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span>{t('remote.field.auth')}</span>
          <select value={draft.auth} onChange={(event) => { field('auth')(event.target.value as RemoteMachineAuth) }}>
            <option value="agent">{t('remote.auth.agent')}</option>
            <option value="password">{t('remote.auth.password')}</option>
            <option value="password-prompt">{t('remote.auth.passwordPrompt')}</option>
            <option value="private-key">{t('remote.auth.privateKey')}</option>
          </select>
        </label>
        {draft.auth === 'password' && (
          <label className={css.field}>
            <span>{t('remote.field.password')}</span>
            <input
              type="password"
              autoComplete="new-password"
              placeholder={machine?.hasPassword === true ? t('remote.secret.keep') : undefined}
              value={draft.password}
              onChange={(event) => { field('password')(event.target.value) }}
            />
          </label>
        )}
        {draft.auth === 'private-key' && (
          <>
            <label className={css.field}>
              <span>{t('remote.field.privateKey')}</span>
              <textarea
                rows={5}
                spellCheck={false}
                placeholder={machine?.hasPrivateKey === true ? t('remote.secret.keep') : t('remote.privateKey.placeholder')}
                value={draft.privateKey}
                onChange={(event) => { field('privateKey')(event.target.value) }}
              />
            </label>
            <label className={css.field}>
              <span>{t('remote.field.passphrase')}</span>
              <input
                type="password"
                autoComplete="new-password"
                placeholder={machine?.hasPassphrase === true ? t('remote.secret.keep') : undefined}
                value={draft.passphrase}
                onChange={(event) => { field('passphrase')(event.target.value) }}
              />
            </label>
          </>
        )}
        <label className={css.field}>
          <span>{t('remote.field.defaultPath')}</span>
          <input placeholder={t('remote.path.placeholder')} value={draft.defaultPath} onChange={(event) => { field('defaultPath')(event.target.value) }} />
        </label>
        {error !== null && <p className={css.error} role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

function TrustDialog({ machine, fingerprint, busy, error, onClose, onTrust, t }: {
  machine: RemoteMachineView | null
  fingerprint: string | null
  busy: boolean
  error: string | null
  onClose: () => void
  onTrust: () => void
  t: RemoteMachinesSectionProps['t']
}) {
  return (
    <Modal
      open={machine !== null && fingerprint !== null}
      onClose={busy ? () => {} : onClose}
      closeLabel={t('remote.close')}
      title={t('remote.trust.title')}
      description={machine === null ? '' : t('remote.trust.description', { name: machine.name })}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>{t('remote.cancel')}</Button>
          <Button disabled={busy} onClick={onTrust}>{t(busy ? 'remote.trusting' : 'remote.trust')}</Button>
        </>
      )}
    >
      <code className={css.fingerprint}>{fingerprint}</code>
      {error !== null && <p className={css.error} role="alert">{error}</p>}
    </Modal>
  )
}

/** The Settings page listing saved machines with test, edit, and delete actions. */
export function RemoteMachinesSection({ controller, agentMode, useRemoteMachines, useWorkspaces, t }: RemoteMachinesSectionProps) {
  const state = useRemoteMachines(value => value)
  const workspaces = useWorkspaces(value => value.items)
  const [editor, setEditor] = useState<RemoteMachineView | 'new' | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [message, setMessage] = useState<Record<string, string>>({})
  const [trustTarget, setTrustTarget] = useState<{ machine: RemoteMachineView; fingerprint: string } | null>(null)
  const [trusting, setTrusting] = useState(false)
  const [trustError, setTrustError] = useState<string | null>(null)

  useEffect(() => { if (state.status === 'idle') void controller.load() }, [controller, state.status])

  const machineInUse = (id: string): boolean => workspaces.some(workspace => parseRemoteExecutionPath(workspace.path)?.machineId === id)
  const test = (machine: RemoteMachineView): void => {
    setTesting(machine.id)
    setMessage(current => ({ ...current, [machine.id]: '' }))
    void controller.probe(machine.id).then((probe) => {
      setTesting(null)
      if (!probe.trusted) {
        setTrustTarget({ machine, fingerprint: probe.fingerprint })
        return
      }
      setMessage(current => ({ ...current, [machine.id]: t('remote.test.connected') }))
    }, (reason: unknown) => {
      setTesting(null)
      setMessage(current => ({ ...current, [machine.id]: reason instanceof Error ? reason.message : String(reason) }))
    })
  }
  const trust = (): void => {
    if (trustTarget === null) return
    setTrusting(true)
    setTrustError(null)
    void controller.trust(trustTarget.machine.id, trustTarget.fingerprint).then(() => {
      setTrusting(false)
      setMessage(current => ({ ...current, [trustTarget.machine.id]: t('remote.test.connected') }))
      setTrustTarget(null)
    }, (reason: unknown) => {
      setTrusting(false)
      setTrustError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <div className={css.section}>
      <div className={css.sectionHead}>
        <div>
          <h2>{t('remote.section.title')}</h2>
          <p>{t('remote.section.description')}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className={css.addButton}
          icon={<IconPlusOutlineRegular />}
          onClick={() => { setEditor('new') }}
        >
          {t('remote.add')}
        </Button>
      </div>
      <AgentModeControl controller={agentMode} locked={false} t={t} />
      {state.error !== null && <p className={css.error} role="alert">{state.error}</p>}
      {state.status === 'loading' && state.machines.length === 0 && <p className={css.muted}>{t('remote.loading')}</p>}
      {state.status === 'ready' && state.machines.length === 0 && <div className={css.empty}>{t('remote.empty')}</div>}
      <ul className={css.cards}>
        {state.machines.map((machine) => {
          const inUse = machineInUse(machine.id)
          return (
            <li className={css.card} key={machine.id}>
              <div className={css.cardIcon}><ComputerIcon remote /></div>
              <div className={css.cardBody}>
                <div className={css.cardTitle}>{machine.name}</div>
                <code>{machine.username}@{machine.host}:{machine.port}</code>
                <span>{machine.fingerprint === undefined ? t('remote.status.untrusted') : t('remote.status.trusted')}</span>
                {message[machine.id] !== undefined && message[machine.id] !== '' && <span role="status">{message[machine.id]}</span>}
              </div>
              <div className={css.cardActions}>
                <Button size="sm" variant="outline" disabled={testing === machine.id} onClick={() => { test(machine) }}>
                  {t(testing === machine.id ? 'remote.testing' : 'remote.test')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setEditor(machine) }}>{t('remote.edit')}</Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={css.danger}
                  disabled={inUse}
                  title={inUse ? t('remote.delete.inUse') : undefined}
                  onClick={() => {
                    void controller.remove(machine.id).catch((reason: unknown) => {
                      setMessage(current => ({ ...current, [machine.id]: reason instanceof Error ? reason.message : String(reason) }))
                    })
                  }}
                >
                  {t('remote.delete')}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      <MachineEditor
        open={editor !== null}
        machine={editor === 'new' || editor === null ? undefined : editor}
        controller={controller}
        onClose={() => { setEditor(null) }}
        onSaved={() => { setEditor(null) }}
        t={t}
      />
      <TrustDialog
        machine={trustTarget?.machine ?? null}
        fingerprint={trustTarget?.fingerprint ?? null}
        busy={trusting}
        error={trustError}
        onClose={() => { setTrustTarget(null); setTrustError(null) }}
        onTrust={trust}
        t={t}
      />
    </div>
  )
}
