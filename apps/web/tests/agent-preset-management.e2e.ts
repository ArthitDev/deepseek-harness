/** Profile-owned preset edits and confirmed deletion through the assembled Web UI. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-hmr'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import yaml from 'js-yaml'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage, openSettings, saveFailureShot } from './support.ts'

it('creates and copies presets with new identities while preserving sources, invalid drafts and persisted values', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{
    dir: fileURLToPath(new URL('./fixtures/plugins/fixture-managed-preset/', import.meta.url)), enabled: true,
  }] } })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser, 1280)
  onTestFailed(() => saveFailureShot(page, 'agent-preset-create-copy'))
  const tripwire = watchConsole(page)
  const ctx = scaffold.ctx
  const source = await ctx.agentPresets.readDocument('editable-example')
  const defaultId = ctx.agentPresets.defaultId
  const output = fileURLToPath(new URL('../../../.artifacts/agent-preset-create/', import.meta.url))
  await mkdir(output, { recursive: true })
  await page.goto(scaffold.authenticatedUrl)
  await openSettings(page, 'en')
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: 'Agent presets', exact: true }).click()
  const sourceRow = page.locator('[data-agent-preset-id="editable-example"]')
  await sourceRow.getByRole('button', { name: 'Copy preset: Editable example', exact: true }).click()
  const copy = page.getByRole('dialog', { name: 'Copy preset', exact: true })
  const name = copy.getByRole('textbox', { name: 'Display name', exact: true })
  const id = copy.getByRole('textbox', { name: 'Preset ID', exact: true })
  const composition = copy.getByRole('textbox', { name: 'Composition (YAML)', exact: true })
  await name.waitFor()
  expect(await name.evaluate(element => element === document.activeElement)).toBe(true)
  expect(await composition.inputValue()).toBe(source.content)
  const before = await readFile(ctx.profileContext.patchPath, 'utf8')
  await name.fill('สำเนาทดสอบ')
  await id.fill('Invalid-ID')
  await copy.getByRole('button', { name: 'Save', exact: true }).click()
  await copy.getByRole('alert').waitFor()
  expect(await readFile(ctx.profileContext.patchPath, 'utf8')).toBe(before)
  expect(await name.inputValue()).toBe('สำเนาทดสอบ')
  expect(await id.inputValue()).toBe('Invalid-ID')
  expect(await composition.inputValue()).toBe(source.content)
  for (const [theme, width] of [['light', 1280], ['dark', 420]] as const) {
    await ctx.settings.mutate('ui-theme', [{ op: 'set', path: ['preference'], value: theme }])
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(theme === 'dark')
    const box = await copy.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    const colors = await copy.evaluate((element) => {
      const background = getComputedStyle(element).backgroundColor
      const canvas = document.createElement('canvas').getContext('2d')!
      const luminance = (color: string) => {
        canvas.fillStyle = background
        canvas.fillRect(0, 0, 1, 1)
        canvas.fillStyle = color
        canvas.fillRect(0, 0, 1, 1)
        const pixel = canvas.getImageData(0, 0, 1, 1).data
        const channels = [pixel[0]!, pixel[1]!, pixel[2]!].map((value) => {
          const channel = value / 255
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        })
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      }
      const base = luminance(background)
      return Array.from(element.querySelectorAll('p, label')).map((text) => {
        const color = getComputedStyle(text).color
        const ink = luminance(color)
        return { color, background, contrast: (Math.max(ink, base) + 0.05) / (Math.min(ink, base) + 0.05) }
      })
    })
    await writeFile(join(output, `${theme}-colors.json`), JSON.stringify(colors))
    for (const text of colors) expect(text.contrast).toBeGreaterThanOrEqual(4.5)
    await copy.screenshot({ path: join(output, `${theme}-copy.png`), animations: 'disabled' })
  }
  await id.fill('copied-example')
  await copy.getByRole('button', { name: 'Save', exact: true }).click()
  await copy.waitFor({ state: 'detached' })
  expect(await ctx.agentPresets.readDocument('copied-example')).toMatchObject({ name: 'สำเนาทดสอบ', content: source.content, trust: 'user' })
  expect((await ctx.agentPresets.readDocument('editable-example')).content).toBe(source.content)
  expect(ctx.agentPresets.defaultId).toBe(defaultId)
  await expect.poll(() => sourceRow.getByRole('button', { name: 'Copy preset: Editable example', exact: true })
    .evaluate(element => element === document.activeElement)).toBe(true)
  for (const [theme, width] of [['light', 1280], ['dark', 420]] as const) {
    await ctx.settings.mutate('ui-theme', [{ op: 'set', path: ['preference'], value: theme }])
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(theme === 'dark')
    await sourceRow.screenshot({ path: join(output, `${theme}-actions.png`), animations: 'disabled' })
    await settings.getByRole('button', { name: 'Create preset', exact: true })
      .screenshot({ path: join(output, `${theme}-create-button.png`), animations: 'disabled' })
  }
  await sourceRow.getByRole('button', { name: 'Copy preset: Editable example', exact: true }).click()
  await copy.getByRole('textbox', { name: 'Preset ID', exact: true }).fill('copied-example')
  const copiedBefore = await readFile(ctx.profileContext.patchPath, 'utf8')
  await copy.getByRole('button', { name: 'Save', exact: true }).click()
  await copy.getByRole('alert').waitFor()
  expect(await readFile(ctx.profileContext.patchPath, 'utf8')).toBe(copiedBefore)
  await copy.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  const createTrigger = settings.getByRole('button', { name: 'Create preset', exact: true })
  await createTrigger.click()
  const create = page.getByRole('dialog', { name: 'Create preset', exact: true })
  await create.getByRole('textbox', { name: 'Display name', exact: true }).fill('Created directly')
  await create.getByRole('textbox', { name: 'Preset ID', exact: true }).fill('created-directly')
  await create.getByRole('textbox', { name: 'Composition (YAML)', exact: true }).fill('[]\n')
  await create.getByRole('button', { name: 'Save', exact: true }).click()
  await create.waitFor({ state: 'detached' })
  expect((await ctx.agentPresets.readDocument('created-directly')).content.trim()).toBe('[]')
  expect(ctx.agentPresets.defaultId).toBe(defaultId)
  await ctx.hmr.runExclusive(() => ctx.hmr.reconcileProfile())
  await page.reload()
  await openSettings(page, 'en')
  await settings.getByRole('button', { name: 'Agent presets', exact: true }).click()
  await page.locator('[data-agent-preset-id="created-directly"]').waitFor()
  await page.locator('[data-agent-preset-id="copied-example"]').waitFor()
  expect(tripwire.pageErrors).toEqual([])
})

it('edits migrated presets, preserves invalid drafts and keeps deletions after HMR and reload', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{
    dir: fileURLToPath(new URL('./fixtures/plugins/fixture-managed-preset/', import.meta.url)), enabled: true,
  }] } })
  onTestFinished(() => scaffold.close())
  const ctx = scaffold.ctx
  const source = await ctx.agentPresets.readDocument('editable-example')
  expect(source.trust).toBe('system')
  const patchPath = ctx.profileContext.patchPath
  await ctx.hmr.runExclusive(async () => {
    const patches = yaml.load(await readFile(patchPath, 'utf8'), { schema: entryListSchema }) as object[]
    await writeFile(patchPath, yaml.dump([...patches,
      { id: 'source-editable-example', disabled: true },
      { insert: [{ id: 'profile-preset-editable-example', name: 'cordis:preset', config: {
        id: 'editable-example', name: 'Editable example',
        plugins: yaml.load(source.content, { schema: entryListSchema }),
      } }] },
    ], { schema: entryListSchema }))
    await ctx.hmr.reconcileProfile()
  })
  expect((await ctx.agentPresets.readDocument('editable-example')).trust).toBe('user')
  const originalDocument = (await ctx.agentPresets.readDocument('editable-example')).content
  await withFileLock(join(ctx.profileContext.dir, 'package.json'), async () => {
    await expect(ctx.agentPresets.write('editable-example', '[]\n')).rejects.toThrow('writer lock')
  })
  expect((await ctx.agentPresets.readDocument('editable-example')).content).toBe(originalDocument)
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser, 1280)
  onTestFailed(() => saveFailureShot(page, 'agent-preset-management'))
  const tripwire = watchConsole(page)
  const output = fileURLToPath(new URL('../../../.artifacts/agent-preset-management/', import.meta.url))
  await mkdir(output, { recursive: true })
  await page.goto(scaffold.authenticatedUrl)
  await openSettings(page, 'en')
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: 'Agent presets', exact: true }).click()
  const row = page.locator('[data-agent-preset-id="editable-example"]')
  await row.waitFor()
  await row.getByRole('button', { name: 'Set as new task default: Editable example', exact: true }).click()
  await expect.poll(() => ctx.agentPresets.defaultId).toBe('editable-example')
  const aria = await captureStableAria(page, '[data-agent-preset-id="editable-example"]', scaffold.workspaceCwd)
  await mkdir(fileURLToPath(new URL('./expected/agent-preset-management/', import.meta.url)), { recursive: true })
  await compareOrRefreshGolden(fileURLToPath(new URL('./expected/agent-preset-management/card.expected.md', import.meta.url)), aria, scaffold.mode)
  for (const [theme, width] of [['light', 1280], ['dark', 420]] as const) {
    await ctx.settings.mutate('ui-theme', [{ op: 'set', path: ['preference'], value: theme }])
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(theme === 'dark')
    await row.screenshot({ path: join(output, `${theme}-icon-actions.png`), animations: 'disabled' })
    for (const label of ['Copy preset', 'Edit preset', 'Delete preset', 'View configuration']) {
      const action = row.getByRole('button', { name: `${label}: Editable example`, exact: true })
      expect(await action.textContent()).toBe('')
      await action.hover()
      const tip = page.getByRole('tooltip').filter({ hasText: label })
      await tip.waitFor({ state: 'visible' })
      const box = await tip.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      await page.mouse.move(0, 0)
      await tip.waitFor({ state: 'hidden' })
    }
    const edit = row.getByRole('button', { name: 'Edit preset: Editable example', exact: true })
    await page.keyboard.press('Tab')
    await edit.focus()
    await page.getByRole('tooltip').filter({ hasText: 'Edit preset' }).waitFor({ state: 'visible' })
  }
  expect(await page.locator('[data-agent-preset-id="standard"]').getByRole('button', { name: /^Edit preset:/ }).count()).toBe(0)
  const trigger = row.getByRole('button', { name: 'Edit preset: Editable example', exact: true })
  await trigger.click()
  const editor = page.getByRole('dialog', { name: 'Edit preset · Editable example', exact: true })
  const input = editor.getByRole('textbox', { name: 'Composition (YAML)', exact: true })
  const original = await input.inputValue()
  expect(original).toContain('@deepseek-ai/dsh-persona')
  await input.fill('not an entry list')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await editor.getByRole('alert').waitFor()
  expect(await input.inputValue()).toBe('not an entry list')
  expect((await ctx.agentPresets.readDocument('editable-example')).content).toBe(original)
  for (const [theme, width] of [['light', 1280], ['dark', 420]] as const) {
    await ctx.settings.mutate('ui-theme', [{ op: 'set', path: ['preference'], value: theme }])
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(theme === 'dark')
    const box = await editor.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    const colors = await editor.evaluate((element) => {
      const error = getComputedStyle(element.querySelector('[role="alert"]')!).color
      const background = getComputedStyle(element).backgroundColor
      const canvas = document.createElement('canvas').getContext('2d')!
      const luminance = (color: string) => {
        canvas.fillStyle = color
        canvas.fillRect(0, 0, 1, 1)
        const pixel = canvas.getImageData(0, 0, 1, 1).data
        const channels = [pixel[0]!, pixel[1]!, pixel[2]!].map((value) => {
          const channel = value / 255
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        })
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      }
      const foregroundLuminance = luminance(error)
      const backgroundLuminance = luminance(background)
      return { error, background, contrast: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05) }
    })
    await writeFile(join(output, `${theme}-colors.json`), JSON.stringify(colors))
    expect(colors.contrast).toBeGreaterThanOrEqual(4.5)
    await editor.screenshot({ path: join(output, `${theme}-editor.png`), animations: 'disabled' })
  }
  await input.focus()
  await page.keyboard.press('Tab')
  expect(await editor.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await input.fill('[]\n')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await editor.waitFor({ state: 'detached' })
  expect((await ctx.agentPresets.readDocument('editable-example')).content.trim()).toBe('[]')
  await expect.poll(() => trigger.evaluate(element => element === document.activeElement)).toBe(true)
  const remove = row.getByRole('button', { name: 'Delete preset: Editable example', exact: true })
  await remove.click()
  const confirmation = page.getByRole('dialog', { name: 'Delete preset', exact: true })
  await confirmation.waitFor()
  await page.keyboard.press('Escape')
  await confirmation.waitFor({ state: 'detached' })
  expect((await ctx.agentPresets.list()).some(item => item.id === 'editable-example')).toBe(true)
  await remove.click()
  await confirmation.screenshot({ path: join(output, 'dark-delete.png'), animations: 'disabled' })
  await confirmation.getByRole('button', { name: 'Delete preset', exact: true }).click()
  await confirmation.waitFor({ state: 'detached' })
  await row.waitFor({ state: 'detached' })
  expect(ctx.agentPresets.defaultId).toBe('standard')
  await ctx.hmr.runExclusive(() => ctx.hmr.reconcileProfile())
  expect((await ctx.agentPresets.list()).some(item => item.id === 'editable-example')).toBe(false)
  expect(await readFile(patchPath, 'utf8')).toContain('id: source-editable-example\n  disabled: true')
  await page.reload()
  await openSettings(page, 'en')
  await settings.getByRole('button', { name: 'Agent presets', exact: true }).click()
  expect(await row.count()).toBe(0)
  expect(tripwire.pageErrors).toEqual([])
})
