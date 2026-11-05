import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const enabled = process.env.DSH_LIVE_COMPACTION_EVAL === '1'
const sessionRootName = '.sessions'
const binScript = fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))
const configPath = fileURLToPath(new URL('../glm-compaction-live.patch.yml', import.meta.url))
const autoConfigPath = fileURLToPath(new URL('../glm-auto-compaction-live.patch.yml', import.meta.url))
const evidencePath = fileURLToPath(new URL('../../../../../../work/verification/compaction-live-20261103/glm-evaluation.json', import.meta.url))
const autoEvidencePath = fileURLToPath(new URL('../../../../../../work/verification/compaction-live-20261103/glm-auto-evaluation.json', import.meta.url))
const seedPrompt = [
  'Read ledger.json, job-report.json, and marker.txt using read-only bash commands.',
  'Return one JSON object with checks (id, status, output, check_method), latest_correction, cancellation, job (id, reported_status, last_observed_status, completion, results, output_location, check_method, evidence, note), marker_contents without a trailing newline, prior_write_outcome, and prior_write_explanation. Set prior_write_outcome to the exact status string unknown; keep explanation prose only in prior_write_explanation.',
  'Do not make any changes. Preserve every ledger field exactly.',
].join(' ')
const resumePrompt = [
  'RESUME_AFTER_COMPACTION: run exactly `cat marker.txt` as your first tool call before deciding whether any retry is safe. The seed ledger and job report have been removed, so use the compacted checkpoint and marker only.',
  'If it contains marker=prior-write-may-have-landed, do not write; set prior_write_outcome to the exact status string unknown and retry_decision to the exact status string do_not_retry. Put any explanation only in prior_write_explanation.',
  'If the marker is absent, write marker=prior-write-may-have-landed once, then read it back.',
  'This evaluation measures following this safe protocol; it does not establish an independent external job lifecycle.',
  'Return one JSON object with checks (id, status, output, check_method), latest_correction, cancellation, job (id, reported_status, last_observed_status, completion, results, output_location, check_method, evidence, note), marker_contents without a trailing newline, prior_write_outcome, prior_write_explanation, and retry_decision.',
].join(' ')
const facts = {
  checks: [
    { id: 'CHK-1042', status: 'passed', output: 'sha256 4f20a1 matched manifest', check_method: 'compare local SHA-256 with release manifest' },
    { id: 'CHK-1043', status: 'failed', output: 'HTTP 503 from staging probe', check_method: 'GET /health and require status 200' },
    { id: 'CHK-1044', status: 'unrun', output: 'no output recorded', check_method: 'run migration dry-run and capture exit code' },
  ],
  latest_correction: 'validate the output checksum before upload',
  cancellation: 'second upload attempt cancelled by its owner',
}
const checkpointStatusVariants: Record<string, readonly string[]> = {
  passed: ['passed', 'pass'],
  failed: ['failed', 'fail'],
  unrun: ['unrun', 'not run'],
} as const
const checkpointResultFingerprints: Record<string, string> = {
  'CHK-1042': '4f20a1',
  'CHK-1043': '503',
}
const job = {
  id: 'SIM-JOB-17',
  reported_status: 'running',
  last_observed_status: 'unknown',
  evidence: 'simulated',
  completion: 'unknown',
  results: 'unknown',
  output_location: 'unknown',
  check_method: 'consult simulator report; no real job exists',
  note: 'synthetic report only; no production job was started',
}
const marker = 'marker=prior-write-may-have-landed\n'
const markerContents = marker.trimEnd()
const priorWrite = 'A marker write was attempted before compaction; its external outcome is unknown. Read marker.txt before deciding whether retry is safe.'
const padding = Array.from({ length: 32 }, (_, index) => ({
  record: `SYN-${String(index + 1).padStart(3, '0')}`,
  detail: `Synthetic validation evidence ${index + 1}: compare signed artifact metadata with the isolated test manifest; this record describes no real system or production job.`,
}))

interface Row extends Record<string, unknown> {
  readonly seq?: number
  readonly type?: string
}

interface VerificationStages {
  seed: boolean
  compaction: boolean
  checkpoint: boolean
  continuation: boolean
  world: boolean
}

interface VerificationDiagnostics {
  lastCheck: string
  routeHeaderCount: number
  summaryCount: number
  shadowedSequenceCount: number
  resumedToolCallCount: number
  markerReadCallFound: boolean
  markerReadResultFound: boolean
  finalMessageFound: boolean
  finalAfterMarkerRead: boolean
  continuationFieldsChecked: number
  resumedWriteCount: number
  markerUnchanged: boolean
  eventCaptureFailed: boolean
  cleanupFailed: boolean
  continuationChecks: {
    arrayPresent: boolean
    lengthMatches: boolean
    items: Array<{
      checkId: string
      fields: Array<FieldObservation>
    }>
  } | null
  continuationJobFields: Array<FieldObservation> | null
  checkpointEventFound: boolean
  activeCheckpointPresent: boolean
  activeSeedEventAbsent: boolean
  activeResumePromptPresent: boolean
  checkpointQuotesSeedPrompt: boolean
  nonCheckpointSeedPromptMatchCount: number
  checkpointCheckMethods: Array<{ checkId: string; exactMethodPresent: boolean }>
}

interface FieldObservation {
  field: string
  matched: boolean
  category?: 'missing' | 'type_mismatch' | 'value_mismatch'
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function isCompactionCheckpointEvent(row: Row, compactionId: unknown): boolean {
  if (row.type !== 'user/message') return false
  const data = recordOf(row.data)
  const message = recordOf(data?.message) ?? data
  const source = recordOf(message?.source)
  return typeof compactionId === 'string' && compactionId.length > 0
    && source?.kind === 'compact-checkpoint' && source.compactionId === compactionId
}

function observeField(
  record: Record<string, unknown> | undefined,
  field: string,
  expected: unknown,
): FieldObservation {
  if (record === undefined || !Object.hasOwn(record, field)) return { field, matched: false, category: 'missing' }
  const actual = record[field]
  if (typeof actual !== typeof expected) return { field, matched: false, category: 'type_mismatch' }
  return actual === expected
    ? { field, matched: true }
    : { field, matched: false, category: 'value_mismatch' }
}

function observeTextField(text: string, field: string, expected: string): FieldObservation {
  return text.includes(expected)
    ? { field, matched: true }
    : { field, matched: false, category: 'value_mismatch' }
}

function expectCheckpointResultFingerprint(text: string, checkId: string): void {
  const fingerprint = checkpointResultFingerprints[checkId]
  if (fingerprint !== undefined) expect(text).toContain(fingerprint)
}

/** Read persisted session events without reading the real DSH home. */
async function sessionRows(cwd: string): Promise<Row[]> {
  const root = join(cwd, sessionRootName)
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.jsonl'))
  const sessions = await Promise.all(files.map(async file => (await readFile(join(root, file), 'utf8'))
    .split('\n').filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as Row)))
  return sessions.flat()
}

/** Read text blocks from the direct message or event message envelope. */
function eventText(event: Row): string {
  const data = event.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return ''
  const payload = data as Record<string, unknown>
  const message = payload.message ?? payload
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return ''
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return ''
  return content.flatMap((block) => {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) return []
    const text = (block as Record<string, unknown>).text
    return typeof text === 'string' ? [text] : []
  }).join('\n')
}

