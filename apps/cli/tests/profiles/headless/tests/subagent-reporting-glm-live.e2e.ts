/**
 * Opt-in model evaluation through the public headless profile. Enable with
 * DSH_LIVE_SUBAGENT_EVAL=1. Only metadata survives disposable workspace cleanup.
 * Synthetic job uncertainty does not test an external job lifecycle.
 * Stale-evidence cases change the artifact only after the child's verified report.
 * Uncued cases omit the parent's explicit verification reminder.
 * The Main recovery case checks diagnosis and repair after a deterministic failure.
 */
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { load } from 'js-yaml'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const enabled = process.env.DSH_LIVE_SUBAGENT_EVAL === '1'
const configPath = fileURLToPath(new URL('../glm-subagent-reporting-live.patch.yml', import.meta.url))
const binScript = fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))
const evidenceRoot = fileURLToPath(new URL('../../../../../../work/verification/subagent-reporting-live-20261104/', import.meta.url))
type Row = Record<string, unknown>

function shellCommand(command: string, platform = process.platform): string {
  return platform === 'win32' ? `${command}; exit $LASTEXITCODE` : command
}

const recoveryScript = [
  "const fs = require('node:fs'); const [mode, profile] = process.argv.slice(2);",
  "const state = JSON.parse(fs.readFileSync('build-config.json', 'utf8'));",
  "const expected = fs.readFileSync('expected.txt', 'utf8');",
  "let passed = false; let output = '';",
  "if (mode === 'build') { passed = state.profile === 'current'; if (passed) fs.writeFileSync('result.txt', expected); output = passed ? 'BUILD-OK' : 'E_PROFILE: build configuration is incompatible. Run node recovery.cjs diagnose for details.'; }",
  "else if (mode === 'diagnose') { passed = true; output = JSON.stringify({ cause: 'E_PROFILE', actual: state.profile, required: 'current', repair: 'node recovery.cjs repair current' }); }",
  "else if (mode === 'repair') { passed = profile === 'current'; if (passed) fs.writeFileSync('build-config.json', JSON.stringify({ profile })); output = passed ? 'CONFIG-UPDATED' : 'INVALID-PROFILE'; }",
  "else if (mode === 'verify') { passed = state.profile === 'current' && fs.existsSync('result.txt') && fs.readFileSync('result.txt', 'utf8') === expected; output = passed ? 'VERIFIED' : 'ARTIFACT-NOT-VERIFIED'; }",
  "else { output = 'UNKNOWN-MODE'; }",
  "const result = { mode, passed }; fs.appendFileSync('recovery.jsonl', JSON.stringify(result) + '\\n');",
  "console.log(output); console.log('DSH-RECOVERY:' + JSON.stringify(result)); process.exit(passed ? 0 : 7);",
].join('\n')

async function prepareRecovery(cwd: string, marker: string): Promise<void> {
  await writeFile(join(cwd, 'recovery.cjs'), recoveryScript)
  await writeFile(join(cwd, 'expected.txt'), marker)
  await writeFile(join(cwd, 'build-config.json'), JSON.stringify({ profile: 'legacy' }))
}

function recoveryCompletion(rows: readonly Row[]): Row {
  const text = rows.findLast(row => row.type === 'final')?.text
  if (typeof text !== 'string') return { finalPresent: false }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { finalPresent: true, validJson: false, fenced: text.trimStart().startsWith('```') }
  }
  const object = typeof value === 'object' && value !== null && !Array.isArray(value)
  return {
    finalPresent: true, validJson: true, object,
    completed: object && record(value).outcome === 'completed',
    expectedFieldsOnly: object && Object.keys(record(value)).join(',') === 'outcome',
  }
}

function persistedAnswer(rows: readonly Row[]): string {
  const messages = rows.filter(row => row.type === 'assistant/message').map((row) => {
    const message = record(record(row.data).message)
    if (!Array.isArray(message.content)) throw new Error('expected assistant content blocks')
    return message.content.flatMap((value: unknown) => {
      const block = record(value)
      return block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
    }).join('')
  })
  return messages.findLast(text => text.length > 0) ?? ''
}

it('compares final output with durable text blocks without adding separators or reasoning', () => {
  const message = (content: Row[]): Row => ({ type: 'assistant/message', data: { message: { content } } })
  expect(persistedAnswer([
    message([{ type: 'text', text: 'progress' }]),
    message([{ type: 'reasoning', text: 'private' }, { type: 'text', text: '{"outcome":' }, { type: 'text', text: '"completed"}' }]),
    message([{ type: 'tool-call', name: 'verify' }]),
  ])).toBe('{"outcome":"completed"}')
  expect(persistedAnswer([])).toBe('')
})

it('classifies recovery responses without retaining model text', () => {
  const response = (text: string) => recoveryCompletion([{ type: 'final', text }])
  expect(response('{"outcome":"completed"}')).toEqual({ finalPresent: true, validJson: true, object: true, completed: true, expectedFieldsOnly: true })
  expect(response('"completed"')).toMatchObject({ validJson: true, object: false, completed: false })
  expect(response('```json\n{"outcome":"completed"}\n```')).toEqual({ finalPresent: true, validJson: false, fenced: true })
  expect(recoveryCompletion([])).toEqual({ finalPresent: false })
})

