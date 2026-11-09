/** Continuous Workspace/session guides through compact rows and overflow controls. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

it('connects compact session guides across multiple workspaces and overflow rows', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  const fixture = await readFile(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url), 'utf8')
  for (const [index, count] of [1, 7, 0].entries()) {
    const path = join(scaffold.workspaceCwd, `workspace-${index}`)
    await mkdir(path)
    const workspace = await scaffold.ctx.workspaceRegistry.create(path, `Workspace ${index + 1}`)
    for (let session = 0; session < count; session++) {
      const id = await seedSession({ ...scaffold, workspaceCwd: path }, fixture, `guide-${index}-${session}`)
      await workspace.attachSession(id)
      await scaffold.ctx.sessionController.rename({ sessionId: id, title: `Session ${session + 1}` })
    }
  }
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser, 850)
  onTestFailed(() => saveFailureShot(page, 'workspace-tree-guides'))
  const tripwire = watchConsole(page)
  const output = fileURLToPath(new URL('../../../.artifacts/workspace-tree-guides/', import.meta.url))
  await mkdir(output, { recursive: true })

  for (const dark of [false, true]) {
    await scaffold.ctx.settings.mutate('ui-theme', [{ op: 'set', path: ['preference'], value: dark ? 'dark' : 'light' }])
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const workspaces = page.locator('[data-row-key^="workspace:"]')
    await expect.poll(() => workspaces.count()).toBe(3)
    for (const workspace of await workspaces.all()) {
      if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
    }
    await page.mouse.move(1000, 700)
    await expect.poll(() => page.locator('[data-tree-connector]').count()).toBeGreaterThanOrEqual(6)
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.then(() => undefined, () => undefined)))
    })
    const sections = await page.locator('[data-tree-depth="0"]').evaluateAll(elements => elements.map((section) => {
      const bounds = section.getBoundingClientRect()
      const folder = section.querySelector('[class*="folder"] svg')!.getBoundingClientRect()
      const rows = [...section.children].filter(child => child.querySelector(':scope > [data-row-key^="session:"]'))
      const continuation = getComputedStyle(section, '::after')
      return {
        top: bounds.top,
        bottom: bounds.bottom,
        bridgeLeft: bounds.left + Number.parseFloat(getComputedStyle(section).backgroundPositionX),
        folderGap: bounds.top + Number.parseFloat(getComputedStyle(section).backgroundPositionY) - folder.bottom,
        continuationEnd: continuation.content === 'none'
          ? null : bounds.top + Number.parseFloat(continuation.top) + Number.parseFloat(continuation.height),
        sessions: rows.map((wrapper) => {
          const rect = wrapper.getBoundingClientRect()
          const trunk = getComputedStyle(wrapper, '::before')
          const tick = wrapper.querySelector('[data-tree-connector]')!.getBoundingClientRect()
          const title = wrapper.querySelector('[class*="title"]')!.getBoundingClientRect()
          return {
            top: rect.top, bottom: rect.bottom, height: rect.height,
            trunkStart: rect.top + Number.parseFloat(trunk.top),
            trunkLeft: rect.left + Number.parseFloat(trunk.left),
            trunkEnd: rect.top + Number.parseFloat(trunk.top) + Number.parseFloat(trunk.height),
            tickTop: tick.top, tickHeight: tick.height,
            tickLeft: tick.left, tickWidth: tick.width, labelGap: title.left - tick.right,
            tickRadius: getComputedStyle(wrapper.querySelector('[data-tree-connector]')!).borderBottomLeftRadius,
          }
        }),
        hasOverflow: section.lastElementChild?.matches('button[data-row-key^="overflow:"]') === true,
      }
    }))
    for (const [index, section] of sections.entries()) {
      const nextSection = sections[index + 1]
      expect(section.continuationEnd).toBe(nextSection?.top ?? null)
      for (const [rowIndex, row] of section.sessions.entries()) {
        expect(row.height).toBe(28)
        expect(row.trunkStart).toBe(row.top)
        expect(row.trunkLeft).toBe(section.bridgeLeft)
        const nextRow = section.sessions[rowIndex + 1]
        // The last row's elbow belongs to the trunk; its straight tick starts after the curve.
        const tickStart = nextRow === undefined && !section.hasOverflow ? 8 : 3
        expect(row.tickLeft).toBe(row.trunkLeft + tickStart)
        expect(row.tickWidth).toBe(16 - tickStart)
        expect(row.labelGap).toBe(8)
        expect(row.tickTop).toBe(row.top + 14)
        expect(row.tickHeight).toBe(1)
        expect(row.tickRadius).toBe('0px')
        if (nextRow !== undefined) {
          expect(row.bottom).toBe(nextRow.top)
          expect(row.trunkEnd).toBe(nextRow.trunkStart)
        } else {
          expect(row.trunkEnd).toBe(section.hasOverflow ? row.bottom : row.top + 15)
        }
      }
      const first = section.sessions[0]
      if (first !== undefined) {
        expect(first.top).toBe(section.top + 34)
        expect(section.folderGap).toBe(4)
      }
    }
    const overflow = page.getByRole('button', { name: 'Show 2 more sessions', exact: true })
    expect((await overflow.boundingBox())?.height).toBe(28)
    await page.mouse.move(1000, 700)
    await page.locator('[class*="sidebarCol"]').screenshot({ path: join(output, `${dark ? 'dark' : 'light'}.png`) })
    await overflow.click()
    await page.getByRole('button', { name: 'Show less', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Show less', exact: true }).click()
    await overflow.waitFor()
  }
  expect(tripwire.pageErrors).toEqual([])
})
