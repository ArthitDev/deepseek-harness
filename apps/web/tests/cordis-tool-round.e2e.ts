/** Historical generated-plugin cards remain readable after their tool APIs are removed. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, readPersistedEvents, parseSeedFixture, realizeSeedFixture,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { expandOwningTurnProcess, newEnglishPage } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/cordis-tool-round/session.v3.jsonl', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/cordis-history/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'cordis-history'

describe.skipIf(MODE === 'record')('web e2e: historical Cordis cards', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      cordisTools: true,
      compareReplaySession: true,
      ...(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 15 }),
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[role="treeitem"]').first().click()
    await page.locator('[role="treeitem"]').nth(1).click()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('drives the recorded Cordis lifecycle to a settled turn (all modes)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cordis-drive'))
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT, STOP_PROMPT])
    }
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    const runTurnSettled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')

    // The approval is the TEST's action in every mode: the fixture pins what the
    // model said, and the gate is a real round trip through the real panel.
    const approve = page.locator('[data-cordis-approve]').first()
    await approve.waitFor({ timeout: 90_000 })
    // The one assertion this scenario cannot give up: the model asking to run is
    // NOT the plugin running. Until a person answers, the browser half has not
    // been fetched, evaluated, or mounted anywhere on this page.
    expect(await page.locator('[data-snapshot-probe]').count()).toBe(0)
    const sessionId = await runTurnSettled
    // Approving from idle makes the run-outcome steer a distinct continuation
    // turn, matching the recorded replay and keeping turn grouping deterministic.
    const approvalTurnSettled = scaffold.whenTurnSettled()
    await approve.click()
    await expect.poll(() => page.locator('[data-snapshot-probe]').count(), { timeout: 30_000 }).toBe(1)
    await approvalTurnSettled
    await expect.poll(() => page.getByText('The Cordis Plugin is running.', { exact: true }).count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)
    await expect.poll(() => input.isEnabled(), { timeout: 15_000 }).toBe(true)
    const stopTurnSettled = scaffold.whenTurnSettled()
    await input.fill(STOP_PROMPT)
    await input.press('Enter')
    await stopTurnSettled
    await expect.poll(() => {
      const stop = sessionEvents.find(
        (event): event is Extract<SessionEvent, { type: 'tool/call' }> =>
          event.type === 'tool/call' && event.data.name === 'cordis_stop',
      )
      return stop !== undefined && sessionEvents.some(
        event => event.type === 'tool/result'
          && String(event.data.message.source.callId) === String(stop.data.callId),
      )
    }, { timeout: 15_000 }).toBe(true)
    if (MODE === 'record') {
      assertCompleteCordisLifecycle(sessionEvents)
      await expect.poll(() => page.getByText('CORDIS_UI_DONE', { exact: true }).count(), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1)
      await recordFixture(scaffold, sessionId, FIXTURE)
    }
  }, 200_000)

  it.skipIf(MODE === 'record')('the durable log carries one complete Cordis lifecycle', () => {
    assertCompleteCordisLifecycle(sessionEvents)
  })

  it.skipIf(MODE === 'record')('renders localized Cordis lifecycle cards', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cordis-rows'))
    await expect.poll(() => page.getByText('CORDIS_UI_DONE', { exact: true }).count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)

    const inspectRow = page.locator('[data-tool="cordis_inspect_self"]').filter({ hasText: 'Inspect' }).first()
    await expandOwningTurnProcess(page, inspectRow)
    await inspectRow.waitFor({ timeout: 10_000 })

    // cordis_define does NOT go through the generic row: ui-cordis registers a
    // keyed toolview for it, and a keyed hit replaces the generic card. So the
    // title here is the CARD's ("Cordis Plugin"), and the expanded body is the
    // card's own two code sections rather than a generic args dump.
    const defineRow = page.locator('[data-tool="cordis_define"]').filter({ hasText: 'Cordis Plugin' }).first()
    await expandOwningTurnProcess(page, defineRow)
    await defineRow.waitFor({ timeout: 10_000 })
    // The whole summary row is the expand toggle (unified tool-row interaction).
    await defineRow.locator('[aria-expanded]').first().click()
    await expect.poll(() => defineRow.textContent(), { timeout: 10_000 }).toContain('data-snapshot-probe')
    await defineRow.getByRole('tab', { name: 'Host' }).click()
    await expect.poll(() => defineRow.textContent()).toContain(PACKAGE_CODE)

    const runRow = page.locator('[data-tool="cordis_run"]').filter({ hasText: 'Run Cordis Plugin' }).first()
    await expandOwningTurnProcess(page, runRow)
    await runRow.waitFor({ timeout: 10_000 })
    await expect.poll(() => runRow.textContent()).toContain('snap-')

    const stopRow = page.locator('[data-tool="cordis_stop"]').filter({ hasText: 'Stop Cordis Plugin' }).first()
    await expandOwningTurnProcess(page, stopRow)
    await stopRow.waitFor({ timeout: 10_000 })
    await expect.poll(() => stopRow.textContent()).toContain('snap-')
    await expect(stopRow.getAttribute('data-state')).resolves.toBe('ok')
    // Stopping withdraws the browser half from every page, probe included.
    await expect.poll(() => page.locator('[data-snapshot-probe]').count(), { timeout: 15_000 }).toBe(0)
  })

  it.skipIf(MODE === 'record')('matches the conversation aria golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cordis-aria'))
    // Final Assistant text precedes turn/end. Three footers prove every turn
    // reached the render state covered by the ARIA golden.
    await expect.poll(
      () => page.getByRole('button', { name: 'Branch into a new conversation', exact: true }).count(),
      { timeout: 15_000 },
    ).toBe(3)
    await page.locator('[data-conversation-scroll]').evaluate((host) => { host.scrollTop = host.scrollHeight })
    await expect.poll(
      async () => page.getByRole('button', { name: 'Back to bottom', exact: true }).count(),
      { timeout: 10_000 },
    ).toBe(0)
    await page.mouse.move(0, 0)
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  })
})