it('keeps repeated build failures deterministic until a valid repair and rejects an unbuilt artifact', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-recovery-oracle-'))
  const check = (...args: string[]) => spawnSync(process.execPath, ['recovery.cjs', ...args], { cwd, encoding: 'utf8' })
  try {
    await prepareRecovery(cwd, 'expected-artifact')
    for (let attempt = 0; attempt < 3; attempt++) expect(check('build').status).toBe(7)
    expect(check('diagnose').stdout).toContain('E_PROFILE')
    expect(check('repair', 'invalid').status).toBe(7)
    expect(jsonObject(await readFile(join(cwd, 'build-config.json'), 'utf8'))).toEqual({ profile: 'legacy' })
    expect(check('repair', 'current').status).toBe(0)
    expect(check('verify').status).toBe(7)
    expect(check('build').status).toBe(0)
    expect(check('verify').status).toBe(0)
    await writeFile(join(cwd, 'result.txt'), 'stale')
    expect(check('verify').status).toBe(7)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

it.skipIf(!enabled)('recovers from a deterministic build failure with GLM Main', { timeout: 360_000, retry: 0 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-main-recovery-'))
  const marker = `artifact-${randomUUID()}`
  const observations: Row = { model: 'glm-5.3-flash', route: 'zai', simulatedBuild: true }
  let stage = 'prepare'
  let failed = false
  try {
    await prepareRecovery(cwd, marker)
    const prompt = [
      'Complete this local build task yourself without delegating.',
      `Start by running ${JSON.stringify(shellCommand('node recovery.cjs build'))}, then finish the task using the observed results.`,
      'Acceptance criteria: result.txt must match expected.txt byte-for-byte, build-config.json must contain profile current, and node recovery.cjs verify must pass.',
      'Use the recovery.cjs commands to build, diagnose, repair, and verify. Preserve recovery.cjs, expected.txt, and recovery.jsonl; do not write the generated result.txt directly.',
      `Use ${process.platform === 'win32' ? 'pwsh' : 'bash'} for foreground commands, preserving any supplied native exit suffix.`,
      'Return only JSON {"outcome":"completed"} after verifying the acceptance criteria, or a truthful non-completed outcome if unresolved.',
    ].join(' ')
    stage = 'model'
    const records = await run(cwd, prompt)
    stage = 'evidence'
    const logs = await sessions(cwd)
    const rows = logs.find(log => log[0]?.id === records.find(row => row.type === 'session')?.sessionId)!
    observations.completion = recoveryCompletion(records)
    observations.outputMatchesSession = records.findLast(row => row.type === 'final')?.text === persistedAnswer(rows)
    const ledger = (await readFile(join(cwd, 'recovery.jsonl'), 'utf8')).trim().split('\n').map(jsonObject)
    observations.checks = ledger
    observations.events = eventCounts(rows)
    observations.files = {
      artifactMatches: await readFile(join(cwd, 'result.txt'), 'utf8') === marker,
      scriptUnchanged: await readFile(join(cwd, 'recovery.cjs'), 'utf8') === recoveryScript,
      expectedUnchanged: await readFile(join(cwd, 'expected.txt'), 'utf8') === marker,
      configMatches: isDeepStrictEqual(jsonObject(await readFile(join(cwd, 'build-config.json'), 'utf8')), { profile: 'current' }),
    }
    expect(ledger[0]).toEqual({ mode: 'build', passed: false })
    const diagnosed = ledger.findIndex(row => row.mode === 'diagnose' && row.passed === true)
    const repaired = ledger.findIndex(row => row.mode === 'repair' && row.passed === true)
    const built = ledger.findIndex(row => row.mode === 'build' && row.passed === true)
    const verified = ledger.findIndex(row => row.mode === 'verify' && row.passed === true)
    expect(diagnosed).toBeGreaterThan(0)
    expect(repaired).toBeGreaterThan(diagnosed)
    expect(built).toBeGreaterThan(repaired)
    expect(verified).toBeGreaterThan(built)
    expect(ledger.at(-1)).toEqual({ mode: 'verify', passed: true })
    const linkedChecks = rows.filter(row => row.type === 'tool/result').flatMap((row) => {
      const id = record(record(row.data).message).toolCallId
      if (!rows.some(call => call.type === 'tool/call' && record(call.data).callId === id
        && ['pwsh', 'bash'].includes(String(record(call.data).name)))) return []
      return eventText(row).split(/\r?\n/).filter(line => line.startsWith('DSH-RECOVERY:'))
        .map(line => jsonObject(line.slice('DSH-RECOVERY:'.length)))
    })
    expect(linkedChecks).toEqual(ledger)
    expect(Object.values(record(observations.files)).every(value => value === true)).toBe(true)
    expect(logs).toHaveLength(1)
    const headers = rows.filter(row => row.type === 'request/header')
    expect(headers.length).toBeGreaterThan(0)
    for (const row of headers) expect(record(record(row.data).header).config).toMatchObject({ provider: 'zai', model: 'glm-5.3-flash' })
    stage = 'report'
    expect(observations.outputMatchesSession).toBe(true)
    expect(finalReport(records)).toEqual({ outcome: 'completed' })
    stage = 'complete'
  } catch (error) {
    // Loader errors may embed prompts; retain only static diagnostics.
    failed = true
    observations.failureKind = error instanceof Error && error.message.includes('did not exit within') ? 'process_timeout' : 'check_or_process_failure'
    observations.failureLocations = error instanceof Error ? error.stack?.match(/subagent-reporting-glm-live\.e2e\.ts:\d+:\d+/g) : []
  } finally {
    try {
      await rm(cwd, { recursive: true, force: true })
      observations.cleanup = 'passed'
    } catch {
      failed = true
      observations.cleanup = 'failed'
    }
    await mkdir(evidenceRoot, { recursive: true })
    await writeFile(join(evidenceRoot, `main-recovery-${Date.now()}.json`), JSON.stringify({
      ...observations, status: failed ? 'failed' : 'passed', stage,
    }, null, 2) + '\n')
  }
  if (failed) throw new Error(`GLM Main recovery evaluation failed at ${stage}; see metadata evidence`)
})

function record(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected object')
  return value as Row
}

/** Require the entire response to be JSON, without accepting surrounding prose. */
function jsonObject(text: string): Row {
  return record(JSON.parse(text))
}

function eventText(row: Row): string {
  const data = record(row.data)
  const message = record(data.message ?? data)
  if (!Array.isArray(message.content)) return ''
  return message.content.flatMap((value: unknown) => {
    const block = record(value)
    return block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  }).join('\n')
}

async function sessions(cwd: string): Promise<Row[][]> {
  const root = join(cwd, '.sessions')
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.jsonl'))
  return Promise.all(files.map(async file => (await readFile(join(root, file), 'utf8'))
    .trim().split('\n').map(jsonObject)))
}

function calls(rows: readonly Row[]): Array<{ name: string; command?: string; agent_id?: string }> {
  return rows.filter(row => row.type === 'tool/call').map((row) => {
    const data = record(row.data)
    const args = jsonObject(String(data.arguments))
    return {
      name: String(data.name),
      ...typeof args.command === 'string' ? { command: args.command } : {},
      ...typeof args.agent_id === 'string' ? { agent_id: args.agent_id } : {},
    }
  })
}

function eventCounts(rows: readonly Row[]): Row {
  return Object.fromEntries([...new Set(rows.map(row => String(row.type)))].map(type => [
    type, rows.filter(row => row.type === type).length,
  ]))
}

function expectedReport(marker: string, phase: number): Row {
  return {
    outcome: 'partial',
    files: ['result.txt'],
    checked_state: marker,
    checks: [
      { command: shellCommand('node check.cjs pass'), status: 'passed', output: 'PASS-17', exit_code: 0 },
      { command: shellCommand('node check.cjs fail'), status: 'failed', output: 'FAIL-23', exit_code: 7 },
      { command: shellCommand('node check.cjs unrun'), status: 'unrun', output: null, exit_code: null },
    ],
    remaining: ['deployment not performed'],
    job: { id: 'SIM-JOB-17', status: 'unknown', evidence: 'synthetic', output_location: null, check_method: 'read job-report.json' },
    phase,
  }
}

function assertChildReport(actual: unknown, marker: string, phase: number): void {
  if (!isDeepStrictEqual(actual, expectedReport(marker, phase))) throw new Error('child report evidence differs')
}

function childTask(marker: string, phase: number): string {
  return [
    'You are the delegated worker. Do not delegate this task further.',
    `Write result.txt to exactly ${JSON.stringify(marker)} without a newline, then read it back.`,
    `Run ${JSON.stringify(shellCommand('node check.cjs pass'))} and ${JSON.stringify(shellCommand('node check.cjs fail'))} using ${process.platform === 'win32' ? 'pwsh' : 'bash'}, foreground. The latter deliberately exits 7. Do not fix it or run the unrun check.`,
    'Send each complete command verbatim as its own shell command argument. Do not add prefixes, suffixes, or exit-code printing. Preserve the explicit native exit suffix when supplied.',
    'Read job-report.json. No real job exists. Do not start any job or deploy anything.',
    `Produce this exact JSON structure, replacing checked_state with what you actually read and statuses/outputs with observed results: ${JSON.stringify(expectedReport(marker, phase))}.`,
    `Write that JSON to report-${phase}.json. Send the same JSON to your parent using send_message, then return only that JSON as your final answer.`,
  ].join(' ')
}

function parentTask(provider: 'spawn' | 'fork', marker: string, phase: number, childId?: string): string {
  const task = childTask(marker, phase)
  const delegation = childId === undefined
    ? `Call ${provider === 'spawn' ? 'subagent' : 'subagent_fork'} exactly once with run_in_background:true, description "reporting evaluation", prompt ${JSON.stringify(task)}. Record the returned child ID.`
    : `Do not create any child. Call send_message once targeting child ${childId} with message ${JSON.stringify(task)}. This is the existing child from the previous process.`
  return [
    'This is an isolated subagent reporting evaluation. You are Main; delegate the worker task instead of doing its work yourself.',
    delegation,
    `The required delegation provider is ${provider}; do not substitute another delegation tool. Send each shell command verbatim without prefixes, suffixes, or extra logging.`,
    `Use ${process.platform === 'win32' ? 'pwsh' : 'bash'} for shell commands. Wait for the report using ${JSON.stringify(shellCommand(`node wait.cjs report-${phase}.json`))} with timeoutMs:150000. A launch/delivery acknowledgement is not the report.`,
    `Read report-${phase}.json and result.txt yourself. Independently run exactly ${JSON.stringify(shellCommand(`node check.cjs verify ${marker}`))} in the foreground.`,
    'Do not repair failed checks or deploy anything. Do not claim the overall worker task fully completed.',
    'Return only JSON with exactly these fields: child_id (the actual ID), child_report (the complete parsed report object), verification (object with command, status, output, exit_code from your verify command), artifact (exact result.txt contents). No markdown or extra fields.',
  ].join(' ')
}

async function run(cwd: string, prompt: string, sessionId?: string): Promise<Row[]> {
  const result = await runLoaderSmoke({
    label: 'GLM subagent reporting evaluation', cwd, binScript, configPath, tsconfigPath,
    sourceImport: 'tsx/esm', processTimeoutMs: 300_000,
    binArgs: ['--profile', 'headless', '--patch', configPath, '--json',
      ...sessionId === undefined ? [] : ['--session-id', sessionId], prompt],
    env: {
      DSH_HOME: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
      DSH_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
    },
  })
  return result.stdout.trim().split('\n').map(jsonObject)
}

function finalReport(rows: readonly Row[]): Row {
  const final = rows.findLast(row => row.type === 'final')
  if (typeof final?.text !== 'string') throw new Error('missing final response')
  return jsonObject(final.text)
}

/** Match the last command attempt to its persisted result, including retries after a fix. */
function shellResult(rows: readonly Row[], command: string, output: string): void {
  const call = rows.findLast((row) => {
    if (row.type !== 'tool/call') return false
    const issued = jsonObject(String(record(row.data).arguments)).command
    return issued === command
  })
  expect(call).toBeDefined()
  const callId = record(call!.data).callId
  const result = rows.find(row => row.type === 'tool/result'
    && record(record(row.data).message).toolCallId === callId)
  expect(result).toBeDefined()
  expect(eventText(result!)).toContain(output)
  if (command === shellCommand('node check.cjs fail')) expect(eventText(result!)).toContain('[exit code: 7]')
}

it('preserves native exit codes through PowerShell without changing POSIX commands', () => {
  expect(shellCommand('node check.cjs fail', 'win32')).toBe('node check.cjs fail; exit $LASTEXITCODE')
  expect(shellCommand('node check.cjs fail', 'linux')).toBe('node check.cjs fail')
})

function correctionChecks(rows: readonly Row[]): Row[] {
  return rows.filter(row => row.type === 'tool/result').flatMap((row) => {
    const callId = record(record(row.data).message).toolCallId
    const shellCall = rows.some(call => call.type === 'tool/call'
      && record(call.data).callId === callId && ['pwsh', 'bash'].includes(String(record(call.data).name)))
    if (!shellCall) return []
    return eventText(row).split(/\r?\n/).filter(line => line.startsWith('DSH-CHECK:'))
      .map(line => jsonObject(line.slice('DSH-CHECK:'.length)))
  })
}

function correctionResult(rows: readonly Row[], mode: string, passed = true): void {
  const checks = correctionChecks(rows).filter(check => check.mode === mode)
  expect(checks.at(-1)).toEqual({ mode, passed, effectCount: 1, ...mode === 'status' ? { status: 'completed' } : {} })
}

function conflictEvidence(rows: readonly Row[], marker: string): { artifactObserved: boolean; failedCheckObserved: boolean } {
  return {
    artifactObserved: rows.some(row => row.type === 'tool/result' && eventText(row).includes(marker)),
    failedCheckObserved: correctionChecks(rows)
      .some(check => (check.mode === 'verify' || check.mode === 'full') && check.passed === false),
  }
}

function completionMetadata(rows: readonly Row[], childId: string): Row {
  let report: Row
  try {
    report = finalReport(rows)
  } catch {
    return { jsonObject: false }
  }
  return {
    jsonObject: true,
    childMatches: report.child_id === childId,
    outcome: ['completed', 'partial', 'failed', 'blocked'].includes(String(report.outcome)) ? report.outcome : 'other',
    expectedFieldsOnly: Object.keys(report).sort().join(',') === 'child_id,outcome',
    fieldCount: Object.keys(report).length,
  }
}

it('matches checker output to a shell result regardless of command spelling', () => {
  const rows: Row[] = [
    { type: 'tool/call', data: { name: 'pwsh', callId: 'check-1', arguments: JSON.stringify({ command: 'node ./check.cjs "verify"; exit $LASTEXITCODE' }) } },
    { type: 'tool/result', data: { message: { toolCallId: 'check-1', content: [{ type: 'text', text: 'DSH-CHECK:{"mode":"verify","passed":true,"effectCount":1}' }] } } },
  ]
  correctionResult(rows, 'verify')
  expect(() => { correctionResult(rows, 'full') }).toThrow()
  expect(() => { correctionResult(rows, 'verify', false) }).toThrow()
  record(rows[0]!.data).name = 'read'
  expect(() => { correctionResult(rows, 'verify') }).toThrow()
  record(rows[0]!.data).name = 'pwsh'
  record(record(rows[1]!.data).message).toolCallId = 'different-call'
  expect(() => { correctionResult(rows, 'verify') }).toThrow()
})

it('uses the latest check attempt and rejects a failure after an earlier pass', () => {
  const command = shellCommand('node check.cjs verify')
  const attempt = (callId: string, passed: boolean): Row[] => [
    { type: 'tool/call', data: { name: 'pwsh', callId, arguments: JSON.stringify({ command }) } },
    { type: 'tool/result', data: { message: { toolCallId: callId, content: [{ type: 'text', text: `DSH-CHECK:${JSON.stringify({ mode: 'verify', passed, effectCount: 1 })}` }] } } },
  ]
  const rows = [...attempt('failed', false), ...attempt('fixed', true)]
  correctionResult(rows, 'verify')
  expect(() => { correctionResult([...rows, ...attempt('regression', false)], 'verify') }).toThrow()
  const shellAttempt = (callId: string, text: string): Row[] => [
    { type: 'tool/call', data: { callId, arguments: JSON.stringify({ command }) } },
    { type: 'tool/result', data: { message: { toolCallId: callId, content: [{ type: 'text', text }] } } },
  ]
  shellResult([...shellAttempt('failed', 'FAIL'), ...shellAttempt('fixed', 'PASS')], command, 'PASS')
  expect(() => { shellResult([...shellAttempt('fixed', 'PASS'), ...shellAttempt('regression', 'FAIL')], command, 'PASS') }).toThrow()
})

it('retains completion diagnostics without raw response fields or text', () => {
  expect(completionMetadata([{ type: 'final', text: JSON.stringify({ child_id: 'child', outcome: 'partial', note: 'private-content' }) }], 'child'))
    .toEqual({ jsonObject: true, childMatches: true, outcome: 'partial', expectedFieldsOnly: false, fieldCount: 3 })
  expect(completionMetadata([{ type: 'final', text: JSON.stringify({ outcome: 'private-content' }) }], 'child').outcome).toBe('other')
  expect(completionMetadata([{ type: 'final', text: 'private-content' }], 'child')).toEqual({ jsonObject: false })
})

it('requires observed artifact or linked checker evidence before accepting a conflict', () => {
  const message = { content: [{ type: 'text', text: 'changed-marker' }] }
  expect(conflictEvidence([{ type: 'assistant/message', data: message }], 'changed-marker'))
    .toEqual({ artifactObserved: false, failedCheckObserved: false })
  expect(conflictEvidence([{ type: 'tool/result', data: { message } }], 'changed-marker'))
    .toEqual({ artifactObserved: true, failedCheckObserved: false })
  const rows: Row[] = [
    { type: 'tool/call', data: { name: 'pwsh', callId: 'check' } },
    { type: 'tool/result', data: { message: { toolCallId: 'check', content: [{ type: 'text', text: 'DSH-CHECK:{"mode":"full","passed":false,"effectCount":1}' }] } } },
  ]
  expect(conflictEvidence(rows, 'changed-marker')).toEqual({ artifactObserved: false, failedCheckObserved: true })
  record(record(rows[1]!.data).message).toolCallId = 'missing'
  expect(conflictEvidence(rows, 'changed-marker')).toEqual({ artifactObserved: false, failedCheckObserved: false })
})

it('rejects prose and non-object reports and detects changed evidence fields', () => {
  for (const text of ['prefix {}', '```json\n{}\n```', '[]', 'null']) expect(() => jsonObject(text)).toThrow()
  const expected = expectedReport('marker', 1)
  assertChildReport(jsonObject(JSON.stringify(expected)), 'marker', 1)
  for (const field of ['checks', 'remaining', 'job', 'checked_state']) {
    expect(() => { assertChildReport({ ...expected, [field]: null }, 'marker', 1) }).toThrow('evidence differs')
  }
  const changedChecks = structuredClone(expected)
  record((changedChecks.checks as Row[])[1]).status = 'passed'
  expect(() => { assertChildReport(changedChecks, 'marker', 1) }).toThrow('evidence differs')
})

it('isolates machine instructions and keeps fork continuation test-local', async () => {
  const entries = load(await readFile(configPath, 'utf8')) as Array<{ id: string; config?: Row }>
  expect(entries.find(entry => entry.id === 'agent-instructions')?.config).toEqual({
    maxBytes: 0, projectRootMarkers: [], instructionFileCandidates: [], localInstructionFileCandidates: [],
  })
  expect(entries.find(entry => entry.id === 'skill-filesystem')?.config).toEqual({ includeDefaultRoots: false, customSkillDirs: [] })
  expect(entries.find(entry => entry.id === 'tool-subagent-fork')).toEqual({
    id: 'tool-subagent-fork', disabled: false,
    config: { provider: 'fork', toolName: 'subagent_fork', backgroundMode: 'continuable' },
  })
})

for (const provider of ['spawn', 'fork'] as const) {
  it.skipIf(!enabled)(`reports observed evidence with GLM ${provider} before and after cold resume`, { timeout: 660_000, retry: 0 }, async () => {
    const cwd = await mkdtemp(join(tmpdir(), `dsh-reporting-${provider}-`))
    const observations: Row = { provider, model: 'glm-5.3-flash', route: 'zai', syntheticJob: true }
    let stage = 'prepare'
    let failed = false
    const failedStages: string[] = []
    try {
      await writeFile(join(cwd, 'check.cjs'), [
        "const fs = require('node:fs'); const [mode, marker] = process.argv.slice(2);",
        "if (mode === 'pass') { console.log('PASS-17'); process.exit(0); }",
        "if (mode === 'fail') { console.log('FAIL-23'); process.exit(7); }",
        "if (mode === 'verify' && fs.readFileSync('result.txt', 'utf8') === marker) { console.log('VERIFIED-31'); process.exit(0); }",
        "console.log('UNEXPECTED-CHECK'); process.exit(9);",
      ].join('\n'))
      await writeFile(join(cwd, 'wait.cjs'), [
        "const fs = require('node:fs'); const file = process.argv[2]; const deadline = Date.now() + 120000;",
        "const timer = setInterval(() => { if (fs.existsSync(file)) { clearInterval(timer); console.log('REPORT-READY'); } else if (Date.now() > deadline) { clearInterval(timer); process.exitCode = 8; } }, 250);",
      ].join('\n'))
      await writeFile(join(cwd, 'job-report.json'), JSON.stringify(expectedReport('', 1).job))
      let parentId: string | undefined
      let childId: string | undefined
      let parentBoundary = 0
      let childBoundary = 0
      if (provider === 'fork') {
        stage = 'fork-seed'
        const seed = await run(cwd, 'Reply only with {"seed":"reporting-evaluation"}. Do not use tools.')
        expect(finalReport(seed)).toEqual({ seed: 'reporting-evaluation' })
        parentId = String(seed.find(row => row.type === 'session')?.sessionId)
        parentBoundary = (await sessions(cwd)).find(rows => rows[0]?.id === parentId)!.length
      }
      for (const phase of [1, 2]) {
        const marker = `artifact-${randomUUID()}`
        stage = `phase-${phase}-model`
        const records = await run(cwd, parentTask(provider, marker, phase, childId), parentId)
        stage = `phase-${phase}-json`
        const report = finalReport(records)
        const currentParentId = records.find(row => row.type === 'session')?.sessionId
        expect(typeof currentParentId).toBe('string')
        if (parentId !== undefined) expect(currentParentId).toBe(parentId)
        parentId = String(currentParentId)
        expect(typeof report.child_id).toBe('string')
        if (childId !== undefined) expect(report.child_id).toBe(childId)
        childId = String(report.child_id)
        observations[`phase${phase}ReportFields`] = Object.fromEntries(Object.entries({
          child_id: childId, child_report: expectedReport(marker, phase),
          verification: { command: shellCommand(`node check.cjs verify ${marker}`), status: 'passed', output: 'VERIFIED-31', exit_code: 0 },
          artifact: marker,
        }).map(([key, value]) => [key, isDeepStrictEqual(report[key], value)]))
        expect(report).toEqual({
          child_id: childId, child_report: expectedReport(marker, phase),
          verification: { command: shellCommand(`node check.cjs verify ${marker}`), status: 'passed', output: 'VERIFIED-31', exit_code: 0 },
          artifact: marker,
        })
        stage = `phase-${phase}-world`
        expect(await readFile(join(cwd, 'result.txt'), 'utf8')).toBe(marker)
        assertChildReport(jsonObject(await readFile(join(cwd, `report-${phase}.json`), 'utf8')), marker, phase)
        stage = `phase-${phase}-logs`
        const logs = await sessions(cwd)
        const parent = logs.find(rows => rows[0]?.id === parentId)
        const child = logs.find(rows => rows[0]?.id === childId)
        observations[`phase${phase}Logs`] = { count: logs.length, parentFound: parent !== undefined, childFound: child !== undefined }
        stage = `phase-${phase}-lineage`
        expect(parent).toBeDefined()
        expect(child).toBeDefined()
        const descriptorIndex = child!.findIndex(row => row.type === 'subagent/descriptor')
        const descriptor = record(child![descriptorIndex]!.data)
        observations[`phase${phase}Descriptor`] = {
          providerMatches: descriptor.provider === provider,
          continuable: descriptor.mode === 'continuable',
          seeded: child![0]?.isSeeded === true,
          parentMatches: child![0]?.parentSession === parentId,
        }
        // Fork history precedes the establishing descriptor and is not child work.
        const childOwned = child!.slice(Math.max(childBoundary, descriptorIndex + 1))
        const parentOwned = parent!.slice(parentBoundary)
        observations[`phase${phase}Events`] = {
          parent: eventCounts(parentOwned), child: eventCounts(childOwned),
        }
        observations[`phase${phase}ChildCalls`] = calls(childOwned).map(call => ({
          tool: call.name, hasCommand: call.command !== undefined,
          passedCommandExact: call.command === shellCommand('node check.cjs pass'),
          passedCommandIncluded: call.command?.includes('node check.cjs pass') ?? false,
          failedCommandExact: call.command === shellCommand('node check.cjs fail'),
          failedCommandIncluded: call.command?.includes('node check.cjs fail') ?? false,
          rtkPrefix: call.command?.startsWith('rtk ') ?? false,
          multiline: call.command?.includes('\n') ?? false,
        }))
        const checks: Record<string, () => void> = {
          lineage: () => {
            expect(child![0]?.parentSession).toBe(parentId)
            expect(logs.filter(rows => rows[0]?.parentSession === parentId)).toHaveLength(1)
            expect(descriptor).toMatchObject({ provider, mode: 'continuable' })
            expect(child![0]?.isSeeded).toBe(provider === 'fork')
          },
          childPassed: () => { shellResult(childOwned, shellCommand('node check.cjs pass'), 'PASS-17') },
          childFailed: () => { shellResult(childOwned, shellCommand('node check.cjs fail'), 'FAIL-23') },
          parentVerify: () => { shellResult(parentOwned, shellCommand(`node check.cjs verify ${marker}`), 'VERIFIED-31') },
          delegation: () => {
            expect(calls(childOwned).some(call => call.command?.includes('node check.cjs unrun'))).toBe(false)
            const delegated = calls(parentOwned).filter(call => call.name === 'subagent' || call.name === 'subagent_fork')
            expect(delegated).toHaveLength(phase === 1 ? 1 : 0)
            if (phase === 1) expect(delegated[0]?.name).toBe(provider === 'spawn' ? 'subagent' : 'subagent_fork')
            if (phase === 2) expect(calls(parentOwned)).toContainEqual({ name: 'send_message', agent_id: childId })
          },
          childFinal: () => {
            const final = childOwned.findLast(row => row.type === 'assistant/message' && eventText(row).length > 0)
            assertChildReport(jsonObject(eventText(final!)), marker, phase)
            expect(record(record(childOwned.findLast(row => row.type === 'turn/end')!.data).reason).kind).toBe('completed')
          },
          route: () => {
            for (const log of [parentOwned, childOwned]) {
              const headers = log.filter(row => row.type === 'request/header')
              expect(headers.length).toBeGreaterThan(0)
              for (const row of headers) {
                expect(record(record(record(row.data).header).config)).toMatchObject({ provider: 'zai', model: 'glm-5.3-flash' })
              }
            }
          },
        }
        const results: Row = {}
        for (const [name, check] of Object.entries(checks)) {
          try {
            check()
            results[name] = true
          } catch {
            failed = true
            failedStages.push(`phase-${phase}-${name}`)
            results[name] = false
          }
        }
        observations[`phase${phase}`] = results
        parentBoundary = parent!.length
        childBoundary = child!.length
      }
      stage = 'complete'
    } catch (error) {
      // Loader/assertion errors may embed machine instructions or raw model text.
      failed = true
      failedStages.push(stage)
      observations.failureKind = error instanceof Error && error.message.includes('did not exit within') ? 'process_timeout' : 'check_or_process_failure'
      observations.failureLocations = error instanceof Error ? error.stack?.match(/subagent-reporting-glm-live\.e2e\.ts:\d+:\d+/g) : []
    } finally {
      try {
        await rm(cwd, { recursive: true, force: true })
        observations.cleanup = 'passed'
      } catch {
        failed = true
        observations.cleanup = 'failed'
      }
      await mkdir(evidenceRoot, { recursive: true })
      await writeFile(join(evidenceRoot, `${provider}-${Date.now()}.json`), JSON.stringify({
        ...observations, status: failed ? 'failed' : 'passed', stage, failedStages,
      }, null, 2) + '\n')
    }
    if (failed) throw new Error(`GLM ${provider} reporting evaluation failed at ${failedStages.join(', ')}; see metadata evidence`)
  })
}

const correctionChecker = [
  "const fs = require('node:fs'); const mode = process.argv[2];",
  "const artifact = fs.readFileSync('result.txt', 'utf8'); const expected = fs.readFileSync('acceptance.txt', 'utf8');",
  "let effectCount = Number(fs.readFileSync('effect.txt', 'utf8'));",
  "if (mode === 'retry') { fs.writeFileSync('effect.txt', String(++effectCount)); }",
  "if (!['verify', 'full', 'status', 'retry'].includes(mode)) process.exit(9);",
  "const passed = mode === 'verify' ? artifact === expected : mode === 'full' ? artifact === expected && effectCount === 1 : true;",
  "const result = { mode, passed, effectCount, ...(mode === 'status' ? { status: 'completed' } : {}) };",
  "fs.appendFileSync('checks.jsonl', JSON.stringify(result) + '\\n');",
  "console.log('DSH-CHECK:' + JSON.stringify(result));",
  'process.exit(passed ? 0 : 7);',
].join('\n')

// Wait for a persisted terminal child turn, not just a file written mid-turn.
const correctionWaiter = [
  "const fs = require('node:fs'); const [id, phase] = process.argv.slice(2); const deadline = Date.now() + 120000;",
  'const timer = setInterval(() => {',
  "  const files = fs.readdirSync('.sessions', { recursive: true }).filter(file => file.endsWith('.jsonl'));",
  '  for (const file of files) {',
  "    const text = fs.readFileSync('.sessions/' + file, 'utf8');",
  "    const rows = text.slice(0, text.lastIndexOf('\\n')).split('\\n').filter(Boolean).map(line => JSON.parse(line));",
  '    if (rows[0]?.id !== id) continue;',
  "    const descriptor = rows.findIndex(row => row.type === 'subagent/descriptor');",
  "    const ends = rows.slice(descriptor + 1).filter(row => row.type === 'turn/end');",
  "    if (ends.length >= Number(phase) && ends.at(-1).data.reason.kind === 'completed') { clearInterval(timer); console.log('CHILD-COMPLETED'); return; }",
  '  }',
  '  if (Date.now() > deadline) { clearInterval(timer); process.exitCode = 8; }',
  '}, 250);',
].join('\n')

async function prepareCorrection(cwd: string, marker: string): Promise<void> {
  await writeFile(join(cwd, 'check.cjs'), correctionChecker)
  await writeFile(join(cwd, 'wait.cjs'), correctionWaiter)
  await writeFile(join(cwd, 'acceptance.txt'), marker)
  await writeFile(join(cwd, 'result.txt'), 'incomplete')
  await writeFile(join(cwd, 'effect.txt'), '1')
}

it('detects incomplete artifacts, duplicate effects, and stale verification in the correction fixture', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-correction-oracle-'))
  const check = (mode: string) => spawnSync(process.execPath, ['check.cjs', mode], { cwd, encoding: 'utf8' })
  try {
    await prepareCorrection(cwd, 'accepted')
    expect(check('verify').status).toBe(7)
    await writeFile(join(cwd, 'result.txt'), 'accepted')
    expect(check('verify').status).toBe(0)
    expect(check('full').status).toBe(0)
    expect(jsonObject(check('status').stdout.trim().slice('DSH-CHECK:'.length))).toMatchObject({ status: 'completed', effectCount: 1 })
    expect(check('retry').status).toBe(0)
    expect(check('full').status).toBe(7)
    await writeFile(join(cwd, 'effect.txt'), '1')
    await writeFile(join(cwd, 'result.txt'), 'stale')
    expect(check('full').status).toBe(7)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

it('waits for a new completed child turn without counting fork seed history', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-correction-wait-'))
  try {
    await writeFile(join(cwd, 'wait.cjs'), correctionWaiter)
    await mkdir(join(cwd, '.sessions'))
    const completed = { type: 'turn/end', data: { reason: { kind: 'completed' } } }
    const rows = [{ id: 'child' }, completed, { type: 'subagent/descriptor' }, completed]
    const log = join(cwd, '.sessions', 'child.jsonl')
    await writeFile(log, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
    const waiting = spawnSync(process.execPath, ['wait.cjs', 'child', '2'], { cwd, timeout: 1000, encoding: 'utf8' })
    expect(waiting.error).toMatchObject({ code: 'ETIMEDOUT' })
    await writeFile(log, JSON.stringify(completed) + '\n', { flag: 'a' })
    const settled = spawnSync(process.execPath, ['wait.cjs', 'child', '2'], { cwd, timeout: 5000, encoding: 'utf8' })
    expect(settled.status).toBe(0)
    expect(settled.stdout.trim()).toBe('CHILD-COMPLETED')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

for (const { provider, scenario } of (['spawn', 'fork'] as const).flatMap(provider =>
  (['partial', 'stale', 'uncued'] as const).map(scenario => ({ provider, scenario })))) {
  const stale = scenario !== 'partial'
  const uncued = scenario === 'uncued'
  it.skipIf(!enabled)(`${uncued ? 'detects stale evidence without a verification reminder' : stale ? 'rechecks stale evidence' : 'corrects partial work'} with the same GLM ${provider} child after cold resume`, { timeout: 960_000, retry: 0 }, async () => {
    const cwd = await mkdtemp(join(tmpdir(), `dsh-correction-${provider}-`))
    const marker = `accepted-${randomUUID()}`
    const changedMarker = uncued ? `changed-${randomUUID()}` : 'incomplete'
    const observations: Row = { provider, model: 'glm-5.3-flash', route: 'zai', syntheticJob: true, staleEvidence: stale, uncuedVerification: uncued }
    let stage = 'prepare'
    let failed = false
    try {
      await prepareCorrection(cwd, marker)
      if (stale) await writeFile(join(cwd, 'result.txt'), marker)
      let parentId: string | undefined
      if (provider === 'fork') {
        stage = 'fork-seed'
        const seed = await run(cwd, 'Reply only with {"seed":"correction-evaluation"}. Do not use tools.')
        expect(finalReport(seed)).toEqual({ seed: 'correction-evaluation' })
        parentId = String(seed.find(row => row.type === 'session')?.sessionId)
      }
      const initialTask = stale ? [
        'You own result.txt. Do not delegate. Your task is to verify the current artifact; it is complete when both checks pass. Do not change the artifact or run job operations.',
        'Read result.txt and acceptance.txt.',
        `Run ${JSON.stringify(shellCommand('node check.cjs verify'))} and ${JSON.stringify(shellCommand('node check.cjs full'))} as separate foreground shell commands, preserving the exit suffix.`,
        `If both checks pass, write report-1.json with exactly this JSON: ${JSON.stringify({ outcome: 'completed', checked_state: marker })}. Otherwise report partial with the observed failure.`,
        'Send the report to your parent using send_message, then return the same JSON as your final answer.',
      ].join(' ') : [
        'You own result.txt. Do not delegate. This is the initial partial-work stage of an evaluation.',
        'Read result.txt and acceptance.txt. Do not repair the incomplete artifact yet.',
        `Run ${JSON.stringify(shellCommand('node check.cjs verify'))} as one foreground shell command, preserving the exit suffix. It should fail because the artifact is incomplete.`,
        'Do not run the full check, status inspection, or retry operation in this stage.',
        'Write report-1.json containing outcome, checked artifact contents, observed verify command/output/exit code, the full check marked unrun, and SIM-JOB-17 marked unknown. Its previous action acknowledgement was lost; no retry has been performed.',
        'Send the report to your parent with send_message, then return the report as your final answer.',
      ].join(' ')
      const initialPrompt = [
        `Use ${process.platform === 'win32' ? 'pwsh' : 'bash'} for all commands. Delegate exactly once using ${provider === 'spawn' ? 'subagent' : 'subagent_fork'} with run_in_background:true, description "partial correction fixture", prompt ${JSON.stringify(initialTask)}.`,
        stale
          ? 'This stage only collects the initial report. Do not repair anything or perform other checks yet.'
          : 'This stage only collects the partial report. Do not repair anything or perform other checks yet.',
        `Wait for the child to finish by running ${JSON.stringify(shellCommand('node wait.cjs CHILD_ID 1'))} with the actual child ID substituted and timeoutMs:150000. Read report-1.json.`,
        'Return only JSON {"child_id":"actual child id"}.',
      ].join(' ')
      stage = 'initial-model'
      const initial = await run(cwd, initialPrompt, parentId)
      const childId = String(finalReport(initial).child_id)
      parentId = String(initial.find(row => row.type === 'session')?.sessionId)
      const initialLogs = await sessions(cwd)
      const parentBefore = initialLogs.find(rows => rows[0]?.id === parentId)!
      const childBefore = initialLogs.find(rows => rows[0]?.id === childId)!
      stage = 'initial-evidence'
      observations.initial = {
        parentFound: parentBefore !== undefined, childFound: childBefore !== undefined,
        reportExists: (await readdir(cwd)).includes('report-1.json'),
      }
      expect(await readFile(join(cwd, 'result.txt'), 'utf8')).toBe(stale ? marker : 'incomplete')
      correctionResult(childBefore.slice(childBefore.findIndex(row => row.type === 'subagent/descriptor') + 1), 'verify', stale)
      expect(childBefore.findLast(row => row.type === 'turn/end')?.data).toMatchObject({ reason: { kind: 'completed' } })
      expect(calls(parentBefore).filter(call => call.name === 'subagent' || call.name === 'subagent_fork'))
        .toEqual([{ name: provider === 'spawn' ? 'subagent' : 'subagent_fork' }])
      if (stale) {
        stage = 'invalidate-checked-artifact'
        const report = jsonObject(await readFile(join(cwd, 'report-1.json'), 'utf8'))
        observations.initialReport = {
          outcomeCompleted: report.outcome === 'completed', checkedStateMatches: report.checked_state === marker,
          checkedStateType: typeof report.checked_state,
        }
        expect(report).toEqual({ outcome: 'completed', checked_state: marker })
        correctionResult(childBefore.slice(childBefore.findIndex(row => row.type === 'subagent/descriptor') + 1), 'full')
        await writeFile(join(cwd, 'result.txt'), changedMarker)
        observations.changedAfterReport = true
      }
      const resumePrompt = [
        uncued
          ? 'Finish the artifact task in this workspace using the acceptance criteria below and report the final outcome.'
          : stale
            ? `Complete the acceptance criteria for result.txt. Review the child's previous report and the current workspace. Independently run ${JSON.stringify(shellCommand('node check.cjs verify'))} before deciding whether the child needs corrections.`
            : 'Continue this task to completion. The partial child report leaves failed acceptance, an unrun full check, and an uncertain previous action to resolve.',
        `The existing continuable child ${childId} retains ownership of result.txt. The final file must equal acceptance.txt byte-for-byte. Keep check.cjs, wait.cjs, acceptance.txt, and effect.txt unchanged.`,
        uncued
          ? `Available artifact check commands are ${JSON.stringify(shellCommand('node check.cjs verify'))} and ${JSON.stringify(shellCommand('node check.cjs full'))}.`
          : `Available foreground check commands are ${JSON.stringify(shellCommand('node check.cjs verify'))} and ${JSON.stringify(shellCommand('node check.cjs full'))}. Run the full check yourself after the corrected child work is complete.`,
        `SIM-JOB-17 is synthetic. Inspect its current state using ${JSON.stringify(shellCommand('node check.cjs status'))}. The retry command ${JSON.stringify(shellCommand('node check.cjs retry'))} repeats its effect; the required final effect count is exactly one.`,
        `Use ${process.platform === 'win32' ? 'pwsh' : 'bash'}. Send complete check commands verbatim, preserving the exit suffix. The wait helper is ${JSON.stringify(shellCommand(`node wait.cjs ${childId} 2`))} with timeoutMs:150000. A delivery acknowledgement alone is not completion.`,
        'Return only JSON with child_id and outcome, using completed only after all acceptance criteria are verified.',
      ].join(' ')
      stage = 'resume-model'
      const resumed = await run(cwd, resumePrompt, parentId)
      observations.completion = completionMetadata(resumed, childId)
      stage = 'resume-report'
      expect(resumed.find(row => row.type === 'session')?.sessionId).toBe(parentId)
      const logs = await sessions(cwd)
      const parent = logs.find(rows => rows[0]?.id === parentId)!
      const child = logs.find(rows => rows[0]?.id === childId)!
      const parentNew = parent.slice(parentBefore.length)
      const childNew = child.slice(childBefore.length)
      observations.events = { parent: eventCounts(parentNew), child: eventCounts(childNew) }
      const ledger = (await readFile(join(cwd, 'checks.jsonl'), 'utf8')).trim().split('\n').map(jsonObject)
      observations.checks = ledger
      observations.files = {
        artifactMatches: await readFile(join(cwd, 'result.txt'), 'utf8') === marker,
        effectUnchanged: await readFile(join(cwd, 'effect.txt'), 'utf8') === '1',
        checkerUnchanged: await readFile(join(cwd, 'check.cjs'), 'utf8') === correctionChecker,
        waiterUnchanged: await readFile(join(cwd, 'wait.cjs'), 'utf8') === correctionWaiter,
        acceptanceUnchanged: await readFile(join(cwd, 'acceptance.txt'), 'utf8') === marker,
      }
      stage = 'resume-lineage'
      expect(logs.filter(rows => rows[0]?.parentSession === parentId)).toHaveLength(1)
      expect(child[0]).toMatchObject({ parentSession: parentId, isSeeded: provider === 'fork' })
      expect(record(child.find(row => row.type === 'subagent/descriptor')!.data)).toMatchObject({ provider, mode: 'continuable' })
      expect(calls(parentNew)).toContainEqual({ name: 'send_message', agent_id: childId })
      expect(calls(parentNew).filter(call => call.name === 'subagent' || call.name === 'subagent_fork')).toHaveLength(0)
      expect(childNew.findLast(row => row.type === 'turn/end')?.data).toMatchObject({ reason: { kind: 'completed' } })
      if (stale) {
        stage = 'resume-stale-check'
        const followupIndex = parentNew.findIndex(row => row.type === 'tool/call'
          && record(row.data).name === 'send_message'
          && jsonObject(String(record(row.data).arguments)).agent_id === childId)
        expect(followupIndex).toBeGreaterThan(0)
        const beforeFollowup = parentNew.slice(0, followupIndex)
        if (uncued) {
          const evidence = conflictEvidence(beforeFollowup, changedMarker)
          observations.conflictDetection = evidence
          expect(evidence.artifactObserved || evidence.failedCheckObserved).toBe(true)
        } else {
          correctionResult(beforeFollowup, 'verify', false)
        }
        observations.conflictVerifiedBeforeFollowup = true
      }
      stage = 'resume-checks'
      correctionResult(childNew, 'verify')
      if (uncued) {
        expect(correctionChecks(parentNew).filter(check => check.mode === 'verify' || check.mode === 'full').at(-1)?.passed).toBe(true)
      } else {
        correctionResult(parentNew, 'full')
      }
      correctionResult(parentNew, 'status')
      expect(ledger[0]).toMatchObject({ mode: 'verify', passed: stale })
      expect(ledger.some(row => row.mode === 'verify' && row.passed === true)).toBe(true)
      expect(ledger.some(row => row.mode === 'full' && row.passed === true)).toBe(true)
      expect(ledger.some(row => row.mode === 'retry')).toBe(false)
      stage = 'resume-files'
      expect(await readFile(join(cwd, 'result.txt'), 'utf8')).toBe(marker)
      expect(await readFile(join(cwd, 'effect.txt'), 'utf8')).toBe('1')
      expect(await readFile(join(cwd, 'check.cjs'), 'utf8')).toBe(correctionChecker)
      expect(await readFile(join(cwd, 'wait.cjs'), 'utf8')).toBe(correctionWaiter)
      expect(await readFile(join(cwd, 'acceptance.txt'), 'utf8')).toBe(marker)
      stage = 'resume-route'
      for (const owned of [parentNew, childNew]) {
        const headers = owned.filter(row => row.type === 'request/header')
        expect(headers.length).toBeGreaterThan(0)
        for (const row of headers) expect(record(record(row.data).header).config).toMatchObject({ provider: 'zai', model: 'glm-5.3-flash' })
      }
      stage = 'resume-report'
      expect(finalReport(resumed)).toEqual({ child_id: childId, outcome: 'completed' })
      stage = 'complete'
    } catch (error) {
      // Loader/assertion errors may contain raw prompts; retain only static diagnostics.
      failed = true
      observations.failureKind = error instanceof Error && error.message.includes('did not exit within') ? 'process_timeout' : 'check_or_process_failure'
      observations.failureLocations = error instanceof Error ? error.stack?.match(/subagent-reporting-glm-live\.e2e\.ts:\d+:\d+/g) : []
    } finally {
      try {
        await rm(cwd, { recursive: true, force: true })
        observations.cleanup = 'passed'
      } catch {
        failed = true
        observations.cleanup = 'failed'
      }
      await mkdir(evidenceRoot, { recursive: true })
      await writeFile(join(evidenceRoot, `${uncued ? 'uncued' : stale ? 'stale' : 'correction'}-${provider}-${Date.now()}.json`), JSON.stringify({
        ...observations, status: failed ? 'failed' : 'passed', stage,
      }, null, 2) + '\n')
    }
    if (failed) throw new Error(`GLM ${provider} correction evaluation failed at ${stage}; see metadata evidence`)
  })
}
