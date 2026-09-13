import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  RemoteMachineAuth, RemoteMachineSaveRequest, RemoteMachineView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  Button, IconGlobeOutline14, IconPlusOutline16, Menu, Modal, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsHooks, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-gateway/client'
import { parseRemoteExecutionPath, remoteExecutionPath } from '@deepseek-ai/dsh-remote-machines/path'
import type { RemoteMachineController, RemoteMachineSnapshot } from './remote-machine-store.ts'
import css from './RemoteMachines.module.css'

export interface RemoteMachineInjected {
  controller: RemoteMachineController
  hooks: {
    hostInfo: { getSnapshot: () => RemoteHostFacts; subscribe: (fn: () => void) => () => void }
    remoteMachines: { getSnapshot: () => RemoteMachineSnapshot; subscribe: (fn: () => void) => () => void }
  }
  createWorkspace: (path: string) => Promise<WorkspaceView>
  startSession: (workspaceId: WorkspaceView['workspaceId']) => void
}

type RemoteMachineHooks = PropsHooks<RemoteMachineInjected['hooks']>

export type RemoteMachinesSectionProps =
  PropsRuntime<'settings.section'>
  & InjectFace<RemoteMachineInjected>
  & RemoteMachineHooks
  & PropsLocale<'workspace'>

export type RemoteMachineControlProps =
  PropsRuntime<'conversation.input.machine'>
  & InjectFace<RemoteMachineInjected>
  & RemoteMachineHooks
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

export function ComputerIcon({ remote = false }: { remote?: boolean }) {
  return remote
    ? <IconGlobeOutline14 size={14} />
    : (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
        <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" stroke="currentColor" />
        <path d="M5 13.5h6M8 11v2.5" stroke="currentColor" strokeLinecap="round" />
      </svg>
    )
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
      className={css.dialog as string}
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

export function RemoteMachinesSection({ controller, useRemoteMachines, useWorkspaces, t }: RemoteMachinesSectionProps) {
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
        <Button icon={<IconPlusOutline16 />} onClick={() => { setEditor('new') }}>{t('remote.add')}</Button>
      </div>
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

export function RemoteMachineControl({
  locked, useSession, useWorkspaces, useHostInfo, useRemoteMachines, controller, createWorkspace, startSession, t,
}: RemoteMachineControlProps) {
  const sessionId = useSession(session => session.sessionId)
  const workspaces = useWorkspaces(value => value.items)
  const state = useRemoteMachines(value => value)
  const hostname = useHostInfo(info => info.hostname)
  const localLabel = hostname === undefined || hostname.length === 0 ? t('remote.local') : hostname
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

  useEffect(() => { if (state.status === 'idle') void controller.load() }, [controller, state.status])
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
    { id: 'add', label: t('remote.add'), icon: <IconPlusOutline16 /> },
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
      else if (local.workspaceId !== currentWorkspace?.workspaceId) startSession(local.workspaceId)
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
    if (!remotePath.startsWith('/')) {
      setError(t('remote.path.absolute'))
      return
    }
    if (target.auth === 'password-prompt' && connectionPassword.length === 0) {
      setError(t('remote.password.required'))
      return
    }
    setBusy(true)
    setError(null)
    const prepare = fingerprint === null
      ? controller.probe(target.id, target.auth === 'password-prompt' ? connectionPassword : undefined).then((probe) => {
        if (probe.platform === 'windows') throw new Error(t('remote.error.windowsUnsupported'))
        if (!probe.trusted) {
          setFingerprint(probe.fingerprint)
          throw new Error('trust-required')
        }
      })
      : controller.trust(target.id, fingerprint).then(() => {})
    void prepare.then(async () => {
      const workspace = await createWorkspace(remoteExecutionPath(target.id, remotePath))
      setBusy(false)
      setTarget(null)
      startSession(workspace.workspaceId)
    }, (reason: unknown) => {
      setBusy(false)
      if (reason instanceof Error && reason.message === 'trust-required') return
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const label = currentMachine?.name ?? localLabel
  return (
    <>
      <span className={css.controlWrap}>
        <Menu
          open={menuOpen}
          items={entries}
          selectedId={currentMachine?.id ?? 'local'}
          onSelect={select}
          onClose={() => { setMenuOpen(false) }}
          portal
          anchor={(
            <button
              type="button"
              className={css.control}
              aria-label={t('remote.target.aria', { name: label })}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={locked}
              onClick={() => { setMenuOpen(value => !value) }}
            >
              <ComputerIcon remote={currentMachine !== undefined} />
              <span>{label}</span>
            </button>
          )}
        />
        {error !== null && <span className={css.controlError} role="status" title={error}>!</span>}
      </span>
      <MachineEditor
        open={editorOpen}
        controller={controller}
        onClose={() => { setEditorOpen(false) }}
        onSaved={(machine) => {
          setEditorOpen(false)
          select(machine.id)
        }}
        t={t}
      />
      <Modal
        open={target !== null}
        onClose={busy ? () => {} : () => { setTarget(null); setFingerprint(null); setConnectionPassword(''); setError(null) }}
        closeLabel={t('remote.close')}
        title={target === null ? '' : t('remote.connect.title', { name: target.name })}
        description={t('remote.connect.description')}
        className={css.dialog as string}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={() => { setTarget(null) }}>{t('remote.cancel')}</Button>
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
          <input autoFocus value={path} placeholder={t('remote.path.placeholder')} onChange={(event) => { setPath(event.target.value); setFingerprint(null); setError(null) }} />
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
