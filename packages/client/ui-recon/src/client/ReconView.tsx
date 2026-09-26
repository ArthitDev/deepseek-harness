/** Operator view over stored deterministic recon runs: list, compact summary, and lazy evidence reading. */

import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { DynamicReconResult, ReconQueueEntry, ReconReport } from '@deepseek-ai/dsh-recon-engine/types'
import {
  Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconCodeOutlineRegular, IconDatabaseOutlineRegular,
  IconEnhanceOutlineRegular, IconGaugeOutlineRegular, IconGlobeOutlineRegular,
  IconGoalOutlineRegular, IconLinkOutlineRegular, IconListPenOutlineRegular, IconShieldOutlineRegular,
  IconTrashOutlineRegular, Modal, type IconProps,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReconKey } from './locales.ts'
import css from './ReconView.module.css'

type ReconViewApiEndpoint = ReconReport['api_endpoints'][number]

/** One listed run as the list view renders it. */
export interface ReconRunListItem {
  readonly runId: string
  readonly target: string
  readonly profile: string
  readonly startedAt: string
  readonly findings: number
  readonly interesting: number
  /** Lifecycle status for in-flight or interrupted runs. */
  readonly status?: string
  /** Current phase name while the run executes. */
  readonly phase?: string
  readonly elapsed_ms?: number
}

/** Host-provided loaders handed to the view through the slot's inject bag. */
export interface ReconViewInjected {
  /** List stored runs, most recent first. */
  loadRuns: () => Promise<readonly ReconRunListItem[]>
  /** List process-local background Recon jobs. */
  loadQueue: () => Promise<readonly ReconQueueEntry[]>
  /** Clear retained failed jobs without touching live queue work. */
  clearQueue: () => Promise<void>
  /** Queue a deterministic scan and optional AI follow-up. */
  enqueue: (target: string, aiAssisted: boolean) => Promise<ReconQueueEntry>
  /** Load one run's compact report. */
  loadRun: (runId: string) => Promise<ReconReport>
  /** Delete one stored run and all of its evidence. */
  deleteRun: (runId: string) => Promise<void>
  /** Read one evidence document's raw JSON text. */
  loadEvidence: (runId: string, section: string) => Promise<string>
  /** Load the stored AI companion result, if this run has one. */
  loadDynamic: (runId: string) => Promise<DynamicReconResult | null>
  /** Queue a hidden Recon-only Agent for an existing report. */
  enqueueDynamic: (runId: string) => Promise<ReconQueueEntry>
  /** Send one compact report to the current Session and return to Chat. */
  sendToChat: (report: ReconReport, dynamic?: DynamicReconResult) => Promise<void>
}

/** Icon per technology category, from the shared icon set. */
const CATEGORY_ICONS: Readonly<Record<string, (props: IconProps) => JSX.Element | null>> = {
  server: IconDatabaseOutlineRegular,
  cdn: IconGlobeOutlineRegular,
  language: IconCodeOutlineRegular,
  framework: IconEnhanceOutlineRegular,
  cms: IconListPenOutlineRegular,
  analytics: IconGaugeOutlineRegular,
  library: IconCodeOutlineRegular,
}

/** Expandable report section with an explicit up/down state indicator. */
function CollapsibleSection(props: {
  readonly icon?: (props: IconProps) => JSX.Element | null
  readonly label: string
  readonly children: ReactNode
}): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const Icon = props.icon
  return (
    <section className={css.collapsibleSection}>
      <button
        type="button"
        className={css.sectionToggle}
        aria-expanded={expanded}
        onClick={() => { setExpanded(value => !value) }}
      >
        {Icon === undefined ? null : <Icon size={14} />}
        <span>{props.label}</span>
        <span className={css.sectionArrow} aria-hidden="true">
          {expanded ? <IconChevronUpOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />}
        </span>
      </button>
      {expanded && <div className={css.sectionBody}>{props.children}</div>}
    </section>
  )
}

function TechnologyChips({ technologies, none }: {
  readonly technologies: ReconReport['technologies']
  readonly none: string
}): JSX.Element {
  if (technologies.length === 0) return <p className={css.muted}>{none}</p>
  return (
    <div className={css.techChips}>
      {technologies.map((tech) => {
        const Icon = CATEGORY_ICONS[tech.category] ?? IconCodeOutlineRegular
        return (
          <span key={tech.name} className={css.techChip}>
            <Icon size={12} />
            {tech.name}{tech.version === undefined ? '' : ` ${tech.version}`}
          </span>
        )
      })}
    </div>
  )
}