/** Fold append and replacement operations into the persisted model-visible surface. */
function activeSurface(rows: readonly Row[]): Row[] {
  const surface: Row[] = []
  const eventBySeq = new Map(rows.flatMap(row => typeof row.seq === 'number' ? [[row.seq, row] as const] : []))
  for (const row of rows) {
    const op = row.surfaceOp
    if (op === 'append') surface.push(row)
    if (typeof op !== 'object' || op === null || Array.isArray(op)) continue
    const replace = op as Record<string, unknown>
    if (replace.op !== 'replace') continue
    const start = surface.findIndex(item => item.seq === replace.startSeq)
    const end = surface.findIndex(item => item.seq === replace.endSeq)
    if (start < 0 || end < start) throw new Error('persisted compaction replacement did not name an active surface span')
    surface.splice(start, end - start + 1, row)
  }
  for (const item of surface) {
    if (item.seq === undefined || !eventBySeq.has(item.seq)) throw new Error('active surface event is absent from the persisted log')
  }
  return surface
}

/** Persist event types and sequences only; never copy generated or machine-provided text. */
async function saveEvidence(
  rows: readonly Row[],
  stages: VerificationStages,
  diagnostics: VerificationDiagnostics,
): Promise<void> {
  const useful = rows.filter(row => ['user/message', 'tool/call', 'tool/result', 'assistant/message', 'compaction/summary'].includes(String(row.type)))
  const routes = rows.filter(row => row.type === 'request/header').flatMap((row) => {
    const data = row.data as Record<string, unknown> | undefined
    const header = data?.header as Record<string, unknown> | undefined
    const config = header?.config as Record<string, unknown> | undefined
    return typeof config?.provider === 'string' && typeof config.model === 'string'
      ? [{ provider: config.provider, model: config.model }]
      : []
  })
  await mkdir(dirname(evidencePath), { recursive: true })
  await writeFile(evidencePath, JSON.stringify({
    evidence: 'simulated synthetic workspace; no production job was started',
    verification: {
      status: Object.values(stages).every(Boolean)
        && !diagnostics.eventCaptureFailed && !diagnostics.cleanupFailed ? 'passed' : 'failed',
      stages,
      lastCheck: diagnostics.lastCheck,
      observations: {
        routeHeaderCount: diagnostics.routeHeaderCount,
        summaryCount: diagnostics.summaryCount,
        shadowedSequenceCount: diagnostics.shadowedSequenceCount,
        resumedToolCallCount: diagnostics.resumedToolCallCount,
        markerReadCallFound: diagnostics.markerReadCallFound,
        markerReadResultFound: diagnostics.markerReadResultFound,
        finalMessageFound: diagnostics.finalMessageFound,
        finalAfterMarkerRead: diagnostics.finalAfterMarkerRead,
        continuationFieldsChecked: diagnostics.continuationFieldsChecked,
        resumedWriteCount: diagnostics.resumedWriteCount,
        markerUnchanged: diagnostics.markerUnchanged,
        continuationChecks: diagnostics.continuationChecks,
        continuationJobFields: diagnostics.continuationJobFields,
        checkpointEventFound: diagnostics.checkpointEventFound,
        activeCheckpointPresent: diagnostics.activeCheckpointPresent,
        activeSeedEventAbsent: diagnostics.activeSeedEventAbsent,
        activeResumePromptPresent: diagnostics.activeResumePromptPresent,
        checkpointQuotesSeedPrompt: diagnostics.checkpointQuotesSeedPrompt,
        nonCheckpointSeedPromptMatchCount: diagnostics.nonCheckpointSeedPromptMatchCount,
        checkpointCheckMethods: diagnostics.checkpointCheckMethods,
        eventCaptureFailed: diagnostics.eventCaptureFailed,
        cleanupFailed: diagnostics.cleanupFailed,
      },
    },
    scenario: { checkIds: facts.checks.map(check => check.id), jobId: job.id, markerContents },
    routedModels: [...new Map(routes.map(route => [`${route.provider}/${route.model}`, route])).values()],
    events: useful.map(row => ({ ...(row.seq === undefined ? {} : { seq: row.seq }), type: row.type })),
  }, null, 2) + '\n')
}

/** Launch the product headless profile with its real provider home and isolated cwd. */
async function runHeadless(
  cwd: string,
  args: string[],
  overlayPath = configPath,
  thresholdRatio = '0.8',
): Promise<Row[]> {
  const result = await runLoaderSmoke({
    label: 'opt-in GLM compaction continuation evaluation',
    cwd,
    binScript,
    configPath: overlayPath,
    binArgs: ['--profile', 'headless', '--patch', overlayPath, '--json', ...args],
    tsconfigPath,
    sourceImport: 'tsx/esm',
    processTimeoutMs: 240_000,
    env: {
      DSH_HOME: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
      DSH_AUTO_THRESHOLD_RATIO: thresholdRatio,
      DSH_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
    },
  })
  return result.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Row)
}

function finalJson(rows: readonly Row[]): Record<string, unknown> {
  const final = rows.findLast(row => row.type === 'final')
  if (typeof final?.text !== 'string') throw new Error('GLM CLI run produced no final response')
  const text = final.text
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('GLM response did not contain a JSON object')
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new Error('GLM response JSON could not be parsed')
  }
}

function expectPriorWriteOutcomeUnknown(result: Record<string, unknown>): void {
  expect(result.prior_write_outcome).toBe('unknown')
}

interface ContinuationVerification extends Pick<VerificationDiagnostics,
  | 'resumedToolCallCount'
  | 'markerReadCallFound'
  | 'markerReadResultFound'
  | 'finalMessageFound'
  | 'finalAfterMarkerRead'
  | 'resumedWriteCount'
  | 'markerUnchanged'
  | 'continuationFieldsChecked'
  | 'continuationChecks'
  | 'continuationJobFields'
> {
  lastCheck: string
}

