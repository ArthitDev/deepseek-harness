import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/minimal-preset', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()
const PROMPT = "Use the bash tool to run exactly: printf 'MINIMAL_BASH_CARD_OK\\n'. Then reply exactly MINIMAL_PRESET_REQUEST_OK and stop."
const SHELL_TOOL = process.platform === 'win32' ? 'pwsh' : 'bash'
const BASH_CARD_COMMAND = "printf 'MINIMAL_BASH_CARD_OK\\n'"

function rewriteWindowsShellCalls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteWindowsShellCalls)
  if (value === null || typeof value !== 'object') return value
  const rewritten = Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    rewriteWindowsShellCalls(item),
  ]))
  if (rewritten.name !== 'bash') return rewritten
  rewritten.name = 'pwsh'
  return rewritten
}

function normalizeShellSnapshot(snapshot: string): string {
  return process.platform === 'win32'
    ? snapshot.replaceAll('Pwsh', 'Bash').replaceAll('pwsh', 'bash')
    : snapshot
}

/** Rendered text of the system prompt surface node, or undefined when the surface carries none. */
function systemPromptText(session: Session): string | undefined {
  const message = session.deriveMessages().find(candidate => candidate.role === 'system')
  return message?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

describe('minimal agent preset', () => {
  let scaffold: WebScaffold
  let agentHandle: AgentHandle
  let disposeInjectedPrompt: () => void
  let browser: Browser | undefined
  let page: Page | undefined
  let tripwire: ReturnType<typeof watchConsole> | undefined
  let sidecarDir: string | undefined

  beforeAll(async () => {
    let replayFixture = FIXTURE
    if (process.platform === 'win32') {
      sidecarDir = await mkdtemp(join(tmpdir(), 'dsh-web-e2e-sidecar-'))
      replayFixture = join(sidecarDir, 'session.v3.jsonl')
      const records = (await readFile(FIXTURE, 'utf8')).trimEnd().split(/\r?\n/)
        .map(line => JSON.stringify(rewriteWindowsShellCalls(JSON.parse(line))))
      await writeFile(replayFixture, `${records.join('\n')}\n`)
    }
    scaffold = await launchWebScaffold({
      replayFixture,
      compareReplaySession: process.platform !== 'win32',
      paceMs: 10,
    })
    disposeInjectedPrompt = scaffold.ctx.systemPrompt.section({
      name: 'test:injected-prompt',
      order: 999,
      text: 'THIS TEXT MUST NOT REACH THE MODEL.',
    })
    agentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('minimal-preset-smoke'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'minimal' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
    if (SHELL_TOOL === 'pwsh') {
      const seeded = await scaffold.ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('minimal-pwsh-printf-setup'),
        name: SHELL_TOOL,
        arguments: {
          command: "function global:printf { param([string]$Value) Write-Host -NoNewline ($Value -replace '\\\\n$', '') }",
        },
        agent: agentHandle.agent,
      })
      if (seeded.isError) throw new Error('failed to seed printf in the persistent pwsh session')
    }
    agentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: PROMPT }],
      source: { kind: 'user' },
    }))
    await agentHandle.agent.whenIdle()
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await page?.close().catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await agentHandle?.dispose().catch((error: unknown) => failures.push(error))
    try {
      disposeInjectedPrompt?.()
    } catch (error: unknown) {
      failures.push(error)
    }
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (sidecarDir !== undefined) await rm(sidecarDir, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'minimal preset smoke teardown failed')
  })

  it('sends the exact RL prompt and schema, then executes the persistent shell', async () => {
    const requestHeader = agentHandle.agent.session.requestHeader()
    if (requestHeader === undefined) throw new Error('the minimal agent issued no model request')
    const systemPrompt = systemPromptText(agentHandle.agent.session)
    if (systemPrompt === undefined) throw new Error('the minimal agent issued no system prompt')
    expect(agentHandle.agent.session.snapshotEvents().some(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')).toBe(false)
    expect(scaffold.ctx.agentPresets.serviceFor(agentHandle.agent, 'fs')).toBeUndefined()
    expect(scaffold.ctx.agentPresets.serviceFor(agentHandle.agent, 'compaction')).toBeUndefined()

    const stateDir = join(scaffold.workspaceCwd, 'persistent-state')
    await mkdir(stateDir)
    const signal = new AbortController().signal
    const setup = await scaffold.ctx.tools.execute({
      signal,
      callId: ToolCallId('minimal-bash-state-setup'),
      name: SHELL_TOOL,
      arguments: {
        command: process.platform === 'win32'
          ? `Set-Location -LiteralPath '${stateDir}'; $env:DSH_MINIMAL_STATE = 'PERSISTED'`
          : `cd ${JSON.stringify(stateDir)} && export DSH_MINIMAL_STATE=PERSISTED`,
      },
      agent: agentHandle.agent,
    })
    const bash = await scaffold.ctx.tools.execute({
      signal,
      callId: ToolCallId('minimal-bash-state-read'),
      name: SHELL_TOOL,
      arguments: {
        command: process.platform === 'win32'
          ? "Write-Output ($env:DSH_MINIMAL_STATE + ':' + (Get-Location).Path)"
          : 'printf \'%s:%s\n\' "$DSH_MINIMAL_STATE" "$PWD"',
      },
      agent: agentHandle.agent,
    })
    const text = (result: typeof bash): string => result.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .replaceAll(scaffold.workspaceCwd, '{{cwd}}')
      .replace(/\{\{cwd\}\}\\+/g, '{{cwd}}/')
      .replaceAll('\r\n', '\n')
      .trimEnd()

    expect(setup.isError).toBe(false)
    expect(bash.isError).toBe(false)
    const shellText = text(bash).split('\n').map(line => line.trim()).filter(Boolean).at(-1) ?? ''
    expect({
      prompt: requestHeader.system,
      tools: requestHeader.tools?.map(tool => process.platform === 'win32' && tool.name === 'pwsh' ? 'bash' : tool.name),
      goalCommand: scaffold.ctx.commands.find(agentHandle.agent, 'goal') !== undefined,
      bash: shellText,
    }).toMatchInlineSnapshot(`
      {
        "bash": "PERSISTED:{{cwd}}/persistent-state",
        "goalCommand": false,
        "prompt": "You are a helpful software engineer assistant.",
        "tools": [
          "bash",
        ],
      }
    `)
    expect(requestHeader.tools?.toSorted((left, right) => left.name.localeCompare(right.name)))
      .toEqual(scaffold.ctx.tools.schemas(agentHandle.agent).toSorted((left, right) => left.name.localeCompare(right.name)))
  })

  it.skipIf(MODE === 'record')('expands the completed persistent Bash call in the Web conversation', async () => {
    onTestFailed(() => { if (page !== undefined) void saveFailureShot(page, 'web-minimal-persistent-bash-card') })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[data-workspace-group] > [role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const sessionRow = page.locator('[data-workspace-group] [role="treeitem"][aria-selected]').first()
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await page.getByText('MINIMAL_PRESET_REQUEST_OK', { exact: true }).waitFor({ timeout: 15_000 })

    const turnProcess = page.locator('[data-turn-process]')
    await turnProcess.waitFor({ timeout: 15_000 })
    await expect.poll(() => turnProcess.getAttribute('aria-expanded')).toBe('false')
    await turnProcess.click()
    await expect.poll(() => turnProcess.getAttribute('aria-expanded')).toBe('true')

    const call = SHELL_TOOL === 'pwsh'
      ? page.locator('[data-tool="pwsh"]').first()
      : page.locator('[data-sample="bash"]').first().locator('xpath=..')
    const row = SHELL_TOOL === 'pwsh'
      ? call.getByRole('button').first()
      : call.locator('[data-sample="bash"]')
    await row.waitFor({ timeout: 15_000 })
    await expect.poll(() => row.getAttribute('aria-expanded')).toBe('false')
    await row.click()

    await expect.poll(() => row.getAttribute('aria-expanded')).toBe('true')
    await call.getByText('IN', { exact: true }).waitFor()
    await call.getByText('OUT', { exact: true }).waitFor()
    await expect.poll(() => call.textContent(), { timeout: 10_000 }).toContain('MINIMAL_BASH_CARD_OK')
    await expect.poll(() => call.textContent(), { timeout: 10_000 })
      .toContain(BASH_CARD_COMMAND)

    const snapshot = normalizeShellSnapshot(await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'session.v3.jsonl',
      'system-prompt.expected.md',
      'tool-schemas.expected.json',
      'ui.expected.md',
    ])
  })
})
