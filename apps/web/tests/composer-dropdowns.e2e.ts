/** Composer dropdown geometry and keyboard behavior through the shipped V3 Loader. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import type {} from '@deepseek-ai/dsh-remote-machines'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

it('matches composer dropdowns across themes and wrapped toolbars', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  const ctx = scaffold.ctx
  const machineName = 'Kali development machine with a deliberately long name'
  await ctx.remoteMachines.save({ name: machineName, host: 'fixture.invalid', username: 'fixture', auth: 'agent' })
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser, 1280)
  onTestFailed(() => saveFailureShot(page, 'composer-dropdowns'))
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const output = fileURLToPath(new URL('../../../.artifacts/composer-dropdowns/', import.meta.url))
  await mkdir(output, { recursive: true })
  for (const [theme, width] of [['light', 1280], ['dark', 420]] as const) {
    await ctx.settings.mutate('ui-theme', [{ op: 'set', path: ['preference'], value: theme }])
    await page.setViewportSize({ width, height: 900 })
    await page.goto(scaffold.authenticatedUrl)
    await page.locator('[data-composer-input]').waitFor()
    const dropdowns = ['Access mode, current:', 'Agent mode:', 'Execution machine:']
      .map(name => page.getByRole('button', { name: new RegExp(`^${name}`) }))
    const treatments = []
    const hoverFills = []
    const openFills = []
    const focusRings = []
    await page.mouse.move(0, 0)
    for (const [index, trigger] of dropdowns.entries()) {
      await trigger.waitFor()
      treatments.push(await trigger.evaluate((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const chevron = [...element.querySelectorAll('svg')].at(-1)!.getBoundingClientRect()
        const label = element.querySelector('span:not([aria-hidden])')!
        return {
          height: rect.height, radius: style.borderRadius, background: style.backgroundColor,
          color: style.color, font: style.font, padding: style.padding, gap: style.gap,
          chevronWidth: chevron.width, chevronHeight: chevron.height,
          chevronInset: rect.right - chevron.right,
          labelVisible: label.getBoundingClientRect().width > 0,
        }
      }))
      await trigger.hover()
      hoverFills.push(await trigger.evaluate(element => getComputedStyle(element).backgroundColor))
      await page.mouse.move(0, 0)
      await trigger.focus()
      await trigger.press('Tab')
      await page.keyboard.press('Shift+Tab')
      focusRings.push(await trigger.evaluate(element => getComputedStyle(element).outline))
      await trigger.press('Enter')
      const menu = page.getByRole('menu')
      await menu.waitFor()
      openFills.push(await trigger.evaluate(element => getComputedStyle(element).backgroundColor))
      const bounds = (await menu.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      if (index === 2) await menu.getByRole('menuitem', { name: machineName, exact: true }).waitFor()
      await page.screenshot({ path: join(output, `${theme}-menu-${index}.png`) })
      await page.keyboard.press('Home')
      expect(await menu.getByRole('menuitem').first().evaluate(element => document.activeElement === element)).toBe(true)
      await page.keyboard.press('ArrowDown')
      expect(await menu.getByRole('menuitem').nth(1).evaluate(element => document.activeElement === element)).toBe(true)
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'hidden' })
      expect(await trigger.evaluate(element => document.activeElement === element)).toBe(true)
      await trigger.press('Space')
      await menu.waitFor()
      await page.mouse.click(width - 4, 4)
      await menu.waitFor({ state: 'hidden' })
    }
    expect(treatments[0]).toMatchObject({ height: 28, chevronWidth: 16, chevronHeight: 16, chevronInset: 12, labelVisible: true })
    expect(treatments[1]).toEqual(treatments[0])
    expect(treatments[2]).toEqual(treatments[0])
    expect(new Set(hoverFills).size).toBe(1)
    expect(new Set(openFills).size).toBe(1)
    expect(new Set(focusRings).size).toBe(1)
    expect(focusRings[0]).toContain('solid 2px')
    const card = page.locator('[data-composer-card]')
    const bounds = (await card.boundingBox())!
    const buttons = await card.locator('button:visible').evaluateAll(elements => elements.map((element) => {
      const { x, y, right, bottom } = element.getBoundingClientRect()
      return { x, y, right, bottom }
    }))
    for (const [index, button] of buttons.entries()) {
      expect(button.x).toBeGreaterThanOrEqual(bounds.x)
      expect(button.right).toBeLessThanOrEqual(bounds.x + bounds.width)
      for (const peer of buttons.slice(index + 1)) {
        expect(Math.min(button.right, peer.right) - Math.max(button.x, peer.x) > 1
          && Math.min(button.bottom, peer.bottom) - Math.max(button.y, peer.y) > 1).toBe(false)
      }
    }
    await card.screenshot({ path: join(output, `${theme}-composer.png`) })
    expect(await page.locator('select:visible').count()).toBe(0)
  }
  expect(tripwire.pageErrors).toEqual([])
})