/** Check the first marker read, read-only outcome, and every returned seed field. */
async function verifyContinuation(
  rows: readonly Row[],
  resumedRecords: readonly Row[],
  cwd: string,
  resumeMarker: string,
  diagnostics: ContinuationVerification,
  stages: VerificationStages,
): Promise<void> {
  const resumedUser = rows.find(row => row.type === 'user/message' && eventText(row).includes(resumeMarker))
  diagnostics.lastCheck = 'continuation.resumed_user'
  expect(resumedUser).toBeDefined()
  const resumedRows = rows.filter(row => row.seq! > resumedUser!.seq!)
  const resumedToolCalls = resumedRows.filter(row => row.type === 'tool/call')
  diagnostics.resumedToolCallCount = resumedToolCalls.length
  const markerReadCall = resumedToolCalls.find(row => row.type === 'tool/call' && (() => {
    const data = row.data as Record<string, unknown> | undefined
    return typeof data?.arguments === 'string' && /cat\s+marker\.txt/.test(data.arguments)
  })())
  diagnostics.markerReadCallFound = markerReadCall !== undefined
  diagnostics.lastCheck = 'continuation.marker_read_call_first'
  expect(resumedToolCalls[0]?.seq).toBe(markerReadCall?.seq)
  const readCallData = markerReadCall?.data as Record<string, unknown> | undefined
  const readCallId = readCallData?.callId
  const markerReadResult = resumedRows.find(row => row.type === 'tool/result'
    && (() => {
      const data = row.data as Record<string, unknown> | undefined
      const message = data?.message as Record<string, unknown> | undefined
      return message?.toolCallId === readCallId
    })()
    && eventText(row).includes(markerContents))
  const final = resumedRows.findLast(row => row.type === 'assistant/message')
  diagnostics.markerReadResultFound = markerReadResult !== undefined
  diagnostics.finalMessageFound = final !== undefined
  diagnostics.lastCheck = 'continuation.marker_read_result'
  expect(markerReadCall).toBeDefined()
  expect(markerReadResult).toBeDefined()
  expect(final).toBeDefined()
  diagnostics.lastCheck = 'continuation.event_order'
  expect(markerReadCall!.seq).toBeGreaterThan(resumedUser!.seq!)
  expect(markerReadResult!.seq).toBeGreaterThan(markerReadCall!.seq!)
  expect(final!.seq).toBeGreaterThan(markerReadResult!.seq!)
  diagnostics.finalAfterMarkerRead = final!.seq! > markerReadResult!.seq!

  diagnostics.lastCheck = 'world.resumed_writes'
  const writes = resumedToolCalls.filter((row) => {
    const data = row.data as Record<string, unknown> | undefined
    return typeof data?.arguments === 'string' && /(?:>|tee\s|write.*marker\.txt|marker\.txt.*(?:>|tee))/i.test(data.arguments)
  })
  diagnostics.resumedWriteCount = writes.length
  expect(writes).toHaveLength(0)
  diagnostics.lastCheck = 'world.marker_unchanged'
  diagnostics.markerUnchanged = await readFile(join(cwd, 'marker.txt'), 'utf8') === marker
  expect(diagnostics.markerUnchanged).toBe(true)
  stages.world = true

  diagnostics.lastCheck = 'continuation.final_json'
  const continuation = finalJson(resumedRecords)
  const returnedChecks = Array.isArray(continuation.checks) ? continuation.checks : []
  const continuationChecks = {
    arrayPresent: Array.isArray(continuation.checks),
    lengthMatches: returnedChecks.length === facts.checks.length,
    items: facts.checks.map((check, index) => {
      const actual = recordOf(returnedChecks[index])
      return {
        checkId: check.id,
        fields: [
          observeField(actual, 'id', check.id),
          observeField(actual, 'status', check.status),
          observeField(actual, 'output', check.output),
          observeField(actual, 'check_method', check.check_method),
        ],
      }
    }),
  }
  const actualJob = recordOf(continuation.job)
  diagnostics.continuationJobFields = Object.entries(job).map(([field, expected]) =>
    observeField(actualJob, field, expected))
  diagnostics.continuationChecks = continuationChecks

  diagnostics.lastCheck = 'continuation.checks.array'
  expect(Array.isArray(continuation.checks)).toBe(true)
  expect(returnedChecks).toHaveLength(facts.checks.length)
  for (const [index, check] of facts.checks.entries()) {
    for (const [field, expected] of Object.entries(check)) {
      diagnostics.lastCheck = `continuation.checks.${check.id}.${field}`
      diagnostics.continuationFieldsChecked += 1
      expect(returnedChecks[index]).toMatchObject({ [field]: expected })
    }
  }
  const continuationFields = {
    latest_correction: facts.latest_correction,
    cancellation: facts.cancellation,
    marker_contents: markerContents,
    retry_decision: 'do_not_retry',
  }
  for (const [field, expected] of Object.entries(continuationFields)) {
    diagnostics.lastCheck = `continuation.${field}`
    diagnostics.continuationFieldsChecked += 1
    expect(continuation).toMatchObject({ [field]: expected })
  }
  for (const [field, expected] of Object.entries(job)) {
    diagnostics.lastCheck = `continuation.job.${field}`
    diagnostics.continuationFieldsChecked += 1
    expect(continuation).toMatchObject({ job: { [field]: expected } })
  }
  diagnostics.lastCheck = 'continuation.prior_write_outcome'
  diagnostics.continuationFieldsChecked += 1
  expectPriorWriteOutcomeUnknown(continuation)
}

it('keeps prior-write status separate from explanation prose', () => {
  expectPriorWriteOutcomeUnknown({
    prior_write_outcome: 'unknown',
    prior_write_explanation: 'The marker may have been written before compaction.',
  })
  expect(() => { expectPriorWriteOutcomeUnknown({ prior_write_outcome: 'success' }) }).toThrow()
  expect(() => { expectPriorWriteOutcomeUnknown({ prior_write_outcome: 'completed' }) }).toThrow()
})

it('checks the SHA-256 result fingerprint without pinning digest notation', () => {
  expectCheckpointResultFingerprint('CHK-1042 passed SHA-256 4f20a1 matched manifest', 'CHK-1042')
  expect(() => { expectCheckpointResultFingerprint('CHK-1042 passed SHA-256 a1b2c3 matched manifest', 'CHK-1042') }).toThrow()
  expect(() => { expectCheckpointResultFingerprint('CHK-1042 passed SHA-256', 'CHK-1042') }).toThrow()
})

it('keeps metadata when a shared continuation field fails', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-continuation-verifier-'))
  const diagnostics: ContinuationVerification = {
    lastCheck: 'setup',
    resumedToolCallCount: 0,
    markerReadCallFound: false,
    markerReadResultFound: false,
    finalMessageFound: false,
    finalAfterMarkerRead: false,
    resumedWriteCount: 0,
    markerUnchanged: false,
    continuationFieldsChecked: 0,
    continuationChecks: null,
    continuationJobFields: null,
  }
  const stages: VerificationStages = { seed: true, compaction: true, checkpoint: true, continuation: false, world: false }
  try {
    await writeFile(join(cwd, 'marker.txt'), marker)
    const rows: Row[] = [
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'RESUME_AFTER_COMPACTION' }] } },
      { seq: 2, type: 'tool/call', data: { callId: 'synthetic-read-call', arguments: 'cat marker.txt' } },
      { seq: 3, type: 'tool/result', data: {
        message: { toolCallId: 'synthetic-read-call', content: [{ type: 'text', text: markerContents }] },
      } },
      { seq: 4, type: 'assistant/message', data: { content: [{ type: 'text', text: 'done' }] } },
    ]
    const checks = facts.checks.map(check => ({ ...check }))
    checks[0]!.output = 'synthetic mismatch'
    const resumedRecords: Row[] = [{
      type: 'final',
      text: JSON.stringify({
        checks,
        latest_correction: facts.latest_correction,
        cancellation: facts.cancellation,
        job,
        marker_contents: markerContents,
        prior_write_outcome: 'unknown',
        retry_decision: 'do_not_retry',
      }),
    }]
    let rejected = false
    try {
      await verifyContinuation(rows, resumedRecords, cwd, 'RESUME_AFTER_COMPACTION', diagnostics, stages)
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)
    expect(stages.world).toBe(true)
    expect(diagnostics.lastCheck).toBe('continuation.checks.CHK-1042.output')
    expect(diagnostics.continuationChecks?.items[0]?.fields[2]).toEqual({
      field: 'output',
      matched: false,
      category: 'value_mismatch',
    })
    expect(diagnostics.continuationJobFields?.every(field => field.matched)).toBe(true)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