/** Stored reports from before API Recon have no endpoint array. */
function apiEndpointsOf(report: ReconReport): readonly ReconViewApiEndpoint[] {
  const value: unknown = (report as unknown as { readonly api_endpoints?: unknown }).api_endpoints
  return Array.isArray(value) ? value as readonly ReconViewApiEndpoint[] : []
}

/** Stored reports from before the Full Deep schema have no version marker. */
const CURRENT_SCHEMA_VERSION = 2

/** The recon tab's props: conversation shell owner props, locale, and the injected loaders. */
export type ReconViewProps = ConvViewProps & PropsLocale<'recon'> & Partial<ReconViewInjected>

function ReconSpinner({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span
      className={`${css.loadingMark} ${compact ? css.loadingMarkCompact : ''}`}
      data-recon-queue-loading={compact ? true : undefined}
      aria-hidden="true"
    >
      {!compact && (
        <svg className={css.loadingRing} viewBox="0 0 72 72" focusable="false">
          <circle className={css.loadingRingTrack} cx="36" cy="36" r="34" />
          <circle className={css.loadingRingArc} cx="36" cy="36" r="34" pathLength="100" />
        </svg>
      )}
      <span className={css.loadingLogo} data-recon-loading-logo />
    </span>
  )
}

/** Theme-aware progress state shared by the Recon page and target modal. */
export function ReconLoading({ message }: { readonly message: string }) {
  return (
    <div className={css.loadingState} role="status" aria-live="polite">
      <ReconSpinner />
      <span className={css.loadingText}>{message}</span>
    </div>
  )
}

