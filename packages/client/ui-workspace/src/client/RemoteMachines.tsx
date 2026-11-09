/** Saved remote-machine management and the team-mode switch rendered in Settings. */
import { useEffect, useState, useMemo, type FormEvent } from 'react'
import type { RemoteMachineAuth, RemoteMachineSaveRequest, RemoteMachineView, RemoteMachineProbeValue } from '@deepseek-ai/dsh-remote-machines/types'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular,
  IconGlobeOutlineRegular, IconGoalOutlineRegular, IconPlusOutlineRegular, IconShieldOutlineRegular,
  Menu, Modal, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteMachineController, RemoteMachineSnapshot } from './remote-machine-store.ts'
import type { AgentMode } from './agent-mode.ts'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
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
  selectMode: (mode: AgentMode) => Promise<boolean>
  hooks: {
    agentMode: { getSnapshot: () => ConfigFormSnapshot<{ mode: AgentMode }>; subscribe: (fn: () => void) => () => void }
    remoteMachines: { getSnapshot: () => RemoteMachineSnapshot; subscribe: (fn: () => void) => () => void }
  }
  /** Adopt a machine-qualified path as a real Workspace. */
  createWorkspace: (path: string) => Promise<WorkspaceView>
}

const AGENT_MODES: readonly AgentMode[] = ['blue', 'red', 'black', 'dead']
const MODE_TRANSITION_MS = 1100
type AgentModeInjected = Pick<RemoteMachineInjected, 'selectMode'> & {
  hooks: Pick<RemoteMachineInjected['hooks'], 'agentMode'>
}

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
export function AgentModeControl({ useAgentMode, selectMode, t }: InjectFace<AgentModeInjected> & PropsLocale<'workspace'>) {
  const state = useAgentMode(value => value)
  const mode = state.value?.mode
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [transitioning, setTransitioning] = useState<AgentMode | null>(null)
  const label = mode === undefined ? t('agentMode.title') : t(`agentMode.${mode}`)
  const ActiveIcon = mode === undefined ? IconShieldOutlineRegular : AGENT_MODE_ICONS[mode]
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
        {...mode === undefined ? {} : { selectedId: mode }}
        autoFocus
        onSelect={(id) => {
          const next = id as AgentMode
          if (next !== mode) {
            setBusy(true)
            setError(null)
            void selectMode(next).then((accepted) => {
              if (accepted) setTransitioning(next)
              else setError(t('agentMode.failed'))
            }, (reason: unknown) => {
              setError(t('agentMode.error', { message: reason instanceof Error ? reason.message : String(reason) }))
            }).finally(() => { setBusy(false) })
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
            disabled={busy || state.status !== 'ready' || !state.writable || mode === undefined}
            onClick={() => { setOpen(value => !value) }}
          >
            <ActiveIcon size={14} />
            <span>{label}</span>
            {open ? <IconChevronUpOutlineRegular size={16} /> : <IconChevronDownOutlineRegular size={16} />}
          </button>
        )}
      />
      {error !== null && <span className={css.controlError} role="alert">{error}</span>}
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

function MachineEditor({ open, machine, saveMachine, onClose, onSaved, t }: {
  open: boolean
  machine?: RemoteMachineView | undefined
  saveMachine: (request: RemoteMachineSaveRequest) => Promise<RemoteMachineView>
  onClose: () => void
  onSaved: (machine: RemoteMachineView) => void
  t: RemoteMachinesSectionProps['t']
}) {
  const [draft, setDraft] = useState<MachineDraft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
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
    void saveMachine(request).then((saved) => {
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
        <div className={css.field}>
          <span>{t('remote.field.auth')}</span>
          <Menu open={authOpen} onClose={() => { setAuthOpen(false) }} portal autoFocus
            items={([
              ['agent', 'remote.auth.agent'], ['password', 'remote.auth.password'],
              ['password-prompt', 'remote.auth.passwordPrompt'], ['private-key', 'remote.auth.privateKey'],
            ] as const).map(([id, key]) => ({ id, label: t(key) }))}
            selectedId={draft.auth} onSelect={(id) => { field('auth')(id as RemoteMachineAuth); setAuthOpen(false) }}
            anchor={<button type="button" className={css.authTrigger} aria-label={t('remote.field.auth')}
              aria-haspopup="menu" aria-expanded={authOpen} disabled={saving} onClick={() => { setAuthOpen(value => !value) }}>
              <span>{t(({ agent: 'remote.auth.agent', password: 'remote.auth.password', 'password-prompt': 'remote.auth.passwordPrompt', 'private-key': 'remote.auth.privateKey' } as const)[draft.auth])}</span>
              <IconChevronDownOutlineRegular size={16} />
            </button>} />
        </div>
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
export function RemoteMachinesSection({
  controller, selectMode, useAgentMode, useRemoteMachines, useWorkspaces, t,
}: RemoteMachinesSectionProps) {
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
      <AgentModeControl useAgentMode={useAgentMode} selectMode={selectMode} t={t} />
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
        saveMachine={request => controller.save(request)}
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

/** Composer machine navigation callbacks and redacted roster facts. */
export interface MachineControlInjected {
  hooks: {
    hostInfo: { getSnapshot: () => RemoteHostFacts; subscribe: (fn: () => void) => () => void }
    remoteMachines: { getSnapshot: () => RemoteMachineSnapshot; subscribe: (fn: () => void) => () => void }
  }
  loadMachines: () => Promise<void>
  saveMachine: (request: RemoteMachineSaveRequest) => Promise<RemoteMachineView>
  probeMachine: (id: string, password?: string) => Promise<RemoteMachineProbeValue>
  trustMachine: (id: string, fingerprint: string) => Promise<RemoteMachineView>
  createWorkspace: (path: string) => Promise<WorkspaceView>
  openWorkspace: (workspaceId: WorkspaceView['workspaceId']) => Promise<void>
}
type RemoteMachineControlProps = PropsRuntime<'conversation.input.left'> & InjectFace<MachineControlInjected> & PropsLocale<'workspace'>

/** Choose a machine and open a Workspace without relocating the current Session. */
export function RemoteMachineControl({
  useSession, useWorkspaces, useHostInfo, useRemoteMachines, loadMachines, saveMachine, probeMachine, trustMachine,
  createWorkspace, openWorkspace, t,
}: RemoteMachineControlProps) {
  const sessionId = useSession(session => session.sessionId)
  const workspaces = useWorkspaces(value => value.items)
  const state = useRemoteMachines(value => value)
  const localLabel = useHostInfo(info => info.hostname)?.trim() || t('remote.local')
  const currentWorkspace = workspaces.find(workspace => workspace.sessionIds.includes(sessionId))
  const currentRemote = currentWorkspace === undefined ? undefined : parseRemoteExecutionPath(currentWorkspace.path)
  const currentMachine = state.machines.find(machine => machine.id === currentRemote?.machineId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [target, setTarget] = useState<RemoteMachineView | null>(null)
  const [path, setPath] = useState('')
  const [connectionPassword, setConnectionPassword] = useState('')
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (state.status === 'idle') void loadMachines() }, [loadMachines, state.status])
  const targetWorkspaces = useMemo(() => target === null
    ? []
    : workspaces.filter(workspace => parseRemoteExecutionPath(workspace.path)?.machineId === target.id), [target, workspaces])

  const entries: MenuEntry[] = [
    { id: 'local', label: localLabel, icon: <ComputerIcon /> },
    ...(state.machines.length === 0
      ? []
      : [
        { type: 'separator' as const, id: 'remote-separator' },
        { type: 'label' as const, id: 'remote-label', text: t('remote.saved') },
        ...state.machines.map(machine => ({ id: machine.id, label: machine.name, icon: <ComputerIcon remote /> })),
      ]),
    { type: 'separator' as const, id: 'add-separator' },
    { id: 'add', label: t('remote.add'), icon: <IconPlusOutlineRegular /> },
  ]

  const select = (id: string): void => {
    setMenuOpen(false)
    setError(null)
    if (id === 'add') {
      setEditorOpen(true)
      return
    }
    if (id === 'local') {
      const local = workspaces.find(workspace => parseRemoteExecutionPath(workspace.path) === undefined)
      if (local === undefined) setError(t('remote.local.missing'))
      else if (local.workspaceId !== currentWorkspace?.workspaceId) {
        void openWorkspace(local.workspaceId).catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : String(reason))
        })
      }
      return
    }
    const machine = state.machines.find(candidate => candidate.id === id)
    if (machine === undefined) return
    setTarget(machine)
    setPath(machine.defaultPath ?? '')
    setConnectionPassword('')
    setFingerprint(null)
  }

  const connect = (remotePath = path): void => {
    if (target === null) return
    if (remotePath.length > 0 && !remotePath.startsWith('/')) {
      setError(t('remote.path.absolute'))
      return
    }
    if (target.auth === 'password-prompt' && connectionPassword.length === 0) {
      setError(t('remote.password.required'))
      return
    }
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        let resolvedPath = remotePath
        if (fingerprint === null) {
          const probe = await probeMachine(target.id, target.auth === 'password-prompt' ? connectionPassword : undefined)
          if (probe.platform === 'windows') throw new Error(t('remote.error.windowsUnsupported'))
          resolvedPath = remotePath || probe.home || ''
          if (!resolvedPath.startsWith('/')) throw new Error(t('remote.path.absolute'))
          if (!probe.trusted) {
            setPath(resolvedPath)
            setFingerprint(probe.fingerprint)
            return
          }
        } else await trustMachine(target.id, fingerprint)
        const workspace = await createWorkspace('/__dsh_ssh__/' + target.id + resolvedPath)
        await openWorkspace(workspace.workspaceId)
        setTarget(null)
        setConnectionPassword('')
        setFingerprint(null)
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally { setBusy(false) }
    })()
  }

  const label = currentMachine?.name ?? currentRemote?.machineId ?? localLabel
  return (
    <>
      <span className={css.controlWrap}>
        <Menu
          open={menuOpen}
          side="top"
          items={entries}
          selectedId={currentMachine?.id ?? 'local'}
          onSelect={select}
          onClose={() => { setMenuOpen(false) }}
          portal
          autoFocus
          anchor={(
            <button
              type="button"
              className={css.control}
              data-active="true"
              aria-label={t('remote.target.aria', { name: label })}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={busy}
              onClick={() => { setMenuOpen(value => !value) }}
            >
              <ComputerIcon remote={currentRemote !== undefined} />
              <span>{label}</span>
              {menuOpen ? <IconChevronUpOutlineRegular size={16} /> : <IconChevronDownOutlineRegular size={16} />}
            </button>
          )}
        />
        {state.status === 'error' && <button type="button" className={css.controlError} onClick={() => { void loadMachines() }} title={state.error ?? undefined}>{t('remote.retry')}</button>}
        {error !== null && target === null && <span className={css.controlError} role="alert">{error}</span>}
      </span>
      <MachineEditor
        open={editorOpen}
        saveMachine={saveMachine}
        onClose={() => { setEditorOpen(false) }}
        onSaved={(machine) => {
          setEditorOpen(false)
          setTarget(machine)
          setPath(machine.defaultPath ?? '')
          setFingerprint(null)
          setConnectionPassword('')
          setError(null)
        }}
        t={t}
      />
      <Modal
        open={target !== null}
        onClose={busy ? () => {} : () => { setTarget(null); setFingerprint(null); setConnectionPassword(''); setError(null) }}
        closeLabel={t('remote.close')}
        title={target === null ? '' : t('remote.connect.title', { name: target.name })}
        description={t('remote.connect.description')}
        {...css.dialog === undefined ? {} : { className: css.dialog }}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={() => { setTarget(null); setConnectionPassword(''); setFingerprint(null); setError(null) }}>{t('remote.cancel')}</Button>
            <Button disabled={busy} onClick={() => { connect() }}>
              {t(busy ? 'remote.connecting' : fingerprint === null ? 'remote.connect' : 'remote.trustConnect')}
            </Button>
          </>
        )}
      >
        {target?.auth === 'password-prompt' && (
          <label className={css.field}>
            <span>{t('remote.field.password')}</span>
            <input
              type="password"
              autoComplete="current-password"
              aria-label={t('remote.field.password')}
              disabled={busy}
              value={connectionPassword}
              onChange={(event) => { setConnectionPassword(event.target.value); setFingerprint(null); setError(null) }}
            />
            <small>{t('remote.password.memoryOnly')}</small>
          </label>
        )}
        {targetWorkspaces.length > 0 && (
          <div className={css.existing}>
            <span>{t('remote.existing')}</span>
            {targetWorkspaces.map((workspace) => {
              const remote = parseRemoteExecutionPath(workspace.path)
              return (
                <button
                  type="button"
                  key={workspace.workspaceId}
                  disabled={busy || remote === undefined}
                  onClick={() => {
                    if (remote === undefined) return
                    setPath(remote.path)
                    setFingerprint(null)
                    connect(remote.path)
                  }}
                >
                  {workspace.title}
                </button>
              )
            })}
          </div>
        )}
        <label className={css.field}>
          <span>{t('remote.field.path')}</span>
          <input autoFocus value={path} disabled={busy} placeholder={t('remote.path.placeholder')}
            onChange={(event) => { setPath(event.target.value); setFingerprint(null); setError(null) }} />
        </label>
        {fingerprint !== null && (
          <div className={css.trustInline}>
            <strong>{t('remote.trust.verify')}</strong>
            <code className={css.fingerprint}>{fingerprint}</code>
          </div>
        )}
        {error !== null && <p className={css.error} role="alert">{error}</p>}
      </Modal>
    </>
  )
}