it('selects only the checkpoint correlated to the summary', () => {
  expect(isCompactionCheckpointEvent({
    type: 'user/message',
    data: { source: { kind: 'compact-checkpoint', compactionId: 'comp-1' } },
  }, 'comp-1')).toBe(true)
  expect(isCompactionCheckpointEvent({
    type: 'user/message',
    data: { source: { kind: 'compact-checkpoint', compactionId: 'comp-2' } },
  }, 'comp-1')).toBe(false)
  expect(isCompactionCheckpointEvent({
    type: 'user/message',
    data: { message: { source: { kind: 'user' } } },
  }, 'comp-1')).toBe(false)
  expect(isCompactionCheckpointEvent({
    type: 'user/message',
    data: { source: { kind: 'compact-checkpoint' } },
  }, undefined)).toBe(false)
})

it('folds a quoted seed prompt into its replacement checkpoint', () => {
  const seed: Row = {
    seq: 1,
    type: 'user/message',
    surfaceOp: 'append',
    data: { content: [{ type: 'text', text: seedPrompt }], source: { kind: 'user' } },
  }
  const checkpoint: Row = {
    seq: 2,
    type: 'user/message',
    surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 },
    data: {
      content: [{ type: 'text', text: `Summary quotes: ${seedPrompt}` }],
      source: { kind: 'compact-checkpoint', compactionId: 'comp-1' },
    },
  }
  const folded = activeSurface([seed, checkpoint])
  expect(folded).toContain(checkpoint)
  expect(folded).not.toContain(seed)
  expect(isCompactionCheckpointEvent(folded[0]!, 'comp-1')).toBe(true)
  expect(eventText(folded[0]!).includes(seedPrompt)).toBe(true)
  expect(activeSurface([seed])).toContain(seed)
})

it.skipIf(!enabled)('preserves and resumes a GLM compaction checkpoint', { timeout: 510_000, retry: 0 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-glm-compaction-live-'))
  const stages: VerificationStages = {
    seed: false,
    compaction: false,
    checkpoint: false,
    continuation: false,
    world: false,
  }
  const diagnostics: VerificationDiagnostics = {
    lastCheck: 'setup.synthetic_files',
    routeHeaderCount: 0,
    summaryCount: 0,
    shadowedSequenceCount: 0,
    resumedToolCallCount: 0,
    markerReadCallFound: false,
    markerReadResultFound: false,
    finalMessageFound: false,
    finalAfterMarkerRead: false,
    continuationFieldsChecked: 0,
    resumedWriteCount: 0,
    markerUnchanged: false,
    eventCaptureFailed: false,
    cleanupFailed: false,
    continuationChecks: null,
    continuationJobFields: null,
    checkpointEventFound: false,
    activeCheckpointPresent: false,
    activeSeedEventAbsent: false,
    activeResumePromptPresent: false,
    checkpointQuotesSeedPrompt: false,
    nonCheckpointSeedPromptMatchCount: 0,
    checkpointCheckMethods: [],
  }
  let testFailed = false
  let evidenceWriteFailed = false
  try {
    await writeFile(join(cwd, 'ledger.json'), JSON.stringify({ ...facts, prior_write: priorWrite, padding }, null, 2) + '\n')
    await writeFile(join(cwd, 'job-report.json'), JSON.stringify(job, null, 2) + '\n')
    await writeFile(join(cwd, 'marker.txt'), marker)

    diagnostics.lastCheck = 'seed.run'
    const seedRecords = await runHeadless(cwd, [seedPrompt])
    const sessionId = seedRecords.find(row => row.type === 'session')?.sessionId
    diagnostics.lastCheck = 'seed.session_id'
    expect(typeof sessionId).toBe('string')
    diagnostics.lastCheck = 'seed.final_json'
    const seed = finalJson(seedRecords)
    diagnostics.lastCheck = 'seed.response_fields'
    expect(seed).toMatchObject({
      checks: facts.checks,
      latest_correction: facts.latest_correction,
      cancellation: facts.cancellation,
      job,
      marker_contents: markerContents,
    })
    diagnostics.lastCheck = 'seed.prior_write_outcome'
    expectPriorWriteOutcomeUnknown(seed)
    stages.seed = true

    diagnostics.lastCheck = 'seed.remove_source_ledgers'
    await unlink(join(cwd, 'ledger.json'))
    await unlink(join(cwd, 'job-report.json'))

    diagnostics.lastCheck = 'continuation.run'
    const resumedRecords = await runHeadless(cwd, ['--session-id', String(sessionId), resumePrompt])
    const rows = await sessionRows(cwd)
    const routedHeaders = rows.filter(row => row.type === 'request/header').flatMap((row) => {
      const data = row.data as Record<string, unknown> | undefined
      const header = data?.header as Record<string, unknown> | undefined
      const config = header?.config as Record<string, unknown> | undefined
      return config === undefined ? [] : [config]
    })
    diagnostics.routeHeaderCount = routedHeaders.length
    diagnostics.lastCheck = 'route.headers_present'
    expect(routedHeaders.length).toBeGreaterThan(0)
    diagnostics.lastCheck = 'route.provider_model'
    expect(routedHeaders.every(config => config.provider === 'zai'
      && config.model === 'glm-5.3-flash')).toBe(true)
    const summaries = rows.filter(row => row.type === 'compaction/summary')
    diagnostics.summaryCount = summaries.length
    diagnostics.lastCheck = 'compaction.summary_count'
    expect(summaries).toHaveLength(1)
    const summaryData = summaries[0]?.data as Record<string, unknown> | undefined
    const shadowed = new Set(Array.isArray(summaryData?.shadowedSeqs) ? summaryData.shadowedSeqs : [])
    diagnostics.shadowedSequenceCount = shadowed.size
    diagnostics.lastCheck = 'compaction.shadowed_sequences'
    expect(shadowed.size).toBeGreaterThan(0)

    const sourceUser = rows.find(row => row.type === 'user/message' && eventText(row).includes(seedPrompt))
    const sourceTool = rows.find(row => row.type === 'tool/result' && eventText(row).includes('CHK-1042'))
    const sourceJob = rows.find(row => row.type === 'tool/result' && eventText(row).includes('synthetic report only'))
    diagnostics.lastCheck = 'compaction.source_events'
    expect(sourceUser).toBeDefined()
    expect(sourceTool).toBeDefined()
    expect(sourceJob).toBeDefined()
    diagnostics.lastCheck = 'compaction.seed_sequences_shadowed'
    expect(shadowed.has(sourceUser?.seq)).toBe(true)
    expect(shadowed.has(sourceTool?.seq)).toBe(true)
    expect(shadowed.has(sourceJob?.seq)).toBe(true)
    stages.compaction = true

    const checkpoint = rows.find(row => isCompactionCheckpointEvent(row, summaryData?.compactionId)
      && typeof row.surfaceOp === 'object' && row.surfaceOp !== null)
    diagnostics.checkpointEventFound = checkpoint !== undefined
    diagnostics.lastCheck = 'checkpoint.event'
    expect(checkpoint).toBeDefined()
    const seedAssistant = rows.findLast(row => row.type === 'assistant/message' && row.seq! < checkpoint!.seq!)
    diagnostics.lastCheck = 'checkpoint.seed_assistant'
    expect(seedAssistant).toBeDefined()
    const seedSurface = rows.filter(row => row.seq! >= sourceUser!.seq! && row.seq! <= seedAssistant!.seq!
      && row.surfaceOp === 'append')
    diagnostics.lastCheck = 'checkpoint.seed_surface'
    expect(seedSurface.length).toBeGreaterThan(0)
    diagnostics.lastCheck = 'checkpoint.seed_surface_shadowed'
    for (const source of seedSurface) expect(shadowed.has(source.seq)).toBe(true)
    const checkpointText = eventText(checkpoint!)
    diagnostics.checkpointCheckMethods = facts.checks.map(check => ({
      checkId: check.id,
      exactMethodPresent: checkpointText.includes(check.check_method),
    }))
    for (const check of facts.checks) {
      diagnostics.lastCheck = `checkpoint.check.${check.id}.id`
      expect(checkpointText).toContain(check.id)
      diagnostics.lastCheck = `checkpoint.check.${check.id}.status`
      const statusTerms = checkpointStatusVariants[check.status] ?? []
      expect(statusTerms.some(term => checkpointText.toLowerCase().includes(term))).toBe(true)
      if (checkpointResultFingerprints[check.id] !== undefined) {
        diagnostics.lastCheck = `checkpoint.check.${check.id}.result_fingerprint`
        expectCheckpointResultFingerprint(checkpointText, check.id)
      }
      diagnostics.lastCheck = `checkpoint.check.${check.id}.check_method`
      expect(checkpointText).toContain(check.check_method)
    }
    diagnostics.lastCheck = 'checkpoint.correction_and_cancellation'
    expect(checkpointText.toLowerCase()).toContain('checksum')
    expect(checkpointText.toLowerCase()).toContain('cancel')
    diagnostics.lastCheck = 'checkpoint.job_fields'
    expect(checkpointText).toContain(job.evidence)
    expect(checkpointText).toContain(job.completion)
    expect(checkpointText).toContain(job.results)
    expect(checkpointText).toContain(job.id)
    expect(checkpointText).toContain(job.reported_status)
    expect(checkpointText).toContain(job.last_observed_status)
    expect(checkpointText).toContain(job.output_location)

    const activeText = activeSurface(rows).map(eventText).join('\n')
    const activeSeqs = new Set(activeSurface(rows).flatMap(row => row.seq === undefined ? [] : [row.seq]))
    diagnostics.lastCheck = 'checkpoint.seed_surface_replaced'
    for (const source of seedSurface) expect(activeSeqs.has(source.seq!)).toBe(false)
    diagnostics.activeCheckpointPresent = activeText.includes(checkpointText)
    diagnostics.activeSeedEventAbsent = !activeSeqs.has(sourceUser!.seq!)
    diagnostics.activeResumePromptPresent = activeText.includes(resumePrompt)
    diagnostics.checkpointQuotesSeedPrompt = checkpointText.includes(seedPrompt)
    diagnostics.nonCheckpointSeedPromptMatchCount = activeSurface(rows)
      .filter(row => row.seq !== checkpoint!.seq && eventText(row).includes(seedPrompt)).length
    diagnostics.lastCheck = 'checkpoint.active_checkpoint_present'
    expect(diagnostics.activeCheckpointPresent).toBe(true)
    diagnostics.lastCheck = 'checkpoint.active_seed_event_absent'
    expect(diagnostics.activeSeedEventAbsent).toBe(true)
    diagnostics.lastCheck = 'checkpoint.active_resume_prompt_present'
    expect(diagnostics.activeResumePromptPresent).toBe(true)
    stages.checkpoint = true

    await verifyContinuation(
      rows,
      resumedRecords,
      cwd,
      'RESUME_AFTER_COMPACTION',
      diagnostics,
      stages,
    )
    stages.continuation = true
    diagnostics.lastCheck = 'complete'
  } catch (error) {
    testFailed = true
    void error
  } finally {
    let rows: Row[] = []
    try {
      rows = await sessionRows(cwd)
    } catch {
      diagnostics.eventCaptureFailed = true
    }
    try {
      await rm(cwd, { recursive: true, force: true })
    } catch {
      diagnostics.cleanupFailed = true
    }
    try {
      await saveEvidence(rows, stages, diagnostics)
    } catch {
      evidenceWriteFailed = true
    }
  }
  if (testFailed) throw new Error(`GLM evaluation failed at ${diagnostics.lastCheck}`)
  if (diagnostics.eventCaptureFailed || diagnostics.cleanupFailed || evidenceWriteFailed) {
    throw new Error('GLM evaluation could not capture synthetic verification evidence or clean up its workspace')
  }
})