/** Render one stored run's compact report for the operator. */
export function ReconView({
  loadRuns, loadQueue, clearQueue, loadRun, deleteRun, loadEvidence, loadDynamic,
  enqueueDynamic, sendToChat, enqueue, t,
}: ReconViewProps) {
  const [runs, setRuns] = useState<readonly ReconRunListItem[] | null>(null)
  const [queue, setQueue] = useState<readonly ReconQueueEntry[] | null>(null)
  const [selected, setSelected] = useState<ReconReport | null>(null)
  const [dynamicResult, setDynamicResult] = useState<DynamicReconResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<{
    readonly findingKey: string
    readonly text: string
  } | null>(null)
  const [targetInput, setTargetInput] = useState('')
  const [aiAssisted, setAiAssisted] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [dynamicRunning, setDynamicRunning] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [clearingQueue, setClearingQueue] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ReconRunListItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [sending, setSending] = useState(false)
  const selectedApiEndpoints = selected === null ? [] : apiEndpointsOf(selected)
  const liveJob = queue?.find(job => job.status === 'running')
    ?? queue?.find(job => job.status === 'queued')
  const hasLiveQueue = queue?.some(job => job.status === 'queued' || job.status === 'running') === true
  const selectedDynamicQueued = selected !== null && queue?.some(job =>
    job.kind === 'dynamic' && job.runId === selected.run_id
      && (job.status === 'queued' || job.status === 'running')) === true
  const runIsPending = (runId: string): boolean => queue?.some(job =>
    job.runId === runId && (job.status === 'queued' || job.status === 'running')) === true
  const hasFailedQueue = queue?.some(job => job.status === 'failed') === true
  const visibleRuns = runs?.filter(run => run.status !== 'running' && !runIsPending(run.runId)) ?? null

  const reload = (): void => {
    if (loadRuns === undefined || loadingRuns) return
    setLoadingRuns(true)
    void (async () => {
      try {
        const [nextRuns, nextQueue] = await Promise.all([
          loadRuns(), loadQueue?.() ?? Promise.resolve([]),
        ])
        setRuns(nextRuns)
        setQueue(nextQueue)
        setError(null)
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setLoadingRuns(false)
      }
    })()
  }

  const clearFailedQueue = (): void => {
    if (clearQueue === undefined || clearingQueue) return
    setClearingQueue(true)
    void (async () => {
      try {
        await clearQueue()
        setQueue(current => current?.filter(job => job.status !== 'failed') ?? null)
        setError(null)
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setClearingQueue(false)
      }
    })()
  }

  // Reload once on mount; the loaders are stable slot injections.
  useEffect(reload, [])

  // Poll only while this process has queued work; leaving Chat or closing the
  // target modal does not stop the host-owned queue.
  useEffect(() => {
    if (!hasLiveQueue || loadRuns === undefined || loadQueue === undefined) return
    const poll = window.setInterval(() => {
      void (async () => {
        try {
          const [entries, jobs, dynamic] = await Promise.all([
            loadRuns(), loadQueue(),
            selected === null || loadDynamic === undefined
              ? Promise.resolve(undefined)
              : loadDynamic(selected.run_id),
          ])
          setRuns(entries)
          setQueue(jobs)
          if (dynamic !== undefined) setDynamicResult(dynamic)
        } catch {
          // Background polling never replaces an actionable foreground error.
        }
      })()
    }, 3000)
    return () => { window.clearInterval(poll) }
  }, [hasLiveQueue, loadRuns, loadQueue, loadDynamic, selected])

  const open = (runId: string): void => {
    if (loadRun === undefined) return
    void (async () => {
      try {
        const [report, dynamic] = await Promise.all([
          loadRun(runId),
          loadDynamic?.(runId) ?? Promise.resolve(null),
        ])
        setSelected(report)
        setDynamicResult(dynamic)
        setEvidence(null)
        setError(null)
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    })()
  }

  const showEvidence = (findingKey: string, section: string): void => {
    if (loadEvidence === undefined || selected === null) return
    if (evidence?.findingKey === findingKey) {
      setEvidence(null)
      return
    }
    void (async () => {
      try {
        setEvidence({ findingKey, text: await loadEvidence(selected.run_id, section) })
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    })()
  }

  const runScanFromTab = (): void => {
    const target = targetInput.trim()
    if (target.length === 0 || enqueue === undefined || scanning) return
    setScanning(true)
    setError(null)
    void (async () => {
      try {
        const job = await enqueue(target, aiAssisted)
        setQueue(previous => [...(previous ?? []).filter(item => item.id !== job.id), job])
        setTargetInput('')
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setScanning(false)
      }
    })()
  }

  const confirmDelete = (): void => {
    if (pendingDelete === null || deleteRun === undefined || deleting) return
    const run = pendingDelete
    setDeleting(true)
    setError(null)
    void (async () => {
      try {
        await deleteRun(run.runId)
        setRuns(previous => previous?.filter(item => item.runId !== run.runId) ?? null)
        if (selected?.run_id === run.runId) {
          setSelected(null)
          setDynamicResult(null)
          setEvidence(null)
        }
        setPendingDelete(null)
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setDeleting(false)
      }
    })()
  }

  const sendSelectedToChat = (): void => {
    if (selected === null || sendToChat === undefined || sending) return
    setSending(true)
    setError(null)
    const action = dynamicResult === null ? sendToChat(selected) : sendToChat(selected, dynamicResult)
    void action.catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
      setSending(false)
    })
  }

  const runSelectedDynamic = (): void => {
    if (selected === null || enqueueDynamic === undefined || dynamicRunning || selectedDynamicQueued) return
    setDynamicRunning(true)
    setError(null)
    void enqueueDynamic(selected.run_id)
      .then((job) => { setQueue(previous => [...(previous ?? []).filter(item => item.id !== job.id), job]) })
      .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { setDynamicRunning(false) })
  }

  return (
    <div className={css.reconView} role="region" aria-label={t('recon.aria')}>
      <div className={css.reconHead}>
        <h3>{t('recon.title')}</h3>
        <Button variant="outline" disabled={loadingRuns || scanning} onClick={reload}>
          {loadingRuns ? t('recon.reload.running') : t('recon.reload')}
        </Button>
      </div>
      <div className={css.scanBar} role="group" aria-label={t('recon.aria')}>
        <label className={css.scanField}>
          <span>{t('recon.scan.target')}</span>
          <input
            className={css.scanInput}
            value={targetInput}
            placeholder="https://target.example"
            disabled={scanning}
            onChange={(event) => { setTargetInput(event.target.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter') runScanFromTab() }}
          />
        </label>
        <div className={css.aiOption}>
          <span>{t('recon.ai.label')}</span>
          <Switch
            checked={aiAssisted}
            disabled={scanning || enqueue === undefined}
            label={t('recon.ai.label')}
            onChange={setAiAssisted}
          />
        </div>
        <Button className={css.scanButton} variant="outline" disabled={scanning || loadingRuns || targetInput.trim().length === 0} onClick={runScanFromTab}>
          {scanning ? t('recon.queue.adding.short') : t('recon.scan.button')}
        </Button>
      </div>
      {scanning && <ReconLoading message={t('recon.queue.adding', { target: targetInput.trim() })} />}
      {loadingRuns && <ReconLoading message={runs === null ? t('recon.loading') : t('recon.reload.running')} />}
      {!scanning && !loadingRuns && liveJob !== undefined && (
        <ReconLoading message={liveJob.status === 'queued'
          ? `${t('recon.queue.status.queued')} · ${liveJob.target}`
          : liveJob.kind === 'dynamic'
            ? t('recon.ai.running', { target: liveJob.target })
            : t('recon.scan.progress', { target: liveJob.target })}
        />
      )}
      {queue !== null && queue.length > 0 && (
        <CollapsibleSection icon={IconListPenOutlineRegular} label={t('recon.queue.title')}>
          {hasFailedQueue && (
            <div className={css.queueActions}>
              <Button
                variant="toolbar"
                size="sm"
                icon={<IconTrashOutlineRegular size={14} />}
                disabled={clearingQueue || clearQueue === undefined}
                onClick={clearFailedQueue}
              >
                {clearingQueue ? t('recon.queue.clearing') : t('recon.queue.clear')}
              </Button>
            </div>
          )}
          <ol className={css.records}>
            {queue.map(job => (
              <li key={job.id}>
                <div className={css.queueTarget}>
                  {(job.status === 'queued' || job.status === 'running')
                    && <ReconSpinner compact />}
                  <strong>{job.target}</strong>
                </div>
                <span>
                  {t(`recon.queue.status.${job.status}`)}
                  {job.position === undefined ? '' : ` · #${job.position}`}
                  {job.aiAssisted ? ` · ${t('recon.ai.label')}` : ''}
                </span>
                {job.error === undefined ? null : <span data-severity="high">{job.error}</span>}
              </li>
            ))}
          </ol>
        </CollapsibleSection>
      )}
      {error !== null && <p className={css.error} role="alert">{t('recon.error', { message: error })}</p>}
      {runs === null && !loadingRuns && error === null && <p className={css.muted}>{t('recon.loading')}</p>}
      {visibleRuns !== null && !loadingRuns && !scanning && visibleRuns.length === 0 && !hasLiveQueue && <p className={css.muted}>{t('recon.empty')}</p>}
      {visibleRuns !== null && !loadingRuns && !scanning && visibleRuns.length > 0 && (
        <div className={css.reconLayout}>
          <nav className={css.runList} aria-label={t('recon.aria')}>
            {visibleRuns.map(run => (
              <div className={css.runRow} key={run.runId}>
                <button
                  type="button"
                  className={`${css.runOpen} ${selected?.run_id === run.runId ? css.runSelected : ''}`}
                  onClick={() => { open(run.runId) }}
                >
                  <strong>{run.target}</strong>
                  <span>{run.runId} · {run.findings} {t('recon.findings')}</span>
                </button>
                <button
                  type="button"
                  className={css.deleteRun}
                  aria-label={t('recon.delete.label', { target: run.target })}
                  title={t('recon.delete.action')}
                  onClick={() => { setPendingDelete(run) }}
                >
                  <IconTrashOutlineRegular />
                </button>
              </div>
            ))}
          </nav>
          {selected !== null && visibleRuns.some(run => run.runId === selected.run_id) && (
            <section className={css.runDetail} aria-live="polite">
              <div className={css.runActions}>
                <Button variant="outline" disabled={dynamicRunning || selectedDynamicQueued || enqueueDynamic === undefined} onClick={runSelectedDynamic}>
                  {dynamicRunning || selectedDynamicQueued ? t('recon.ai.queued') : t('recon.ai.rerun')}
                </Button>
                <Button variant="outline" disabled={sending} onClick={sendSelectedToChat}>
                  {sending ? t('recon.chat.sending') : t('recon.chat.send')}
                </Button>
              </div>
              {selected.schema_version < CURRENT_SCHEMA_VERSION && (
                <p className={css.error} role="status">⚠ {t('recon.legacy')}</p>
              )}
              <dl className={css.summary}>
                <div><dt>run</dt><dd><code>{selected.run_id}</code>{selected.status !== 'completed' ? ` · ${statusLabel(selected.status, t)}` : ''}</dd></div>
                <div><dt>target</dt><dd>{selected.target.input} → {selected.target.host}:{selected.target.port}</dd></div>
                <div><dt>started</dt><dd>{selected.started_at}</dd></div>
                {selected.http !== null && <div><dt>http</dt><dd>{selected.http.status} · {selected.http.server || '—'} · {selected.http.title || '—'}</dd></div>}
                {selected.tls?.enabled === true && <div><dt>tls</dt><dd>{selected.tls.protocol} · {selected.tls.issuer_org || '—'} · {selected.tls.days_remaining}d</dd></div>}
              </dl>
              <CollapsibleSection icon={IconEnhanceOutlineRegular} label={t('recon.ai.label')}>
                {dynamicResult === null
                  ? <p className={css.muted}>{t('recon.ai.empty')}</p>
                  : dynamicResult.status === 'failed'
                    ? <p className={css.error}>{dynamicResult.error ?? t('recon.ai.failed')}</p>
                    : (
                      <>
                        <p className={css.aiSummary}>{dynamicResult.summary}</p>
                        <p className={css.muted}>
                          {t('recon.ai.model')}: {dynamicResult.model.provider} · {dynamicResult.model.model}
                          {dynamicResult.usage === undefined ? '' : ` · ${t('recon.ai.tokens', {
                            input: dynamicResult.usage.input_tokens.toLocaleString(),
                            output: dynamicResult.usage.output_tokens.toLocaleString(),
                          })}`}
                        </p>
                        {dynamicResult.observations.length > 0 && (
                          <ol className={css.records}>
                            {dynamicResult.observations.map((item, index) => (
                              <li key={`${item.category}:${item.title}:${index}`}>
                                <strong>{item.title}</strong>
                                <span>{item.detail}</span>
                                <span>{item.category} · {item.confidence}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                        {dynamicResult.endpoints.length > 0 && <p className={css.muted}>{t('recon.ai.endpoints')}: {dynamicResult.endpoints.join(', ')}</p>}
                        {dynamicResult.technologies.length > 0 && <p className={css.muted}>{t('recon.ai.technologies')}: {dynamicResult.technologies.join(', ')}</p>}
                        {dynamicResult.findings.length > 0 && (
                          <ol className={css.records}>
                            {dynamicResult.findings.map((finding, index) => (
                              <li key={`${finding.title}:${index}`}>
                                <strong data-severity={finding.severity}>[{finding.severity}] {finding.title}</strong>
                                <span>{finding.detail}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                        {dynamicResult.gaps.length > 0 && <p className={css.muted}>{t('recon.ai.gaps')}: {dynamicResult.gaps.join(' · ')}</p>}
                        {dynamicResult.warnings.length > 0 && <p className={css.muted}>{t('recon.ai.warnings')}: {dynamicResult.warnings.join(' · ')}</p>}
                      </>
                    )}
              </CollapsibleSection>
              <CollapsibleSection icon={IconCodeOutlineRegular} label={t('recon.frontend')}>
                <TechnologyChips
                  technologies={selected.frontend_technologies ?? selected.technologies}
                  none={t('recon.none')}
                />
              </CollapsibleSection>
              <CollapsibleSection icon={IconDatabaseOutlineRegular} label={t('recon.backend')}>
                {selected.backend_status === 'not_observable' && (
                  <p className={css.muted}>{t('recon.backend.notObservable')}: {selected.backend_reason}</p>
                )}
                {selected.favicon_hash !== undefined && (
                  <p className={css.muted}>{t('recon.favicon')}: <code>{selected.favicon_hash}</code> · Shodan <code>http.favicon.hash:{selected.favicon_hash}</code></p>
                )}
                <TechnologyChips
                  technologies={selected.backend_technologies
                    ?? selectedApiEndpoints.flatMap(endpoint => endpoint.technologies)}
                  none={t('recon.none')}
                />
              </CollapsibleSection>
              {selected.services.length > 0 && (
                <CollapsibleSection icon={IconDatabaseOutlineRegular} label={t('recon.services')}>
                  <ol className={css.records}>
                    {selected.services.map(service => (
                      <li key={service.port}>
                        <strong>{service.port}{service.service === undefined ? '' : ` / ${service.service}`}</strong>
                        <span>
                          {[service.product, service.version].filter(Boolean).join(' ')
                            || service.banner_technology
                            || t('recon.none')}
                          {service.source === undefined ? '' : ` · ${service.source}`}
                        </span>
                      </li>
                    ))}
                  </ol>
                </CollapsibleSection>
              )}
              {selectedApiEndpoints.length > 0 && (
                <CollapsibleSection icon={IconLinkOutlineRegular} label={t('recon.endpoints')}>
                  <ol className={css.records}>
                    {selectedApiEndpoints.map(endpoint => (
                      <li key={`${endpoint.method}:${endpoint.path}`}>
                        <strong>{endpoint.method} {endpoint.path}{endpoint.template === true ? ' ⧙' : ''}</strong>
                        <span>
                          {endpoint.status ?? 'error'}
                          {` · ${endpoint.source}`}
                          {endpoint.probe_method === undefined || endpoint.probe_method === endpoint.method ? '' : ` · probed via ${endpoint.probe_method}`}
                          {endpoint.content_type === '' ? '' : ` · ${endpoint.content_type}`}
                          {endpoint.auth_required ? ` · ${t('recon.authRequired')}${endpoint.auth_scheme === undefined ? '' : ` (${endpoint.auth_scheme})`}` : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                </CollapsibleSection>
              )}
              {selected.hosts.length > 0 && (
                <CollapsibleSection label={t('recon.hosts')}>
                  <ol className={css.records}>
                    {selected.hosts.map(host => (
                      <li key={host.host}>
                        <strong>{host.host}</strong>
                        <span>{host.probed ? `HTTP ${host.status ?? '—'}` : host.ips.length > 0 ? host.ips.join(', ') : '—'}</span>
                      </li>
                    ))}
                  </ol>
                </CollapsibleSection>
              )}
              <CollapsibleSection icon={IconShieldOutlineRegular} label={t('recon.findings')}>
                {selected.findings.length === 0
                  ? <p className={css.muted}>{t('recon.none')}</p>
                  : (
                    <ol className={css.records}>
                      {selected.findings.map((finding, index) => {
                        const findingKey = `${finding.type}:${index}`
                        const section = evidenceSectionOf(finding.evidence_ref)
                        return (
                          <li key={findingKey}>
                            <strong data-severity={finding.severity}>[{finding.severity}] {finding.type}</strong>
                            <span>{finding.name} — {finding.detail}</span>
                            {finding.cwe_ids?.length
                              ? (
                                <div className={css.techChips}>
                                  {finding.cwe_ids.map(cwe => <span key={cwe} className={css.techChip}>{cwe}</span>)}
                                </div>
                              )
                              : null}
                            <button type="button" className={css.refButton} onClick={() => { showEvidence(findingKey, section) }}>
                              {evidence?.findingKey === findingKey
                                ? t('recon.evidence.hide', { section })
                                : t('recon.evidence.load', { section })}
                            </button>
                            {evidence?.findingKey === findingKey && (
                              <pre className={`${css.evidenceText} ${css.findingEvidence}`}>{evidence.text}</pre>
                            )}
                          </li>
                        )
                      })}
                    </ol>
                  )}
              </CollapsibleSection>
              <CollapsibleSection icon={IconGoalOutlineRegular} label={t('recon.interesting')}>
                {selected.interesting_targets.length === 0
                  ? <p className={css.muted}>{t('recon.none')}</p>
                  : (
                    <ol className={css.records}>
                      {selected.interesting_targets.map(target => (
                        <li key={target.target}>
                          <strong>{target.target}</strong>
                          <span>{target.reason}</span>
                        </li>
                      ))}
                    </ol>
                  )}
              </CollapsibleSection>
              <CollapsibleSection icon={IconGaugeOutlineRegular} label={t('recon.coverage')}>
                <div className={css.summary}>
                  <div><dt>{t('recon.coverage.pages')}</dt><dd>{selected.coverage.pages.scanned}/{selected.coverage.pages.discovered}{selected.coverage.pages.skipped > 0 ? ` · ${selected.coverage.pages.skipped} skipped` : ''}</dd></div>
                  <div><dt>{t('recon.coverage.javascript')}</dt><dd>{selected.coverage.javascript.scanned}/{selected.coverage.javascript.discovered}</dd></div>
                  <div><dt>{t('recon.coverage.api')}</dt><dd>{selected.coverage.api.probed}/{selected.coverage.api.discovered} · {selected.coverage.api.failed} err</dd></div>
                  <div><dt>{t('recon.coverage.subdomains')}</dt><dd>{selected.coverage.subdomains.resolved}/{selected.coverage.subdomains.discovered}</dd></div>
                  <div><dt>{t('recon.coverage.services')}</dt><dd>{selected.coverage.services.probed}</dd></div>
                  {selected.coverage.truncated.map((truncation, index) => (
                    <div key={`${truncation.module}:${index}`}><dt>{truncation.module}</dt><dd>{truncation.reason}</dd></div>
                  ))}
                </div>
              </CollapsibleSection>
              <CollapsibleSection icon={IconEnhanceOutlineRegular} label={t('recon.phases')}>
                {selected.phases.length === 0
                  ? <p className={css.muted}>{t('recon.none')}</p>
                  : (
                    <ol className={css.records}>
                      {selected.phases.map((phase, index) => (
                        <li key={`${phase.name}:${index}`}>
                          <strong>{phase.name}</strong>
                          <span>{phase.status} · {phase.duration_ms}ms{phase.reason === undefined ? '' : ` — ${phase.reason}`}</span>
                        </li>
                      ))}
                    </ol>
                  )}
              </CollapsibleSection>
              <CollapsibleSection icon={IconListPenOutlineRegular} label={t('recon.warnings')}>
                {selected.warnings.length === 0
                  ? <p className={css.muted}>{t('recon.none')}</p>
                  : (
                    <ol className={css.records}>
                      {selected.warnings.map((warning, index) => (
                        <li key={`${warning.module}:${index}`}>
                          <strong data-severity={warning.severity === 'error' ? 'high' : 'medium'}>[{warning.module}]</strong>
                          <span>{warning.reason}{warning.target === undefined ? '' : ` (${warning.target})`}</span>
                        </li>
                      ))}
                    </ol>
                  )}
              </CollapsibleSection>
            </section>
          )}
        </div>
      )}
      <Modal
        open={pendingDelete !== null}
        onClose={() => { if (!deleting) setPendingDelete(null) }}
        title={t('recon.delete.title')}
        description={pendingDelete === null ? '' : t('recon.delete.description', { target: pendingDelete.target })}
        closeLabel={t('recon.delete.close')}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={() => { setPendingDelete(null) }}>
              {t('recon.delete.cancel')}
            </Button>
            <Button variant="outline" className={css.deleteConfirm} disabled={deleting} onClick={confirmDelete}>
              {deleting ? t('recon.delete.deleting') : t('recon.delete.action')}
            </Button>
          </>
        )}
      />
    </div>
  )
}

/** Section path of one `recon://<runId>/<section>` ref. */
export function evidenceSectionOf(ref: string): string {
  const marker = 'recon://'
  if (!ref.startsWith(marker)) return ref
  const rest = ref.slice(marker.length)
  const slash = rest.indexOf('/')
  return slash === -1 ? rest : rest.slice(slash + 1)
}

/** Localized lifecycle label for one run status. */
function statusLabel(status: string, t: (key: ReconKey) => string): string {
  const key = `recon.status.${status}` as ReconKey
  return t(key)
}

/** Compact report projection handed to the Agent: surfaces and gaps, never raw evidence blobs. */
export function reconChatPrompt(report: ReconReport, dynamic?: DynamicReconResult): string {
  const compact = {
    run_id: report.run_id,
    started_at: report.started_at,
    profile: report.profile,
    status: report.status,
    target: report.target,
    http: report.http,
    tls: report.tls,
    technologies: report.technologies,
    backend_status: report.backend_status,
    backend_reason: report.backend_reason,
    api_endpoints: report.api_endpoints.map(endpoint => ({
      method: endpoint.method,
      probe_method: endpoint.probe_method,
      path: endpoint.path,
      source: endpoint.source,
      status: endpoint.status,
      auth_required: endpoint.auth_required,
      auth_scheme: endpoint.auth_scheme,
      template: endpoint.template,
    })),
    hosts: report.hosts,
    discovery: report.discovery,
    findings: report.findings,
    interesting_targets: report.interesting_targets,
    coverage: report.coverage,
    warnings: report.warnings,
    metrics: report.metrics,
    evidence_refs: report.evidence_refs,
  }
  return [
    'Analyze this Recon report, prioritize the findings, and continue in this chat.',
    'Raw evidence is stored per reference; request it only when needed.',
    '',
    JSON.stringify(compact, null, 2),
    ...(dynamic === undefined ? [] : ['', 'Stored AI Dynamic Recon result:', JSON.stringify(dynamic, null, 2)]),
  ].join('\n')
}
