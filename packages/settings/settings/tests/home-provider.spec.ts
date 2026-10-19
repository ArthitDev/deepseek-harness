/** Provider deletion through real settings, patch composition, and Loader reconciliation. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import z from '@deepseek-ai/schemastery'
import { parse } from 'yaml'
import { configurationFixture } from './configuration-fixture.ts'

const schema = z.object({
  ordinary: z.string().required(),
  token: z.string().role('secret').volatile(),
  providers: z.dict(z.object({ model: z.string(), apiKeyEnv: z.string() })).default({}).volatile(),
})

it('deletes a home-defined provider, retains other routes and credentials, and persists across restart', async () => {
  const { ctx, home, profile, start } = await configurationFixture({ schema, hmr: false })
  const path = join(home, 'cordis.patch.yml')
  writeFileSync(profile.patchPath, JSON.stringify([{ id: 'first', config: { ordinary: 'fixed', providers: { 'b-ai': { model: 'lower-bai' }, profile: { model: 'lower' } } } }]))
  const profileBefore = readFileSync(profile.patchPath, 'utf8')
  const credentials = join(home, 'credentials.json')
  writeFileSync(credentials, '{"BAI_API_KEY":"private-fixture-key"}\n')
  const credentialBefore = readFileSync(credentials, 'utf8')
  writeFileSync(path, '# Shared provider configuration\n- id: first\n  config:\n    ordinary: fixed\n    token: private\n    providers:\n      b-ai: { model: removed, apiKeyEnv: BAI_API_KEY }\n      retained: { model: keep, apiKeyEnv: SHARED_API_KEY }\n- id: second\n  config:\n    ordinary: !!js "\'unchanged\'"\n    count: 7\n')
  await ctx.settings.mutate('first', [{ op: 'unset', path: ['providers', 'b-ai'] }])
  const saved = readFileSync(path, 'utf8')
  expect(saved).toContain('# Shared provider configuration')
  expect(saved).toContain('!!js')
  expect(saved).not.toContain('b-ai')
  expect(readFileSync(profile.patchPath, 'utf8')).toBe(profileBefore)
  expect(readFileSync(credentials, 'utf8')).toBe(credentialBefore)
  const value = ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'first')!
  expect(value.value).toEqual({ providers: { retained: { model: 'keep', apiKeyEnv: 'SHARED_API_KEY' } } })
  expect(value.base).toMatchObject({ providers: { 'b-ai': { model: 'lower-bai' }, profile: { model: 'lower' } } })
  expect(value.user).toEqual(value.value)
  expect(JSON.stringify(value)).not.toContain('private')
  expect({ value: value.value, base: value.base, user: value.user, credentialUnchanged: true }).toMatchSnapshot()
  await ctx.fiber.dispose()
  const restored = await start()
  expect(restored.settings.describe().find(row => row.ns === 'first')!.value).toMatchObject({
    providers: { retained: { model: 'keep', apiKeyEnv: 'SHARED_API_KEY' } },
  })
  expect(restored.settings.describe().find(row => row.ns === 'first')!.value).not.toHaveProperty('providers.b-ai')
  await restored.settings.mutate('first', [{ op: 'unset', path: ['providers', 'retained'] }])
  expect(restored.settings.describe().find(row => row.ns === 'first')!.value).toMatchObject({ providers: {} })
  expect(readFileSync(path, 'utf8')).not.toContain('b-ai')
  expect(readFileSync(credentials, 'utf8')).toBe(credentialBefore)
})

it('restores the home patch when a provider config fails activation', async () => {
  const { ctx, home, profile } = await configurationFixture({ schema, hmr: false, apply: (_ctx, config) => {
    if ((config as { ordinary: string }).ordinary === 'reject') throw new Error('activation refused')
  } })
  const path = join(home, 'cordis.patch.yml')
  writeFileSync(path, '- id: first\n  config:\n    ordinary: fixed\n    providers:\n      b-ai: { model: retained }\n')
  const before = readFileSync(path, 'utf8')
  const profileBefore = readFileSync(profile.patchPath, 'utf8')
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'first')!
  await expect(ctx.configEditor.edit(entry, current => ({ ...current, ordinary: 'reject' }))).rejects.toThrow()
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(readFileSync(profile.patchPath, 'utf8')).toBe(profileBefore)
  expect(parse(readFileSync(path, 'utf8'))).toHaveLength(1)
})