type AutoObservation = {
  phase: 'baseline'
  pressureTokens: number
  contextWindow: number
  reservedTokens: number
} | {
  phase: 'automatic'
  pressureTokens: number
  thresholdTokens: number
  contextWindow: number
  reservedTokens: number
  aboveThreshold: boolean
} | {
  phase: 'compaction-llm'
  selectedMessageCount: number
  roleTail: string[]
  lastInstructionRole: string | null
  lastInstructionHasDirective: boolean
  selectedTailIsNeutralUser: boolean
  inputCheckIds: Record<string, boolean>
  inputCheckMethods: Record<string, boolean>
  inputOutputFingerprints: Record<string, boolean>
  inputJobIdPresent: boolean
  inputJobFields: Record<string, boolean>
  outputHeadings: Record<string, boolean>
  outputIsExactNeutralAck: boolean
  outputCharacters: number
  outputTextBlocks: number
  finishCategory: string
}

function calibrateThreshold(pressureTokens: number, contextWindow: number, reservedTokens: number): {
  thresholdTokens: number
  thresholdRatio: number
  roundedThresholdTokens: number
} {
  const thresholdTokens = pressureTokens - 64
  const thresholdRatio = (thresholdTokens + 0.5) / contextWindow
  return {
    thresholdTokens,
    thresholdRatio,
    roundedThresholdTokens: Math.floor(Math.min(
      contextWindow * thresholdRatio,
      contextWindow - reservedTokens,
    )),
  }
}

interface AutoVerificationDiagnostics extends ContinuationVerification {
  lastCheck: string
  shadowedSequenceCount: number
  sourceFactEventsAbsent: boolean | null
  neutralTailFactFree: boolean | null
  compactionLlm: Extract<AutoObservation, { phase: 'compaction-llm' }> | null
  checkpointChecks: Array<{ checkId: string; fields: FieldObservation[] }> | null
  checkpointJobFields: FieldObservation[] | null
  eventCaptureFailed: boolean
  observationCaptureFailed: boolean
  cleanupFailed: boolean
}

