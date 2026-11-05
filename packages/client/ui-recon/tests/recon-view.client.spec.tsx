// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { ReconView, evidenceSectionOf, reconChatPrompt, type ReconViewProps } from '../src/client/ReconView.tsx'
import { ReconTargetControl, type ReconTargetControlProps } from '../src/client/ReconTargetControl.tsx'
import { en } from '../src/client/locales.ts'
import type { DynamicReconResult, ReconQueueEntry, ReconReport } from '@deepseek-ai/dsh-recon-engine/types'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const t = makeTranslate(en, commonEn) as never

const report: ReconReport = {
  run_id: 'recon_abc123',
  started_at: '2026-09-21T00:00:00.000Z',
  profile: 'standard',
  cached: false,
  schema_version: 2,
  scanner_version: '2.0.0',
  status: 'completed',
  target: { input: 'https://lab.test', host: 'lab.test', scheme: 'https', port: 443, ips: ['203.0.113.10'] },
  dns: {
    a: ['203.0.113.10'], aaaa: [], cname: [], mx: [], ns: [], txt: [], soa: [], caa: [], ptr: [],
    dmarc: [], subdomains: [], errors: [],
  },
  http: { status: 200, final_url: 'https://lab.test/', redirects: [], server: 'nginx', content_type: 'text/html', title: 'Lab' },
  tls: null,
  security_headers: { csp: 'missing', hsts: 'present', x_frame_options: 'missing', x_content_type_options: 'present', referrer_policy: 'missing', permissions_policy: 'missing' },
  technologies: [
    { name: 'React', category: 'library', source: 'asset' },
    { name: 'Express', category: 'framework', source: 'x-powered-by' },
  ],
  frontend_technologies: [{ name: 'React', category: 'library', source: 'asset' }],
  backend_technologies: [{ name: 'Express', category: 'framework', source: 'x-powered-by' }],
  backend_status: 'observed',
  backend_reason: '',
  api_endpoints: [{
    path: '/api/users', method: 'GET', source: 'javascript', status: 401, content_type: 'application/json',
    auth_required: true, auth_scheme: 'Bearer',
    technologies: [{ name: 'Express', category: 'framework', source: 'x-powered-by' }],
  }],
  services: [],
  hosts: [],
  discovery: {
    robots: true, sitemap: true, sitemap_urls: 2, security_txt: false,
    openapi: true, swagger: false, oidc_discovery: false, well_known: [],
  },
  exposure: [],
  cors: null,
  cookies: [],
  cves: [],
  wayback_paths: [],
  assets: { javascript: 3, stylesheets: 1, forms: 1, emails: ['admin@lab.test'], api_candidates: ['/api/users'] },
  findings: [{
    type: 'missing_security_header', severity: 'medium', name: 'X-Frame-Options',
    detail: 'X-Frame-Options is not present on the response.', cwe_ids: ['CWE-1021'],
    evidence_ref: 'recon://recon_abc123/http/headers',
  }],
  interesting_targets: [{ target: '/api/users', reason: 'API endpoint discovered from application assets' }],
  phases: [
    { name: 'http', status: 'completed', duration_ms: 12 },
    { name: 'crawl', status: 'completed', duration_ms: 30 },
  ],
  warnings: [{ module: 'crawl', severity: 'warning', reason: 'Crawl truncated at the page budget.' }],
  coverage: {
    pages: { discovered: 5, scanned: 4, skipped: 1 },
    javascript: { discovered: 3, scanned: 2 },
    api: { discovered: 1, probed: 1, failed: 0 },
    subdomains: { discovered: 0, resolved: 0 },
    services: { probed: 0 },
    truncated: [],
  },
  metrics: { duration_ms: 830, http_requests: 14, bytes_downloaded: 4096, dns_queries: 6, tcp_probes: 0, cache_hits: 0 },
  evidence_refs: ['recon://recon_abc123/http/headers'],
}

const dynamicResult: DynamicReconResult = {
  schema_version: 1,
  run_id: report.run_id,
  target: report.target.input,
  started_at: report.started_at,
  completed_at: report.started_at,
  status: 'completed',
  model: { provider: 'mock', model: 'dynamic-model' },
  usage: { input_tokens: 1234, output_tokens: 567 },
  summary: 'Runtime navigation exposed a lazy API route.',
  observations: [{
    category: 'runtime', title: 'Lazy route', detail: 'The browser requested /api/lazy.',
    confidence: 'high', evidence_refs: [],
  }],
  endpoints: ['/api/lazy'], technologies: ['React'], findings: [], gaps: [], warnings: [],
  evidence_ref: `recon://${report.run_id}/ai/dynamic`,
}

