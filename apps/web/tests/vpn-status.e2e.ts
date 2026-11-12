/** VPN status over the shipped Web Loader beside a restored, read-only recorded Session. */
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-host-vpn-status'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const seed = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const golden = fileURLToPath(new URL('./expected/vpn-status.expected.md', import.meta.url))
const output = fileURLToPath(new URL('../../../.artifacts/vpn-status/', import.meta.url))

it('shows only fresh sampled Host verification and preserves narrow layouts in both themes', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  await seedSession(scaffold, await readFile(seed, 'utf8'), 'vpn-status-recorded-session')
  const service = scaffold.ctx.get('vpnStatus')
  if (service === undefined) throw new Error('Shipped VPN status service did not activate')
  expect(service.read().state).toBe('unknown')
  const read = vi.spyOn(service, 'read').mockReturnValue({
    state: 'verified', evidence: 'mullvad', checkedAt: 1700000000000, validUntil: Date.now() + 300000,
  })
  onTestFinished(() => { read.mockRestore() })
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser, 1280)
  await page.goto(scaffold.authenticatedUrl)
  const group = page.locator('[role="treeitem"]').first()
  await group.waitFor()
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
  const ungrouped = page.locator('[data-row-key="workspace:"]')
  await ungrouped.waitFor()
  if (await ungrouped.getAttribute('aria-expanded') !== 'true') await ungrouped.click()
  await page.locator('[data-row-key="session:vpn-status-recorded-session"]').click()
  await page.getByText('DONE', { exact: true }).waitFor()
  const bar = page.locator('[data-vpn-state]')
  await expect.poll(() => bar.textContent()).toContain('VPN verified')
  expect(await bar.textContent()).toContain('Host HTTPS')
  expect(await bar.textContent()).toContain('Checked 22:13:20Z')
  await compareOrRefreshGolden(golden, await captureStableAria(page, '[data-shell-bottom]', scaffold.workspaceCwd), webSnapshotMode())
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await mkdir(output, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe(scheme === 'dark' ? '' : null)
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 800 })
      const box = await bar.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      expect(await bar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.screenshot({ path: output + scheme + '-' + String(width) + '.png' })
    }
  }
  read.mockReturnValue({ state: 'verified', evidence: 'expected-exit', checkedAt: 1700000000000, validUntil: Date.now() - 1 })
  await page.reload()
  await expect.poll(() => bar.textContent()).toContain('VPN unknown')
  expect(await bar.textContent()).not.toContain('Expected exit')
  read.mockReturnValue({ state: 'unverified', evidence: null, checkedAt: 1700000000000, validUntil: Date.now() + 300000 })
  await page.reload()
  await expect.poll(() => bar.textContent()).toContain('VPN unverified')
  read.mockReturnValue({ state: 'unknown', evidence: null, checkedAt: 1700000000000, validUntil: Date.now() + 300000 })
  await page.reload()
  await expect.poll(() => bar.textContent()).toContain('VPN unknown')
})
