/** Shared-home edits retain raw expressions, sibling secrets and atomic failure behavior. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import z from '@deepseek-ai/schemastery'
import * as appBoot from '@deepseek-ai/dsh-app-boot'
import { parse } from 'yaml'
import { configurationFixture } from './configuration-fixture.ts'

it.each([false, true])('edits and resets a home-inserted entry without removing its insertion (group: %s)', async (group) => {
  const { ctx, home, profile, start } = await configurationFixture({ hmr: false })
  await ctx.fiber.dispose()
  const path = join(home, 'cordis.patch.yml')
  const entry = { id: 'home-probe', name: 'cordis:probe', config: { ordinary: 'home', count: 4 } }
  const patches = [{ insert: group ? [{ id: 'home-group', name: 'cordis:group', group: true, config: [entry] }] : [entry] }]
  writeFileSync(path, '# home insertion\n' + JSON.stringify(patches))
  const restored = await start()
  const beforeProfile = readFileSync(profile.patchPath, 'utf8')
  expect(restored.configEditor.configuration().find(row => row.entry.options.id === 'home-probe')!.inherited).toEqual(entry.config)
  await restored.settings.update('home-probe', { count: 8 })
  expect(restored.settings.describe().find(row => row.ns === 'home-probe')!.value).toMatchObject({ count: 8 })
  expect(readFileSync(profile.patchPath, 'utf8')).toBe(beforeProfile)
  expect(readFileSync(path, 'utf8')).toContain('# home insertion')
  await restored.fiber.dispose()
  const restarted = await start()
  expect(restarted.settings.describe().find(row => row.ns === 'home-probe')!.value).toMatchObject({ count: 8 })
  await restarted.settings.replace('home-probe', {})
  expect(restarted.settings.describe().find(row => row.ns === 'home-probe')!.value).toMatchObject({ count: 4 })
  expect(parse(readFileSync(path, 'utf8'))).toEqual(patches)
  expect(readFileSync(profile.patchPath, 'utf8')).toBe(beforeProfile)
})

it('saves model changes in home without materializing the endpoint expression or losing a sibling secret', async () => {
  const { ctx, home, profile, start } = await configurationFixture({
    hmr: false,
    schema: z.object({ providers: z.dict(z.object({
      baseURL: z.string(), model: z.string(), token: z.string().role('secret'),
    })).volatile() }),
  })
  await ctx.fiber.dispose()
  const path = join(home, 'cordis.patch.yml')
  writeFileSync(path, [
    '# shared models', '- id: first', '  config:', '    providers:', '      zcode-direct:',
    '        baseURL: !!js "\'http://127.0.0.1:18080/v1\'"', '        model: original',
    '        token: private-fixture', '',
  ].join('\n'))
  const restored = await start()
  const beforeProfile = readFileSync(profile.patchPath, 'utf8')
  await restored.settings.mutate('first', [{ op: 'set', path: ['providers', 'zcode-direct', 'model'], value: 'edited' }])
  const saved = readFileSync(path, 'utf8')
  expect(saved).toContain('# shared models')
  expect(saved).toContain('!!js')
  expect(saved).toContain('private-fixture')
  expect(readFileSync(profile.patchPath, 'utf8')).toBe(beforeProfile)
  const descriptor = restored.settings.describe({ redactSecrets: true }).find(row => row.ns === 'first')!
  expect(descriptor.value).toEqual({ providers: { 'zcode-direct': { baseURL: 'http://127.0.0.1:18080/v1', model: 'edited' } } })
  expect(descriptor.user).toMatchObject({ providers: { 'zcode-direct': { baseURL: { __jsExpr: "'http://127.0.0.1:18080/v1'" } } } })
  expect(JSON.stringify(descriptor)).not.toContain('private-fixture')
  await expect(restored.settings.mutate('first', [{ op: 'set', path: ['providers', 'zcode-direct', 'baseURL'], value: {} }]))
    .rejects.toThrow()
  expect(readFileSync(path, 'utf8')).toBe(saved)
})

it('restores the exact home document when reconciliation fails after persistence', async () => {
  const { ctx, home, profile, start } = await configurationFixture({ hmr: false })
  await ctx.fiber.dispose()
  const path = join(home, 'cordis.patch.yml')
  const before = '# keep this comment\n- id: default-model\n  config: { provider: test, model: home }\n'
  writeFileSync(path, before)
  const restored = await start()
  const beforeProfile = readFileSync(profile.patchPath, 'utf8')
  const reconcile = vi.spyOn(appBoot, 'reconcileProfilePatches')
    .mockImplementationOnce(appBoot.reconcileProfilePatches)
    .mockRejectedValueOnce(new Error('fixture reconciliation failed'))
  try {
    await expect(restored.settings.update('default-model', { model: 'edited' })).rejects.toThrow('fixture reconciliation failed')
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(readFileSync(profile.patchPath, 'utf8')).toBe(beforeProfile)
    expect(restored.agentDefaultModel.currentSelection().model).toBe('home')
  } finally {
    reconcile.mockRestore()
  }
})