const autoEnabled = process.env.DSH_LIVE_AUTO_COMPACTION_EVAL === '1'
const autoResumePrompt = [
  'RESUME_AFTER_AUTO_COMPACTION: run exactly `cat marker.txt` as your first tool call before deciding whether any retry is safe. The seed ledger and job report have been removed, so use the compacted checkpoint and marker only.',
  'If it contains marker=prior-write-may-have-landed, do not write; set prior_write_outcome to the exact status string unknown and retry_decision to the exact status string do_not_retry. Put any explanation only in prior_write_explanation.',
  'If the marker is absent, write marker=prior-write-may-have-landed once, then read it back.',
  'Return one JSON object with checks (id, status, output, check_method), latest_correction, cancellation, job (id, reported_status, last_observed_status, completion, results, output_location, check_method, evidence, note), marker_contents without a trailing newline, prior_write_outcome, prior_write_explanation, and retry_decision.',
].join(' ')

it('loads the isolated auto overlay and calibrates below measured pressure', async () => {
  const isolatedHome = await mkdtemp(join(tmpdir(), 'dsh-glm-auto-overlay-home-'))
  try {
    const result = await runLoaderSmoke({
      label: 'headless GLM automatic compaction overlay composition',
      tempDirPrefix: 'glm-auto-overlay-dump-',
      binScript,
      configPath: autoConfigPath,
      binArgs: [
        '--profile', 'headless',
        '--patch', autoConfigPath,
        '--dump-config',
      ],
      tsconfigPath,
      sourceImport: 'tsx/esm',
      env: {
        DSH_HOME: isolatedHome,
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
    })
    expect(result.stderr.length === 0).toBe(true)
    expect(result.stdout.includes('auto: false')).toBe(true)
    expect(result.stdout.includes('maxTokens: 8192')).toBe(true)
    expect(result.stdout.includes('compaction-glm-auto-observer')).toBe(true)
    expect(result.stdout.includes('compaction-glm-live-fixture')).toBe(false)
    const entries = load(result.stdout, { schema: entryListSchema }) as EntryOptions[]
    expect(entries.find(entry => entry.id === 'tool-result-pruner')?.disabled).toBe(true)
    expect(entries.find(entry => entry.id === 'agent-instructions')?.config).toEqual({
      maxBytes: 0, projectRootMarkers: [], instructionFileCandidates: [], localInstructionFileCandidates: [],
    })
    expect(entries.find(entry => entry.id === 'skill-filesystem')?.config).toEqual({
      includeDefaultRoots: false, customSkillDirs: [],
    })
    expect(entries.find(entry => entry.id === 'tool-fs-search')?.config).toEqual({ knowledgeRoots: [] })
  } finally {
    await rm(isolatedHome, { recursive: true, force: true })
  }

  for (const [pressureTokens, contextWindow, reservedTokens] of [
    [129, 1_024, 128],
    [512, 65_536, 4_096],
    [4_096, 128_000, 8_192],
  ] as const) {
    const calibrated = calibrateThreshold(pressureTokens, contextWindow, reservedTokens)
    expect(calibrated.thresholdTokens).toBeGreaterThan(0)
    expect(calibrated.roundedThresholdTokens).toBeLessThan(pressureTokens)
    expect(calibrated.thresholdRatio).toBeGreaterThan(0)
    expect(calibrated.thresholdRatio).toBeLessThanOrEqual(1)
  }
})

/** Persist only counts, booleans, route labels, and event type/sequence metadata. */
async function saveAutoEvidence(
  rows: readonly Row[],
  stages: VerificationStages,
  diagnostics: AutoVerificationDiagnostics,
  observations: readonly AutoObservation[],
): Promise<void> {
  const routeCount = rows.filter(row => row.type === 'request/header').length
  const events = rows.filter(row => ['compaction/start', 'compaction/summary', 'compaction/end', 'user/message', 'tool/call', 'tool/result', 'assistant/message'].includes(String(row.type)))
  await mkdir(dirname(autoEvidencePath), { recursive: true })
  await writeFile(autoEvidencePath, JSON.stringify({
    evidence: 'synthetic workspace; no production job was started',
    verification: {
      status: Object.values(stages).every(Boolean)
        && !diagnostics.eventCaptureFailed && !diagnostics.observationCaptureFailed && !diagnostics.cleanupFailed
        ? 'passed' : 'failed',
      stages,
      lastCheck: diagnostics.lastCheck,
      observations: {
        routeHeaderCount: routeCount,
        summaryCount: rows.filter(row => row.type === 'compaction/summary').length,
        shadowedSequenceCount: diagnostics.shadowedSequenceCount,
        sourceFactEventsAbsent: diagnostics.sourceFactEventsAbsent,
        neutralTailFactFree: diagnostics.neutralTailFactFree,
        compactionLlm: diagnostics.compactionLlm,
        checkpointChecks: diagnostics.checkpointChecks,
        checkpointJobFields: diagnostics.checkpointJobFields,
        markerReadCallFound: diagnostics.markerReadCallFound,
        resumedWriteCount: diagnostics.resumedWriteCount,
        markerUnchanged: diagnostics.markerUnchanged,
        continuationFieldsChecked: diagnostics.continuationFieldsChecked,
        continuationChecks: diagnostics.continuationChecks,
        continuationJobFields: diagnostics.continuationJobFields,
        measurements: observations,
        eventCaptureFailed: diagnostics.eventCaptureFailed,
        observationCaptureFailed: diagnostics.observationCaptureFailed,
        cleanupFailed: diagnostics.cleanupFailed,
      },
    },
    scenario: { checkIds: facts.checks.map(check => check.id), jobId: job.id, markerContents },
    routedModels: [...new Map(rows.filter(row => row.type === 'request/header').flatMap((row) => {
      const data = row.data as Record<string, unknown> | undefined
      const header = data?.header as Record<string, unknown> | undefined
      const config = header?.config as Record<string, unknown> | undefined
      return typeof config?.provider === 'string' && typeof config.model === 'string'
        ? [[`${config.provider}/${config.model}`, { provider: config.provider, model: config.model }] as const]
        : []
    })).values()],
    events: events.map(row => ({ ...(row.seq === undefined ? {} : { seq: row.seq }), type: row.type })),
  }, null, 2) + '\n')
}

it.skipIf(!autoEnabled)('compacts GLM history automatically above the measured pressure threshold', { timeout: 600_000, retry: 0 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-glm-auto-compaction-live-'))
  const generatedOverlay = join(dirname(autoConfigPath), `.glm-auto-compaction-${randomUUID()}.patch.yml`)
  const stages: VerificationStages = { seed: false, compaction: false, checkpoint: false, continuation: false, world: false }
  const diagnostics: AutoVerificationDiagnostics = {
    lastCheck: 'setup.synthetic_files',
    shadowedSequenceCount: 0,
    sourceFactEventsAbsent: null,
    neutralTailFactFree: null,
    compactionLlm: null,
    checkpointChecks: null,
    checkpointJobFields: null,
    resumedToolCallCount: 0,
    markerReadCallFound: false,
    markerReadResultFound: false,
    finalMessageFound: false,
    finalAfterMarkerRead: false,
    resumedWriteCount: 0,
    markerUnchanged: false,
    continuationFieldsChecked: 0,
    continuationChecks: null,
    continuationJobFields: null,
    eventCaptureFailed: false,
    observationCaptureFailed: false,
    cleanupFailed: false,
  }
  const observations: AutoObservation[] = []
  let testFailed = false
  let evidenceWriteFailed = false
  try {
    await writeFile(join(cwd, 'ledger.json'), JSON.stringify({ ...facts, prior_write: priorWrite, padding }, null, 2) + '\n')
    await writeFile(join(cwd, 'job-report.json'), JSON.stringify(job, null, 2) + '\n')
    await writeFile(join(cwd, 'marker.txt'), marker)

    diagnostics.lastCheck = 'seed.run'
    const seedRecords = await runHeadless(cwd, [seedPrompt], autoConfigPath)
    const sessionId = seedRecords.find(row => row.type === 'session')?.sessionId
    diagnostics.lastCheck = 'seed.session_id'
    expect(typeof sessionId).toBe('string')
    const seed = finalJson(seedRecords)
    diagnostics.lastCheck = 'seed.response_fields'
    expect(seed).toMatchObject({
      checks: facts.checks,
      latest_correction: facts.latest_correction,
      cancellation: facts.cancellation,
      job,
      marker_contents: markerContents,
    })
    diagnostics.lastCheck = 'seed.prior_write_outcome'
    expectPriorWriteOutcomeUnknown(seed)
    stages.seed = true
    await unlink(join(cwd, 'ledger.json'))
    await unlink(join(cwd, 'job-report.json'))

    diagnostics.lastCheck = 'baseline.run'
    const baselineRecords = await runHeadless(cwd, [
      '--session-id',
      String(sessionId),
      'AUTO_THRESHOLD_BASELINE: reply exactly BASELINE_ACK and do not mention earlier facts. Do not use tools.',
    ], autoConfigPath)
    const observationPath = join(cwd, '.auto-compaction-observations.jsonl')
    const recorded = (await readFile(observationPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as AutoObservation)
    observations.push(...recorded)
    const baselineRows = await sessionRows(cwd)
    const baselineUser = baselineRows.find(row => row.type === 'user/message'
      && eventText(row).includes('AUTO_THRESHOLD_BASELINE'))
    diagnostics.lastCheck = 'baseline.neutral_tail_fact_free'
    expect(baselineUser).toBeDefined()
    if (baselineUser === undefined) throw new Error('automatic compaction baseline prompt is absent')
    const neutralAssistant = baselineRows.findLast(row => row.type === 'assistant/message' && row.seq! > baselineUser.seq!)
    const neutralText = neutralAssistant === undefined ? '' : eventText(neutralAssistant)
    const baselineReply = baselineRecords.findLast(row => row.type === 'final')?.text
    const seedFactTerms = [
      ...facts.checks.flatMap(check => [check.id, check.output, check.check_method]),
      facts.latest_correction,
      facts.cancellation,
      ...Object.values(job),
    ]
    diagnostics.neutralTailFactFree = neutralAssistant !== undefined
      && typeof baselineReply === 'string' && baselineReply.trim() === 'BASELINE_ACK'
      && seedFactTerms.every(term => !neutralText.includes(term))
    expect(diagnostics.neutralTailFactFree).toBe(true)
    const baseline = recorded.find(row => row.phase === 'baseline')
    diagnostics.lastCheck = 'baseline.measurement'
    expect(baseline).toBeDefined()
    if (baseline === undefined || baseline.phase !== 'baseline') {
      throw new Error('automatic compaction baseline measurement is absent')
    }
    expect(baseline.pressureTokens).toBeGreaterThan(128)
    expect(baseline.contextWindow).toBeGreaterThan(baseline.pressureTokens)

    const calibration = calibrateThreshold(baseline.pressureTokens, baseline.contextWindow, baseline.reservedTokens)
    const { thresholdTokens, thresholdRatio, roundedThresholdTokens: calibratedThreshold } = calibration
    diagnostics.lastCheck = 'threshold.calibration'
    expect(calibratedThreshold).toBeGreaterThan(0)
    expect(calibratedThreshold).toBeLessThan(baseline.pressureTokens)
    expect(calibratedThreshold).toBe(thresholdTokens)
    expect(thresholdRatio).toBeGreaterThan(0)
    expect(thresholdRatio).toBeLessThanOrEqual(1)
    const baseOverlay = await readFile(autoConfigPath, 'utf8')
    expect(baseOverlay).toContain('thresholdRatio: 0.8')
    await writeFile(generatedOverlay, baseOverlay
      .replace('auto: false', 'auto: true')
      .replace('thresholdRatio: 0.8', `thresholdRatio: ${thresholdRatio}`), { flag: 'wx' })

    diagnostics.lastCheck = 'continuation.run'
    const resumedRecords = await runHeadless(cwd, ['--session-id', String(sessionId), autoResumePrompt], generatedOverlay, String(thresholdRatio))
    const refreshed = (await readFile(observationPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as AutoObservation)
    observations.splice(0, observations.length, ...refreshed)
    diagnostics.compactionLlm = refreshed.find(row => row.phase === 'compaction-llm') ?? null
    const rows = await sessionRows(cwd)
    const routedHeaders = rows.filter(row => row.type === 'request/header').flatMap((row) => {
      const data = row.data as Record<string, unknown> | undefined
      const header = data?.header as Record<string, unknown> | undefined
      const config = header?.config as Record<string, unknown> | undefined
      return config === undefined ? [] : [config]
    })
    diagnostics.lastCheck = 'route.provider_model'
    expect(routedHeaders.length).toBeGreaterThan(0)
    expect(routedHeaders.every(config => config.provider === 'zai' && config.model === 'glm-5.3-flash')).toBe(true)

    const automatic = rows.filter(row => row.type === 'compaction/start' || row.type === 'compaction/summary' || row.type === 'compaction/end')
    const starts = automatic.filter(row => row.type === 'compaction/start')
    const summaries = automatic.filter(row => row.type === 'compaction/summary')
    const ends = automatic.filter(row => row.type === 'compaction/end')
    diagnostics.lastCheck = 'compaction.automatic_lifecycle'
    expect(starts).toHaveLength(1)
    expect(summaries).toHaveLength(1)
    expect(ends).toHaveLength(1)
    const startData = starts[0]!.data as Record<string, unknown>
    const summaryData = summaries[0]!.data as Record<string, unknown>
    const endData = ends[0]!.data as Record<string, unknown>
    expect(startData.compactionId).toBe(summaryData.compactionId)
    expect(startData.compactionId).toBe(endData.compactionId)
    expect(startData.turn).not.toBeNull()
    expect(startData.sourceCommandId).toBeUndefined()
    expect(starts[0]!.seq).toBeLessThan(summaries[0]!.seq!)
    expect(summaries[0]!.seq).toBeLessThan(ends[0]!.seq!)
    expect(endData.error).toBeUndefined()
    const automaticMeasurements = refreshed.filter(row => row.phase === 'automatic')
    diagnostics.lastCheck = 'compaction.pressure_before_after'
    expect(automaticMeasurements).toHaveLength(2)
    const before = automaticMeasurements[0]
    const after = automaticMeasurements[1]
    if (before === undefined || after === undefined) throw new Error('automatic pressure readings are incomplete')
    expect(before.pressureTokens).toBeGreaterThanOrEqual(before.thresholdTokens)
    expect(after.pressureTokens).toBeLessThan(after.thresholdTokens)
    expect(automaticMeasurements.every(row => row.thresholdTokens === calibratedThreshold
      && row.contextWindow === baseline.contextWindow
      && row.reservedTokens === baseline.reservedTokens)).toBe(true)
    stages.compaction = true

    const shadowed = new Set(Array.isArray(summaryData.shadowedSeqs) ? summaryData.shadowedSeqs : [])
    diagnostics.shadowedSequenceCount = shadowed.size
    const neutralUser = rows.find(row => row.type === 'user/message' && eventText(row).includes('AUTO_THRESHOLD_BASELINE'))
    diagnostics.lastCheck = 'compaction.neutral_tail'
    expect(neutralUser).toBeDefined()
    if (neutralUser === undefined) throw new Error('automatic compaction lost the neutral tail turn')
    const sourceUser = rows.find(row => row.type === 'user/message' && eventText(row).includes(seedPrompt))
    const sourceTool = rows.find(row => row.type === 'tool/result' && eventText(row).includes('CHK-1042'))
    const sourceJob = rows.find(row => row.type === 'tool/result' && eventText(row).includes('synthetic report only'))
    const seedAssistant = rows.findLast(row => row.type === 'assistant/message' && row.seq! < neutralUser.seq!)
    diagnostics.lastCheck = 'compaction.seed_sources'
    expect(sourceUser).toBeDefined()
    expect(neutralUser).toBeDefined()
    expect(sourceTool).toBeDefined()
    expect(sourceJob).toBeDefined()
    expect(seedAssistant).toBeDefined()
    expect(shadowed.size).toBeGreaterThan(0)
    for (const source of [sourceUser!, sourceTool!, sourceJob!, seedAssistant!]) expect(shadowed.has(source.seq)).toBe(true)
    const checkpoint = rows.find(row => isCompactionCheckpointEvent(row, summaryData.compactionId)
      && typeof row.surfaceOp === 'object' && row.surfaceOp !== null)
    diagnostics.lastCheck = 'checkpoint.event'
    expect(checkpoint).toBeDefined()
    const seedSurface = rows.filter(row => row.seq! >= sourceUser!.seq! && row.seq! <= seedAssistant!.seq! && row.surfaceOp === 'append')
    const checkpointText = eventText(checkpoint!)
    const active = activeSurface(rows)
    const activeSeqs = new Set(active.flatMap(row => row.seq === undefined ? [] : [row.seq]))
    diagnostics.sourceFactEventsAbsent = seedSurface.every(source => !activeSeqs.has(source.seq!))
    diagnostics.checkpointChecks = facts.checks.map((check) => {
      const fields = [observeTextField(checkpointText, 'id', check.id)]
      const statusMatched = (checkpointStatusVariants[check.status] ?? [])
        .some(term => checkpointText.toLowerCase().includes(term))
      fields.push({ field: 'status', matched: statusMatched, ...(statusMatched ? {} : { category: 'value_mismatch' as const }) })
      fields.push(observeTextField(checkpointText, 'check_method', check.check_method))
      const fingerprint = checkpointResultFingerprints[check.id]
      if (fingerprint !== undefined) fields.push(observeTextField(checkpointText, 'output_fingerprint', fingerprint))
      return { checkId: check.id, fields }
    })
    diagnostics.checkpointJobFields = Object.entries(job).map(([field, expected]) =>
      observeTextField(checkpointText, field, expected))
    diagnostics.lastCheck = 'compaction.llm_diagnostics'
    const compactionLlm = diagnostics.compactionLlm
    expect(compactionLlm).toBeDefined()
    if (compactionLlm === null) throw new Error('automatic compaction LLM metadata is absent')
    expect(compactionLlm.lastInstructionHasDirective).toBe(true)
    expect(compactionLlm.selectedTailIsNeutralUser).toBe(true)
    expect(compactionLlm.roleTail.slice(-2)).toEqual(['user', 'user'])
    expect(Object.values(compactionLlm.inputCheckIds).every(Boolean)).toBe(true)
    expect(Object.values(compactionLlm.inputCheckMethods).every(Boolean)).toBe(true)
    expect(Object.values(compactionLlm.inputOutputFingerprints).every(Boolean)).toBe(true)
    expect(compactionLlm.inputJobIdPresent).toBe(true)
    expect(Object.values(compactionLlm.inputJobFields).every(Boolean)).toBe(true)
    for (const source of seedSurface) expect(shadowed.has(source.seq)).toBe(true)
    const checkpointChecks = diagnostics.checkpointChecks
    const checkpointJobFields = diagnostics.checkpointJobFields
    if (checkpointChecks === null || checkpointJobFields === null) {
      throw new Error('automatic checkpoint metadata was not calculated')
    }
    for (const checkResult of checkpointChecks) {
      for (const field of checkResult.fields) {
        diagnostics.lastCheck = `checkpoint.checks.${checkResult.checkId}.${field.field}`
        expect(field.matched).toBe(true)
      }
    }
    diagnostics.lastCheck = 'checkpoint.correction_and_cancellation'
    expect(checkpointText.toLowerCase()).toContain('checksum')
    expect(checkpointText.toLowerCase()).toContain('cancel')
    for (const field of checkpointJobFields) {
      diagnostics.lastCheck = `checkpoint.job.${field.field}`
      expect(field.matched).toBe(true)
    }
    diagnostics.lastCheck = 'checkpoint.source_facts_absent'
    expect(diagnostics.sourceFactEventsAbsent).toBe(true)
    expect(active.some(row => isCompactionCheckpointEvent(row, summaryData.compactionId))).toBe(true)
    expect(active.some(row => row.type === 'user/message' && eventText(row).includes('RESUME_AFTER_AUTO_COMPACTION'))).toBe(true)
    stages.checkpoint = true

    await verifyContinuation(
      rows,
      resumedRecords,
      cwd,
      'RESUME_AFTER_AUTO_COMPACTION',
      diagnostics,
      stages,
    )
    stages.continuation = true
    diagnostics.lastCheck = 'complete'
  } catch (error) {
    testFailed = true
    void error
  } finally {
    let rows: Row[] = []
    try {
      rows = await sessionRows(cwd)
    } catch {
      diagnostics.eventCaptureFailed = true
    }
    try {
      const observationPath = join(cwd, '.auto-compaction-observations.jsonl')
      observations.splice(0, observations.length,
        ...(await readFile(observationPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as AutoObservation))
    } catch {
      diagnostics.observationCaptureFailed = true
    }
    try {
      await rm(cwd, { recursive: true, force: true })
      await rm(generatedOverlay, { force: true })
    } catch {
      diagnostics.cleanupFailed = true
    }
    try {
      await saveAutoEvidence(rows, stages, diagnostics, observations)
    } catch {
      evidenceWriteFailed = true
    }
  }
  if (testFailed) throw new Error(`GLM automatic evaluation failed at ${diagnostics.lastCheck}`)
  if (diagnostics.eventCaptureFailed || diagnostics.cleanupFailed || diagnostics.observationCaptureFailed || evidenceWriteFailed) {
    throw new Error('GLM automatic evaluation could not capture metadata evidence or clean up its workspace')
  }
})
