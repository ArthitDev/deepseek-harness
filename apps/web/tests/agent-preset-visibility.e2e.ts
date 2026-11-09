/** Built-in visibility persists without changing the selected custom preset. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, openSettings, saveFailureShot } from './support.ts'

it('toggles shipped presets in Settings and the new-task menu across reloads', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [] }, agentPresets: { default: 'visibility-fixture' },
    extraOverlayPath: fileURLToPath(new URL('./fixtures/preset-visibility.patch.yml', import.meta.url)),
  })
  onTestFinished(() => scaffold.close())
  const ctx = scaffold.ctx
  await ctx.settings.update('agent-preset-registry', { showBuiltInPresets: false })
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser, 1280)
  onTestFailed(() => saveFailureShot(page, 'agent-preset-visibility'))
  const tripwire = watchConsole(page)
  const output = fileURLToPath(new URL('../../../.artifacts/agent-preset-visibility/', import.meta.url))
  await mkdir(output, { recursive: true })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const chip = page.getByRole('button', { name: 'Workspace preset', exact: true })
  await chip.click()
  await page.getByRole('menuitem', { name: /^Workspace preset/ }).waitFor()
  expect(await page.getByRole('menuitem', { name: /^Standard mode/ }).count()).toBe(0)
  await page.keyboard.press('Escape')
  for (const [theme, width] of [['light', 1280], ['dark', 420]] as const) {
    await ctx.settings.mutate('ui-theme', [{ op: 'set', path: ['preference'], value: theme }])
    await page.setViewportSize({ width, height: 900 })
    await page.goto(scaffold.authenticatedUrl)
    await openSettings(page, 'en')
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'Agent presets', exact: true }).click()
    const toggle = settings.getByRole('switch', { name: 'Show built-in presets', exact: true })
    await toggle.waitFor()
    expect(await toggle.getAttribute('aria-checked')).toBe('false')
    expect(await settings.locator('[data-agent-preset-id="standard"]').count()).toBe(0)
    await settings.locator('[data-agent-preset-id="visibility-fixture"]').waitFor()
    await settings.screenshot({ path: join(output, `${theme}-custom-only.png`) })
    await toggle.focus()
    await toggle.press('Space')
    await settings.locator('[data-agent-preset-id="standard"]').waitFor()
    expect(ctx.agentPresets.defaultId).toBe('visibility-fixture')
    await settings.getByRole('button', { name: 'Close', exact: true }).last().click()
    if (width < 768) await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await chip.click()
    await page.getByRole('menuitem', { name: /^Standard mode/ }).waitFor()
    await page.keyboard.press('Escape')
    await page.goto(scaffold.authenticatedUrl)
    await openSettings(page, 'en')
    await settings.getByRole('button', { name: 'Agent presets', exact: true }).click()
    expect(await toggle.getAttribute('aria-checked')).toBe('true')
    await toggle.click()
    await settings.locator('[data-agent-preset-id="standard"]').waitFor({ state: 'hidden' })
    await settings.getByRole('button', { name: 'Close', exact: true }).last().click()
  }
  expect(tripwire.pageErrors).toEqual([])
})
