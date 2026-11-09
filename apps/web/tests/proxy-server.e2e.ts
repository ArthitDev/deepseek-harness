/** Embedded proxy controls through the shipped Loader and real Remote transport. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-proxy-server'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, openSettings, saveFailureShot } from './support.ts'

async function listen(server: Server): Promise<number> {
  await new Promise<void>((complete) => { server.listen(0, '127.0.0.1', complete) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing TCP address')
  return address.port
}
async function close(server: Server): Promise<void> {
  await new Promise<void>((complete, reject) => { server.close((error) => { if (error === undefined) complete(); else reject(error) }) })
}

it('shows independent persistent switches, owned process status, and recoverable startup failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-proxy-browser-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const external = createServer((_req, res) => { res.end(JSON.stringify({ service: 'antigravity-proxy' })) })
  const antigravityPort = await listen(external)
  onTestFinished(() => close(external))
  const occupied = createServer((_req, res) => { res.writeHead(503); res.end('{}') })
  const zcodePort = await listen(occupied)
  onTestFinished(() => close(occupied))
  const reservation = createServer()
  const sbPort = await listen(reservation)
  await close(reservation)
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@fixture/proxy-ports', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  await writeFile(join(directory, 'cordis.patch.yml'), JSON.stringify([{ id: 'proxy-servers', config: { zcodePort, antigravityPort, sbPort } }]))
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: directory, enabled: true }] } })
  onTestFinished(() => scaffold.close())
  const ctx = scaffold.ctx
  await ctx.settings.update('proxy-servers', { zcodeEnabled: false, antigravityEnabled: false, sbEnabled: false })
  const changes = vi.spyOn(ctx.proxyServers, 'setEnabled')
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser, 1280)
  onTestFailed(() => saveFailureShot(page, 'proxy-server'))
  const tripwire = watchConsole(page)
  onTestFailed(() => { console.error('Proxy browser diagnostics', tripwire) })
  const output = fileURLToPath(new URL('../../../.artifacts/proxy-server/', import.meta.url))
  await mkdir(output, { recursive: true })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  await openSettings(page, 'en')
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: 'Proxy Server', exact: true }).click()
  const sb = settings.locator('[data-proxy-id="sb"]')
  const antigravity = settings.locator('[data-proxy-id="antigravity"]')
  const zcode = settings.locator('[data-proxy-id="zcode"]')
  await sb.getByText('Stopped', { exact: true }).waitFor()
  await antigravity.getByText('Running externally', { exact: true }).waitFor()
  expect(changes).not.toHaveBeenCalled()
  const sbSwitch = sb.getByRole('switch', { name: 'Use SB transport', exact: true })
  await expect.poll(() => sbSwitch.isEnabled()).toBe(true)
  await sbSwitch.focus()
  await sbSwitch.press('Space')
  await expect.poll(async () => {
    const rows = await ctx.proxyServers.list()
    return { changes: changes.mock.calls.length, status: rows.find(row => row.id === 'sb')?.status,
      error: await settings.getByRole('alert').allTextContents() }
  }).toEqual({ changes: 1, status: 'running', error: [] })
  await sb.getByText('Running', { exact: true }).waitFor()
  expect(await sbSwitch.getAttribute('aria-checked')).toBe('true')
  expect(await antigravity.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  expect(await zcode.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  await settings.screenshot({ path: join(output, 'light-running.png') })
  await page.goto(scaffold.authenticatedUrl)
  await openSettings(page, 'en')
  await settings.getByRole('button', { name: 'Proxy Server', exact: true }).click()
  await sb.getByText('Running', { exact: true }).waitFor()
  expect(await sbSwitch.getAttribute('aria-checked')).toBe('true')
  await sbSwitch.click()
  await sb.getByText('Stopped', { exact: true }).waitFor()
  await antigravity.getByRole('switch').click()
  await expect.poll(() => antigravity.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  await antigravity.getByRole('switch').click()
  await expect.poll(() => antigravity.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  expect(external.listening).toBe(true)
  await zcode.getByRole('switch').click()
  await settings.getByRole('alert').filter({ hasText: 'port is occupied' }).waitFor()
  expect(await zcode.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  expect(occupied.listening).toBe(true)
  await ctx.settings.mutate('ui-theme', [{ op: 'set', path: ['preference'], value: 'dark' }])
  await page.setViewportSize({ width: 420, height: 900 })
  await settings.screenshot({ path: join(output, 'dark-failure.png') })
  for (const control of [sbSwitch, antigravity.getByRole('switch'), zcode.getByRole('switch')]) {
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(420)
  }
  expect(tripwire.pageErrors).toEqual([])
})