const queueJob: ReconQueueEntry = {
  id: 'recon-job-1', kind: 'scan', target: report.target.input, aiAssisted: false,
  status: 'running', queuedAt: report.started_at, startedAt: report.started_at,
}

describe('ReconView', () => {
  it('collects the target in the toolbar before opening Recon', async () => {
    let finishEnqueue!: (value: ReconQueueEntry) => void
    const enqueue = vi.fn(() => new Promise<ReconQueueEntry>((resolve) => { finishEnqueue = resolve }))
    const openRecon = vi.fn()
    render(<ReconTargetControl {...({ enqueue, openRecon, t } as unknown as ReconTargetControlProps)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Recon Target' }))
    expect(openRecon).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Recon' }))
    const dialog = screen.getByRole('dialog', { name: 'Recon Target' })
    fireEvent.change(within(dialog).getByPlaceholderText('https://target.example'), {
      target: { value: 'https://lab.test' },
    })
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run Recon' }))

    await waitFor(() => { expect(enqueue).toHaveBeenCalledWith('https://lab.test', false) })
    expect(within(dialog).getByRole('status').textContent).toContain('Adding https://lab.test to the queue')
    expect(within(dialog).getByRole('status').querySelector('[aria-hidden="true"]')).toBeTruthy()
    finishEnqueue(queueJob)
    await waitFor(() => { expect(openRecon).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('dialog', { name: 'Recon Target' })).toBeNull()
  })

  it('opens stored Recon runs from the toolbar without scanning', () => {
    const enqueue = vi.fn()
    const openRecon = vi.fn()
    render(<ReconTargetControl {...({ enqueue, openRecon, t } as unknown as ReconTargetControlProps)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Recon Target' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'View Recon' }))

    expect(openRecon).toHaveBeenCalledOnce()
    expect(enqueue).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Recon Target' })).toBeNull()
  })

  it('queues AI Recon outside Chat and opens the Recon view', async () => {
    const enqueue = vi.fn(async () => ({ ...queueJob, aiAssisted: true }))
    const openRecon = vi.fn()
    render(<ReconTargetControl {...({ enqueue, openRecon, t } as unknown as ReconTargetControlProps)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Recon Target' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Recon' }))
    const dialog = screen.getByRole('dialog', { name: 'Recon Target' })
    fireEvent.change(within(dialog).getByPlaceholderText('https://target.example'), {
      target: { value: 'https://lab.test' },
    })
    fireEvent.click(within(dialog).getByRole('switch', { name: 'AI dynamic Recon' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run Recon' }))

    await waitFor(() => { expect(enqueue).toHaveBeenCalledWith('https://lab.test', true) })
    expect(openRecon).toHaveBeenCalledOnce()
  })

  it('lists stored runs and opens one compact report', async () => {
    const loadRuns = vi.fn(async () => [{
      runId: 'recon_abc123', target: 'https://lab.test', profile: 'standard',
      startedAt: report.started_at, findings: 1, interesting: 1,
    }])
    const loadRun = vi.fn(async () => report)
    const loadEvidence = vi.fn(async () => '{"server":"nginx"}')
    const deleteRun = vi.fn(async () => {})
    const sendToChat = vi.fn(async () => {})
    const loadDynamic = vi.fn(async () => dynamicResult)

    render(<ReconView {...({
      loadRuns, loadRun, deleteRun, loadEvidence, loadDynamic, sendToChat, scan: vi.fn(async () => report), t,
    } as unknown as ReconViewProps)} />)

    await waitFor(() => { expect(screen.getAllByText(/recon_abc123/).length).toBeGreaterThan(0) })
    fireEvent.click(screen.getByText(/recon_abc123/))
    await waitFor(() => { expect(loadRun).toHaveBeenCalledWith('recon_abc123') })
    await waitFor(() => { expect(loadDynamic).toHaveBeenCalledWith('recon_abc123') })
    expect(screen.getByText(/Tokens: 1,234 in · 567 out/)).toBeTruthy()
    expect(screen.getByText('Runtime navigation exposed a lazy API route.')).toBeTruthy()
    expect(screen.getAllByText('Findings').length).toBeGreaterThan(0)
    expect(screen.getByText('[medium] missing_security_header')).toBeTruthy()
    expect(screen.getByText('CWE-1021')).toBeTruthy()
    expect(screen.getAllByText(/\/api\/users/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Frontend / Web Recon')).toBeTruthy()
    expect(screen.getByText('Backend / API Recon')).toBeTruthy()
    expect(screen.getByText('React')).toBeTruthy()
    expect(screen.getByText('Express')).toBeTruthy()
    expect(screen.getByText(/GET \/api\/users/)).toBeTruthy()
    expect(screen.getByText(/401 · javascript · application\/json · Auth required \(Bearer\)/)).toBeTruthy()
    expect(screen.getByText('Coverage')).toBeTruthy()
    expect(screen.getByText('4/5 · 1 skipped')).toBeTruthy()
    expect(screen.getByText('Warnings / errors')).toBeTruthy()
    expect(screen.getByText('Crawl truncated at the page budget.')).toBeTruthy()
    expect(screen.getByText('Phases')).toBeTruthy()

    const endpointsToggle = screen.getByRole('button', { name: 'API endpoints' })
    expect(endpointsToggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(endpointsToggle)
    expect(endpointsToggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/GET \/api\/users/)).toBeNull()
    fireEvent.click(endpointsToggle)
    expect(screen.getByText(/GET \/api\/users/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Send to AI' }))
    await waitFor(() => { expect(sendToChat).toHaveBeenCalledWith(report, dynamicResult) })

    fireEvent.click(screen.getByRole('button', { name: 'View http/headers' }))
    await waitFor(() => { expect(loadEvidence).toHaveBeenCalledWith('recon_abc123', 'http/headers') })
    await waitFor(() => { expect(screen.getByText('{"server":"nginx"}')).toBeTruthy() })
    expect(screen.getByText('{"server":"nginx"}').closest('li')?.textContent).toContain('[medium] missing_security_header')
    expect(screen.queryByText('Select an evidence reference to read the raw document.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hide http/headers' }))
    expect(screen.queryByText('{"server":"nginx"}')).toBeNull()
    expect(screen.getByRole('button', { name: 'View http/headers' })).toBeTruthy()
    expect(screen.queryByText(/Excluded targets/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete recon run https://lab.test' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete recon run' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(deleteRun).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete recon run https://lab.test' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete recon run' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => { expect(deleteRun).toHaveBeenCalledWith('recon_abc123') })
    await waitFor(() => { expect(screen.queryByText(/recon_abc123/)).toBeNull() })
  })

  it('shows the empty state when no runs are stored', async () => {
    render(<ReconView {...({
      loadRuns: vi.fn(async () => []),
      t,
    } as unknown as ReconViewProps)} />)
    await waitFor(() => { expect(screen.getByText(/No stored recon runs yet/)).toBeTruthy() })
  })

  it('hides unfinished runs while their queue job owns progress', async () => {
    const loadRun = vi.fn(async () => report)
    render(<ReconView {...({
      loadRuns: vi.fn(async () => [
        {
          runId: 'recon_running', target: 'https://running.test', profile: 'deep',
          startedAt: report.started_at, findings: 0, interesting: 0, status: 'running',
        },
        {
          runId: report.run_id, target: report.target.input, profile: 'deep',
          startedAt: report.started_at, findings: 0, interesting: 0, status: 'completed',
        },
      ]),
      loadQueue: vi.fn(async () => [{
        ...queueJob, kind: 'dynamic', runId: report.run_id, aiAssisted: true,
      }]),
      loadRun,
      t,
    } as unknown as ReconViewProps)} />)

    await screen.findByText('Recon queue')
    expect(screen.queryByRole('button', { name: /recon_running/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /recon_abc123/ })).toBeNull()
    expect(loadRun).not.toHaveBeenCalled()
  })

  it('shows themed progress while adding a background job and reloading', async () => {
    let finishEnqueue!: (value: ReconQueueEntry) => void
    let finishReload!: (value: readonly never[]) => void
    const loadRuns = vi.fn()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise<readonly never[]>((resolve) => { finishReload = resolve }))
    const enqueue = vi.fn(() => new Promise<ReconQueueEntry>((resolve) => { finishEnqueue = resolve }))
    render(<ReconView {...({ loadRuns, loadQueue: vi.fn(async () => []), enqueue, t } as unknown as ReconViewProps)} />)

    await waitFor(() => { expect(screen.getByText(/No stored recon runs yet/)).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText('https://target.example'), { target: { value: 'https://lab.test' } })
    fireEvent.click(screen.getByRole('switch', { name: 'AI dynamic Recon' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run Recon' }))
    expect(screen.getByRole('status').textContent).toContain('Adding https://lab.test to the queue')
    finishEnqueue({ ...queueJob, aiAssisted: true })
    await waitFor(() => { expect(enqueue).toHaveBeenCalledWith('https://lab.test', true) })
    await waitFor(() => { expect(screen.getByText('Recon queue')).toBeTruthy() })
    expect(screen.getByRole('status').textContent).toContain('Scanning https://lab.test')
    expect(screen.getByRole('status').querySelector('[data-recon-loading-logo]')).not.toBeNull()
    expect(screen.getByRole('status').querySelectorAll('svg circle')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(screen.getByRole('status').textContent).toContain('Reloading recon runs')
    finishReload([])
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
  })

  it('maps an evidence ref to its section path', () => {
    expect(evidenceSectionOf('recon://recon_abc123/http/headers')).toBe('http/headers')
    expect(evidenceSectionOf('summary.json')).toBe('summary.json')
  })

  it('builds a compact report prompt for Chat', () => {
    const prompt = reconChatPrompt(report)
    expect(prompt).toContain('Analyze this Recon report')
    expect(prompt).toContain('"run_id": "recon_abc123"')
    expect(prompt).toContain('"evidence_ref": "recon://recon_abc123/http/headers"')
    // Raw page bodies never enter the Chat prompt.
    expect(prompt).not.toContain('html_body')
    expect(reconChatPrompt(report, dynamicResult)).toContain('Stored AI Dynamic Recon result')
  })

  it('shows the legacy badge on reports from before the Full Deep schema', async () => {
    const legacyReport: ReconReport = {
      ...report,
      schema_version: 1,
      backend_status: 'not_observable',
      backend_reason: 'Legacy scan carried no backend observation.',
    }
    const loadRun = vi.fn(async () => legacyReport)
    render(<ReconView {...({
      loadRuns: vi.fn(async () => [{
        runId: 'recon_abc123', target: 'https://lab.test', profile: 'deep',
        startedAt: report.started_at, findings: 1, interesting: 1,
      }]),
      loadRun,
      t,
    } as unknown as ReconViewProps)} />)
    fireEvent.click(await screen.findByText(/recon_abc123/))
    await waitFor(() => { expect(screen.getByText(/Legacy scan, rescan recommended/)).toBeTruthy() })
    await waitFor(() => { expect(screen.getByText(/Backend not observable/)).toBeTruthy() })
  })

  it('shows running and queued background jobs in FIFO order', async () => {
    render(<ReconView {...({
      loadRuns: vi.fn(async () => []),
      loadQueue: vi.fn(async () => [
        queueJob,
        { ...queueJob, id: 'recon-job-2', target: 'https://second.test', status: 'queued', position: 1 },
      ]),
      t,
    } as unknown as ReconViewProps)} />)
    await waitFor(() => { expect(screen.getByText('Recon queue')).toBeTruthy() })
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('Queued · #1')).toBeTruthy()
    const queueLoaders = document.querySelectorAll('[data-recon-queue-loading]')
    expect(queueLoaders).toHaveLength(2)
    queueLoaders.forEach((loader) => { expect(loader.querySelector('svg')).toBeNull() })
  })

  it('clears failed queue entries without deleting Recon runs', async () => {
    const clearQueue = vi.fn(async () => {})
    render(<ReconView {...({
      loadRuns: vi.fn(async () => []),
      loadQueue: vi.fn(async () => [{
        ...queueJob, status: 'failed', error: 'AI Dynamic Recon failed',
      }]),
      clearQueue,
      t,
    } as unknown as ReconViewProps)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Clear failed' }))
    await waitFor(() => { expect(clearQueue).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(screen.queryByText('Recon queue')).toBeNull() })
  })
})
