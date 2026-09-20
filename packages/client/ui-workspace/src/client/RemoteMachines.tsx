import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import type {
  ControlPentestTaskRequest, CreatePentestRunRequest, PentestLoopStartRequest, PentestRunRecord,
  PentestRunSnapshot, RemoteMachineAuth, RemoteMachineSaveRequest, RemoteMachineView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  Button, IconDownloadOutline16, IconGlobeOutline14, IconGoalOutline16, IconListPenOutline16,
  IconPlusOutline16, IconShieldOutline16, Menu, Modal, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsHooks, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-gateway/client'
import { parseRemoteExecutionPath, remoteExecutionPath } from '@deepseek-ai/dsh-remote-machines/path'
import type { RemoteMachineController, RemoteMachineSnapshot } from './remote-machine-store.ts'
import type { AgentMode, AgentModeController } from './agent-mode.ts'
import {
  createPentestReport, downloadPentestReport, formatPentestReportMarkdown,
  type PentestReportLabels,
} from './pentest-report.ts'
import css from './RemoteMachines.module.css'

export interface RemoteMachineInjected {
  controller: RemoteMachineController
  agentMode: AgentModeController
  hooks: {
    hostInfo: { getSnapshot: () => RemoteHostFacts; subscribe: (fn: () => void) => () => void }
    remoteMachines: { getSnapshot: () => RemoteMachineSnapshot; subscribe: (fn: () => void) => () => void }
  }
  createWorkspace: (path: string) => Promise<WorkspaceView>
  startSession: (workspaceId: WorkspaceView['workspaceId']) => void
  listPentestRuns: () => Promise<readonly PentestRunRecord[]>
  loadPentestRun: (runId: string) => Promise<PentestRunSnapshot>
  controlPentestRun: (runId: string, action: 'pause' | 'resume' | 'terminate') => Promise<PentestRunRecord>
  controlPentestTask: (taskId: string, request: ControlPentestTaskRequest) => Promise<void>
  replacePentestScope: (
    runId: string, authorizedTargets: readonly string[], excludedTargets: readonly string[],
  ) => Promise<PentestRunRecord>
  createPentestRun: (request: CreatePentestRunRequest) => Promise<PentestRunRecord>
  startPentestLoop: (runId: string, request: PentestLoopStartRequest) => Promise<void>
  stopPentestLoop: (runId: string) => Promise<void>
  listRunningPentestLoops: () => Promise<readonly string[]>
}

const AGENT_MODES: readonly AgentMode[] = ['blue', 'red', 'black']
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

const AGENT_MODE_ICONS = {
  blue: IconShieldOutline16,
  red: IconGoalOutline16,
  black: BlackTeamIcon,
} satisfies Record<AgentMode, typeof IconShieldOutline16>

function AgentModeControl({ controller, locked, t }: {
  controller: AgentModeController
  locked: boolean
  t: RemoteMachineControlProps['t']
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
        items={AGENT_MODES.map((value) => {
          const Icon = AGENT_MODE_ICONS[value]
          return { id: value, label: t(`agentMode.${value}`), icon: <Icon size={14} /> }
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

function scopeValues(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))]
}

type PttNode = PentestRunSnapshot['ptt'][number]

interface PentestRunDraft {
  readonly objective: string
  readonly mode: 'blue' | 'red' | 'black'
  readonly authorized: string
  readonly excluded: string
  readonly startsAt: string
  readonly endsAt: string
}

function localDateTime(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function emptyRunDraft(): PentestRunDraft {
  const now = new Date()
  return {
    objective: '', mode: 'red', authorized: '', excluded: '',
    startsAt: localDateTime(now), endsAt: localDateTime(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
  }
}

function pentestReportLabels(t: RemoteMachineControlProps['t']): PentestReportLabels {
  return {
    status: t('runs.report.status'), mode: t('runs.report.mode'), runId: t('runs.report.runId'),
    createdAt: t('runs.report.createdAt'), updatedAt: t('runs.report.updatedAt'),
    scope: t('runs.scope'), authorizedTargets: t('runs.report.authorizedTargets'),
    excludedTargets: t('runs.report.excludedTargets'), overview: t('runs.report.overview'),
    coverage: t('runs.coverage'), tasks: t('runs.tasks'), findings: t('runs.findings'),
    observations: t('runs.report.observations'), evidence: t('runs.evidence'),
    diagnostics: t('runs.report.diagnostics'),
    graph: t('runs.graph'), episodes: t('runs.episodes'), tokens: t('runs.tokens'),
    cost: t('runs.cost'), target: t('runs.report.target'),
    evidenceReferences: t('runs.report.evidenceReferences'), none: t('runs.report.none'),
    noFindings: t('runs.report.noFindings'), noObservations: t('runs.report.noObservations'),
    noDiagnostics: t('runs.report.noDiagnostics'),
    noEvidence: t('runs.report.noEvidence'),
  }
}

function PentestReportView({ snapshot, t }: {
  snapshot: PentestRunSnapshot
  t: RemoteMachineControlProps['t']
}) {
  const report = createPentestReport(snapshot)
  const labels = pentestReportLabels(t)
  const baseName = `pentest-${snapshot.run.id}`
  return (
    <div className={css.reportView}>
      <div className={css.reportActions}>
        <Button size="sm" variant="outline" onClick={() => {
          downloadPentestReport(
            `${baseName}.md`, formatPentestReportMarkdown(report, labels), 'text/markdown;charset=utf-8',
          )
        }}>
          <IconDownloadOutline16 size={14} />
          {t('runs.report.export.markdown')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => {
          downloadPentestReport(
            `${baseName}.json`, `${JSON.stringify(report, null, 2)}\n`, 'application/json;charset=utf-8',
          )
        }}>
          <IconDownloadOutline16 size={14} />
          {t('runs.report.export.json')}
        </Button>
      </div>
      <h4>{t('runs.report.overview')}</h4>
      <dl className={css.runStats}>
        <div><dt>{t('runs.coverage')}</dt><dd>{report.summary.coveredPhases}/{report.summary.totalPhases}</dd></div>
        <div><dt>{t('runs.tasks')}</dt><dd>{report.summary.completedTasks}/{report.summary.totalTasks}</dd></div>
        <div><dt>{t('runs.findings')}</dt><dd>{report.summary.verifiedFindings}/{report.summary.totalFindings}</dd></div>
        <div><dt>{t('runs.evidence')}</dt><dd>{report.summary.evidence}</dd></div>
        <div><dt>{t('runs.graph')}</dt><dd>{report.summary.graphNodes}/{report.summary.graphEdges}</dd></div>
        <div><dt>{t('runs.episodes')}</dt><dd>{report.summary.episodes}</dd></div>
      </dl>
      <h4>{t('runs.scope')}</h4>
      <div className={css.reportColumns}>
        <section>
          <h5>{t('runs.report.authorizedTargets')}</h5>
          {report.run.authorizedTargets.length === 0
            ? <p>{t('runs.report.none')}</p>
            : <ul>{report.run.authorizedTargets.map(target => <li key={target}>{target}</li>)}</ul>}
        </section>
        <section>
          <h5>{t('runs.report.excludedTargets')}</h5>
          {report.run.excludedTargets.length === 0
            ? <p>{t('runs.report.none')}</p>
            : <ul>{report.run.excludedTargets.map(target => <li key={target}>{target}</li>)}</ul>}
        </section>
      </div>
      <h4>{t('runs.coverage')}</h4>
      <ol className={css.reportRecords}>
        {report.coverage.map(phase => (
          <li key={phase.kind}>
            <strong>{phase.kind}</strong>
            <span>{phase.goal}</span>
            <small>{phase.status}</small>
          </li>
        ))}
      </ol>
      <h4>{t('runs.findings')}</h4>
      {report.findings.length === 0
        ? <p className={css.muted}>{t('runs.report.noFindings')}</p>
        : (
          <ol className={css.reportRecords}>
            {report.findings.map(finding => (
              <li key={finding.id}>
                <strong>{finding.title}</strong>
                <span>{finding.target ?? t('runs.report.none')}</span>
                <small>{finding.status} · {finding.evidenceIds.length} {t('runs.evidence')}</small>
              </li>
            ))}
          </ol>
        )}
      <h4>{t('runs.report.observations')}</h4>
      {report.observations.length === 0
        ? <p className={css.muted}>{t('runs.report.noObservations')}</p>
        : (
          <ol className={css.reportRecords}>
            {report.observations.map(observation => (
              <li key={observation.id}>
                <strong>{observation.summary}</strong>
                <small>{observation.verdict ?? t('runs.report.none')}</small>
              </li>
            ))}
          </ol>
        )}
      <h4>{t('runs.evidence')}</h4>
      {report.evidence.length === 0
        ? <p className={css.muted}>{t('runs.report.noEvidence')}</p>
        : (
          <ol className={css.reportRecords}>
            {report.evidence.map(evidence => (
              <li key={evidence.id}>
                <strong>{evidence.summary}</strong>
                <span>{evidence.reference}</span>
                <small>{evidence.kind}</small>
              </li>
            ))}
          </ol>
        )}
      <h4>{t('runs.report.diagnostics')}</h4>
      {report.diagnostics.length === 0
        ? <p className={css.muted}>{t('runs.report.noDiagnostics')}</p>
        : (
          <ol className={css.reportRecords}>
            {report.diagnostics.map(diagnostic => (
              <li key={diagnostic.toolCallId}>
                <strong>{diagnostic.code}</strong>
                <span>{diagnostic.message}</span>
                <small>{diagnostic.tool}</small>
              </li>
            ))}
          </ol>
        )}
    </div>
  )
}

function PentestRunsControl({
  listRuns, loadRun, controlRun, controlTask, replaceScope, createRun, startLoop, stopLoop, listRunning, execution, t,
}: {
  listRuns: RemoteMachineInjected['listPentestRuns']
  loadRun: RemoteMachineInjected['loadPentestRun']
  controlRun: RemoteMachineInjected['controlPentestRun']
  controlTask: RemoteMachineInjected['controlPentestTask']
  replaceScope: RemoteMachineInjected['replacePentestScope']
  createRun: RemoteMachineInjected['createPentestRun']
  startLoop: RemoteMachineInjected['startPentestLoop']
  stopLoop: RemoteMachineInjected['stopPentestLoop']
  listRunning: RemoteMachineInjected['listRunningPentestLoops']
  execution?: { readonly machineId: string; readonly workspaceId: string; readonly cwd: string }
  t: RemoteMachineControlProps['t']
}) {
  const [open, setOpen] = useState(false)
  const [runs, setRuns] = useState<readonly PentestRunRecord[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<PentestRunSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [terminatePending, setTerminatePending] = useState(false)
  const [authorizedScope, setAuthorizedScope] = useState('')
  const [excludedScope, setExcludedScope] = useState('')
  const [runningIds, setRunningIds] = useState<readonly string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [detailView, setDetailView] = useState<'operations' | 'report'>('operations')
  const [draft, setDraft] = useState<PentestRunDraft>(emptyRunDraft)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setRuns(null)
    setSnapshot(null)
    setError(null)
    void listRuns().then((items) => {
      if (!active) return
      setRuns(items)
      setSelectedId(current => items.some(run => run.id === current) ? current : items[0]?.id ?? null)
    }, (reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [listRuns, open])

  useEffect(() => {
    if (!open || selectedId === null) return
    let active = true
    setSnapshot(null)
    setDetailView('operations')
    setError(null)
    void loadRun(selectedId).then((value) => {
      if (active) {
        setSnapshot(value)
        setAuthorizedScope(value.run.authorizedTargets.join('\n'))
        setExcludedScope(value.run.excludedTargets.join('\n'))
      }
    }, (reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [loadRun, open, selectedId])

  useEffect(() => {
    if (!open) return
    let active = true
    void listRunning().then((ids) => {
      if (active) setRunningIds(ids)
    }, () => {
      if (active) setRunningIds([])
    })
    return () => { active = false }
  }, [listRunning, open, snapshot])

  const refreshRunning = (): void => {
    void listRunning().then((ids) => { setRunningIds(ids) }, () => { setRunningIds([]) })
  }

  const covered = snapshot?.coverage.phases.filter(phase => phase.status === 'covered').length ?? 0
  const completedTasks = snapshot?.tasks.filter(task => task.status === 'done').length ?? 0
  const verifiedFindings = snapshot?.findings.filter(finding =>
    finding.status === 'verified' || finding.status === 'reported').length ?? 0
  const pausedBranches = snapshot?.branches.filter(branch => branch.status === 'paused') ?? []
  const scopeDiagnostics = snapshot?.toolCalls.flatMap(call => call.diagnostic === undefined ? [] : [call.diagnostic]) ?? []
  const loopRunning = snapshot !== null && runningIds.includes(snapshot.run.id)
  const applyRunAction = (action: 'pause' | 'resume' | 'terminate'): void => {
    if (snapshot === null) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        await controlRun(snapshot.run.id, action)
        const next = await loadRun(snapshot.run.id)
        setSnapshot(next)
        setRuns(current => current?.map(run => run.id === next.run.id ? next.run : run) ?? null)
        setTerminatePending(false)
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setBusy(false)
        refreshRunning()
      }
    })()
  }
  const applyTaskAction = (taskId: string, request: ControlPentestTaskRequest): void => {
    if (snapshot === null) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        await controlTask(taskId, request)
        setSnapshot(await loadRun(snapshot.run.id))
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setBusy(false)
      }
    })()
  }
  const applyScope = (): void => {
    if (snapshot === null) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        await replaceScope(snapshot.run.id, scopeValues(authorizedScope), scopeValues(excludedScope))
        const next = await loadRun(snapshot.run.id)
        setSnapshot(next)
        setRuns(current => current?.map(run => run.id === next.run.id ? next.run : run) ?? null)
        setAuthorizedScope(next.run.authorizedTargets.join('\n'))
        setExcludedScope(next.run.excludedTargets.join('\n'))
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setBusy(false)
      }
    })()
  }
  const applyLoopStart = (): void => {
    if (snapshot === null) return
    setBusy(true)
    setError(null)
    void startLoop(snapshot.run.id, {}).then(() => {
      refreshRunning()
    }, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setBusy(false) })
  }
  const applyLoopStop = (): void => {
    if (snapshot === null) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        await stopLoop(snapshot.run.id)
        setSnapshot(await loadRun(snapshot.run.id))
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setBusy(false)
        refreshRunning()
      }
    })()
  }
  const submitCreate = (event: FormEvent): void => {
    event.preventDefault()
    if (execution === undefined) {
      setCreateError(t('runs.execution.required'))
      return
    }
    setBusy(true)
    setCreateError(null)
    void (async () => {
      try {
        const run = await createRun({
          objective: draft.objective,
          mode: draft.mode,
          authorizedTargets: scopeValues(draft.authorized),
          excludedTargets: scopeValues(draft.excluded),
          testWindow: {
            startsAt: new Date(draft.startsAt).toISOString(), endsAt: new Date(draft.endsAt).toISOString(),
          },
          execution,
        })
        setRuns(current => [...current ?? [], run])
        setSelectedId(run.id)
        setCreateOpen(false)
        setDraft(emptyRunDraft())
      } catch (reason: unknown) {
        setCreateError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setBusy(false)
      }
    })()
  }

  const childNodes = (parentId: string): readonly PttNode[] =>
    (snapshot?.ptt ?? []).filter(node => node.parentTaskId === parentId)
  const renderPttNode = (node: PttNode): ReactNode => {
    const children = childNodes(node.id)
    const hypothesis = snapshot?.hypotheses.find(record => record.taskId === node.id)
    return (
      <li key={node.id}>
        <div className={css.pttNode}>
          <div className={css.pttRow}>
            <span>{node.objective}</span>
            <small>
              {t('runs.task.summary', {
                kind: node.kind,
                status: node.status,
                priority: node.priority,
                strategy: node.strategyClass === undefined ? '' : ` · ${node.strategyClass}`,
              })}
            </small>
          </div>
          <div className={css.pttActions}>
            {(node.status === 'pending' || node.status === 'ready') && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t('runs.priority.down', { task: node.objective })}
                  onClick={() => { applyTaskAction(node.id, { action: 'reprioritize', priority: node.priority - 1 }) }}
                >−</button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t('runs.priority.up', { task: node.objective })}
                  onClick={() => { applyTaskAction(node.id, { action: 'reprioritize', priority: node.priority + 1 }) }}
                >+</button>
                <button type="button" disabled={busy} onClick={() => { applyTaskAction(node.id, { action: 'block' }) }}>
                  {t('runs.block')}
                </button>
              </>
            )}
            {node.status === 'blocked' && (
              <>
                <button type="button" disabled={busy} onClick={() => { applyTaskAction(node.id, { action: 'approve' }) }}>
                  {t('runs.approve')}
                </button>
                <button type="button" disabled={busy} onClick={() => { applyTaskAction(node.id, { action: 'reject' }) }}>
                  {t('runs.reject')}
                </button>
              </>
            )}
          </div>
        </div>
        {node.hypothesis !== undefined && (
          <details className={css.pttContract}>
            <summary>{t('runs.contract')}</summary>
            <dl>
              <div><dt>{t('runs.hypothesis')}</dt><dd>{node.hypothesis}</dd></div>
              <div><dt>{t('runs.expectedSignal')}</dt><dd>{node.expectedSignal}</dd></div>
              <div><dt>{t('runs.refutingSignal')}</dt><dd>{node.refutingSignal}</dd></div>
              {hypothesis !== undefined && (
                <>
                  <div><dt>{t('runs.confidence')}</dt><dd>{Math.round(hypothesis.confidence * 100)}%</dd></div>
                  <div>
                    <dt>{t('runs.evaluation')}</dt>
                    <dd>{hypothesis.status}{hypothesis.evaluationReason === undefined ? '' : `: ${hypothesis.evaluationReason}`}</dd>
                  </div>
                </>
              )}
            </dl>
          </details>
        )}
        {children.length > 0 && (
          <ol className={css.pttChildren}>{children.map(child => renderPttNode(child))}</ol>
        )}
      </li>
    )
  }

  return (
    <>
      <button type="button" className={css.control} aria-label={t('runs.aria')} onClick={() => { setOpen(true) }}>
        <IconListPenOutline16 size={14} />
        <span>{t('runs.label')}</span>
      </button>
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        closeLabel={t('remote.close')}
        title={t('runs.title')}
        description={t('runs.description')}
        className={css.runsDialog as string}
        contentClassName={css.runsContent as string}
      >
        {error !== null && <p className={css.error} role="alert">{error}</p>}
        {runs === null && error === null && <p className={css.muted}>{t('runs.loading')}</p>}
        {runs?.length === 0 && <p className={css.empty}>{t('runs.empty')}</p>}
        {runs !== null && runs.length > 0 && (
          <div className={css.runsDashboard}>
            <nav className={css.runsList} aria-label={t('runs.list')}>
              <Button size="sm" variant="outline" onClick={() => {
                setCreateError(null); setDraft(emptyRunDraft()); setCreateOpen(true)
              }}>
                {t('runs.new')}
              </Button>
              {runs.map(run => (
                <button
                  type="button"
                  key={run.id}
                  className={run.id === selectedId ? css.runSelected : undefined}
                  onClick={() => { setSelectedId(run.id) }}
                >
                  <strong>{run.objective}</strong>
                  <span>{t(`agentMode.${run.mode}`)} · {run.status}</span>
                </button>
              ))}
            </nav>
            <section className={css.runDetail} aria-live="polite">
              {snapshot === null && error === null && <p className={css.muted}>{t('runs.loading')}</p>}
              {snapshot !== null && (
                <>
                  <div className={css.runHeading}>
                    <div>
                      <h3>{snapshot.run.objective}</h3>
                      <span>{t(`agentMode.${snapshot.run.mode}`)} · {snapshot.run.status}</span>
                    </div>
                    <code>{snapshot.run.id}</code>
                  </div>
                  <div className={css.runViewTabs} role="group" aria-label={t('runs.view.aria')}>
                    <button
                      type="button"
                      aria-pressed={detailView === 'operations'}
                      onClick={() => { setDetailView('operations') }}
                    >
                      {t('runs.view.operations')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={detailView === 'report'}
                      onClick={() => { setDetailView('report') }}
                    >
                      {t('runs.view.report')}
                    </button>
                  </div>
                  <div hidden={detailView !== 'operations'}>
                    {(snapshot.run.status === 'active' || snapshot.run.status === 'paused') && (
                      <div className={css.runActions}>
                        {snapshot.run.status === 'active' && (loopRunning
                          ? (
                            <Button size="sm" variant="outline" disabled={busy} onClick={applyLoopStop}>
                              {t('runs.stop')}
                            </Button>
                          )
                          : (
                            <Button size="sm" variant="outline" disabled={busy} onClick={applyLoopStart}>
                              {t('runs.start')}
                            </Button>
                          ))}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => { applyRunAction(snapshot.run.status === 'active' ? 'pause' : 'resume') }}
                        >
                          {t(snapshot.run.status === 'active' ? 'runs.pause' : 'runs.resume')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={css.danger}
                          disabled={busy}
                          onClick={() => { setTerminatePending(true) }}
                        >
                          {t('runs.terminate')}
                        </Button>
                      </div>
                    )}
                    <dl className={css.runStats}>
                      <div><dt>{t('runs.coverage')}</dt><dd>{covered}/{snapshot.coverage.phases.length}</dd></div>
                      <div><dt>{t('runs.tasks')}</dt><dd>{completedTasks}/{snapshot.tasks.length}</dd></div>
                      <div><dt>{t('runs.findings')}</dt><dd>{verifiedFindings}/{snapshot.findings.length}</dd></div>
                      <div><dt>{t('runs.evidence')}</dt><dd>{snapshot.evidence.length}</dd></div>
                      <div><dt>{t('runs.graph')}</dt><dd>{snapshot.graphNodes.length}/{snapshot.graphEdges.length}</dd></div>
                      <div><dt>{t('runs.episodes')}</dt><dd>{snapshot.episodes.length}</dd></div>
                      <div><dt>{t('runs.branches')}</dt><dd>{pausedBranches.length}/{snapshot.branches.length}</dd></div>
                      <div><dt>{t('runs.artifacts')}</dt><dd>{snapshot.artifacts.length}</dd></div>
                      <div><dt>{t('runs.tokens')}</dt><dd>{snapshot.usage.totalTokens.toLocaleString()}</dd></div>
                      <div><dt>{t('runs.cost')}</dt><dd>{snapshot.usage.pricedEpisodes === 0 ? '—' : `$${snapshot.usage.costUsd.toFixed(4)}`}</dd></div>
                    </dl>
                    <h4>{t('runs.scope')}</h4>
                    <div className={css.scopeEditor}>
                      <label className={css.field}>
                        <span>{t('runs.scope.authorized')}</span>
                        <textarea
                          rows={3}
                          value={authorizedScope}
                          disabled={busy || (snapshot.run.status !== 'active' && snapshot.run.status !== 'paused')}
                          onChange={(event) => { setAuthorizedScope(event.target.value) }}
                        />
                      </label>
                      <label className={css.field}>
                        <span>{t('runs.scope.excluded')}</span>
                        <textarea
                          rows={3}
                          value={excludedScope}
                          disabled={busy || (snapshot.run.status !== 'active' && snapshot.run.status !== 'paused')}
                          onChange={(event) => { setExcludedScope(event.target.value) }}
                        />
                      </label>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || (snapshot.run.status !== 'active' && snapshot.run.status !== 'paused')}
                        onClick={applyScope}
                      >
                        {t('runs.scope.save')}
                      </Button>
                    </div>
                    {snapshot.convergence.warnings.length > 0 && (
                      <div className={css.runWarnings}>
                        <strong>{t('runs.warnings')}</strong>
                        {snapshot.convergence.warnings.map(warning => <span key={warning.code}>{warning.message}</span>)}
                      </div>
                    )}
                    {scopeDiagnostics.length > 0 && (
                      <div className={css.runWarnings}>
                        <strong>{t('runs.report.diagnostics')}</strong>
                        {scopeDiagnostics.map((diagnostic, index) => (
                          <span key={`${diagnostic.code}:${index}`}>{diagnostic.message}</span>
                        ))}
                      </div>
                    )}
                    {pausedBranches.length > 0 && (
                      <div className={css.runWarnings}>
                        <strong>{t('runs.pausedBranches')}</strong>
                        {pausedBranches.map(branch => (
                          <span key={branch.rootTaskId}>
                            {branch.rootTaskId}: {branch.noProgress
                              ? t('runs.noProgress')
                              : branch.exceeded.join(', ')}
                            {branch.strategyClass === undefined ? '' : ` · ${branch.strategyClass}`}
                            {branch.strategyMutationOfTaskId === undefined
                              ? '' : ` ← ${branch.strategyMutationOfTaskId}`}
                          </span>
                        ))}
                      </div>
                    )}
                    <h4>{t('runs.ptt')}</h4>
                    {snapshot.ptt.length === 0
                      ? <p className={css.muted}>{t('runs.noTasks')}</p>
                      : (
                        <ol className={css.ptt}>
                          {snapshot.ptt.filter(node => node.parentTaskId === undefined).map(root => renderPttNode(root))}
                        </ol>
                      )}
                    {snapshot.operatorDecisions.length > 0 && (
                      <>
                        <h4 className={css.decisionsHeading}>{t('runs.decisions')}</h4>
                        <ol className={css.decisions}>
                          {[...snapshot.operatorDecisions].reverse().slice(0, 8).map(decision => (
                            <li key={decision.id}>
                              <strong>{decision.action.replaceAll('_', ' ')}</strong>
                              <span>{decision.summary}</span>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                    {snapshot.events.length > 0 && (
                      <>
                        <h4 className={css.decisionsHeading}>{t('runs.events')}</h4>
                        <ol className={css.decisions}>
                          {[...snapshot.events].reverse().slice(0, 12).map(event => (
                            <li key={event.id}>
                              <strong>{event.kind.replaceAll('_', ' ')}</strong>
                              <span>{event.summary}</span>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                  </div>
                  {detailView === 'report' && <PentestReportView snapshot={snapshot} t={t} />}
                </>
              )}
            </section>
          </div>
        )}
      </Modal>
      <Modal
        open={createOpen}
        onClose={busy ? () => {} : () => { setCreateOpen(false) }}
        closeLabel={t('remote.close')}
        title={t('runs.new.title')}
        description={t('runs.new.description')}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={() => { setCreateOpen(false) }}>{t('remote.cancel')}</Button>
            <Button
              type="submit"
              form="pentest-run-form"
              disabled={busy || draft.objective.trim().length === 0 || scopeValues(draft.authorized).length === 0
                || Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)}
            >
              {t(busy ? 'runs.creating' : 'runs.new.submit')}
            </Button>
          </>
        )}
      >
        <form id="pentest-run-form" className={css.form} onSubmit={submitCreate}>
          <label className={css.field}>
            <span>{t('runs.new.objective')}</span>
            <input
              required
              value={draft.objective}
              onChange={(event) => { setDraft(current => ({ ...current, objective: event.target.value })) }}
            />
          </label>
          <label className={css.field}>
            <span>{t('runs.new.mode')}</span>
            <select
              value={draft.mode}
              onChange={(event) => { setDraft(current => ({ ...current, mode: event.target.value as PentestRunDraft['mode'] })) }}
            >
              {AGENT_MODES.map(mode => <option key={mode} value={mode}>{t(`agentMode.${mode}`)}</option>)}
            </select>
          </label>
          <label className={css.field}>
            <span>{t('runs.new.startsAt')}</span>
            <input
              type="datetime-local"
              required
              value={draft.startsAt}
              onChange={(event) => { setDraft(current => ({ ...current, startsAt: event.target.value })) }}
            />
          </label>
          <label className={css.field}>
            <span>{t('runs.new.endsAt')}</span>
            <input
              type="datetime-local"
              required
              value={draft.endsAt}
              onChange={(event) => { setDraft(current => ({ ...current, endsAt: event.target.value })) }}
            />
          </label>
          <label className={css.field}>
            <span>{t('runs.new.authorized')}</span>
            <textarea
              rows={3}
              required
              value={draft.authorized}
              onChange={(event) => { setDraft(current => ({ ...current, authorized: event.target.value })) }}
            />
          </label>
          <label className={css.field}>
            <span>{t('runs.new.excluded')}</span>
            <textarea
              rows={2}
              value={draft.excluded}
              onChange={(event) => { setDraft(current => ({ ...current, excluded: event.target.value })) }}
            />
          </label>
          {createError !== null && <p className={css.error} role="alert">{createError}</p>}
        </form>
      </Modal>
      <Modal
        open={terminatePending}
        onClose={busy ? () => {} : () => { setTerminatePending(false) }}
        closeLabel={t('remote.close')}
        title={t('runs.terminate.title')}
        description={t('runs.terminate.description')}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={() => { setTerminatePending(false) }}>{t('remote.cancel')}</Button>
            <Button disabled={busy} onClick={() => { applyRunAction('terminate') }}>{t('runs.terminate')}</Button>
          </>
        )}
      />
    </>
  )
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
        <Button
          size="sm"
          variant="outline"
          className={css.addButton}
          icon={<IconPlusOutline16 />}
          onClick={() => { setEditor('new') }}
        >
          {t('remote.add')}
        </Button>
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
  locked, useSession, useWorkspaces, useHostInfo, useRemoteMachines, controller, agentMode, createWorkspace, startSession,
  listPentestRuns, loadPentestRun, controlPentestRun, controlPentestTask, createPentestRun,
  startPentestLoop, stopPentestLoop, listRunningPentestLoops, t, replacePentestScope,
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
    const prepare = fingerprint === null
      ? controller.probe(target.id, target.auth === 'password-prompt' ? connectionPassword : undefined).then((probe) => {
        if (probe.platform === 'windows') throw new Error(t('remote.error.windowsUnsupported'))
        const resolvedPath = remotePath || probe.home
        if (resolvedPath === undefined || !resolvedPath.startsWith('/')) throw new Error(t('remote.path.absolute'))
        if (!probe.trusted) {
          setPath(resolvedPath)
          setFingerprint(probe.fingerprint)
          throw new Error('trust-required')
        }
        return resolvedPath
      })
      : controller.trust(target.id, fingerprint).then(() => remotePath)
    void prepare.then(async (resolvedPath) => {
      const workspace = await createWorkspace(remoteExecutionPath(target.id, resolvedPath))
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
      <AgentModeControl controller={agentMode} locked={locked} t={t} />
      <PentestRunsControl
        listRuns={listPentestRuns}
        loadRun={loadPentestRun}
        controlRun={controlPentestRun}
        controlTask={controlPentestTask}
        replaceScope={replacePentestScope}
        createRun={createPentestRun}
        startLoop={startPentestLoop}
        stopLoop={stopPentestLoop}
        listRunning={listRunningPentestLoops}
        {...currentWorkspace === undefined ? {} : { execution: {
          machineId: currentRemote?.machineId ?? 'local', workspaceId: currentWorkspace.workspaceId,
          cwd: currentWorkspace.path,
        } }}
        t={t}
      />
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
