/** Profile-backed authoring: create, copy, write, and delete against the active profile's patch. */
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import SettingsForms from '@deepseek-ai/dsh-settings'
import PresetDeclaration from '../../agent-preset/src/index.ts'
import AgentPresets, { SETTINGS_NAMESPACE } from '../src/index.ts'
import type { AgentPresetRoster } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

/** Entry rows every authoring composition mounts in the profile patch. */
function baseRows(): object[] {
  return [
    { insert: [
      { id: 'sessions', name: 'cordis:sessions' },
      { id: 'projections', name: 'cordis:projections' },
      { id: 'agents', name: 'cordis:agents' },
      { id: SETTINGS_NAMESPACE, name: 'cordis:agentPresets', config: { default: 'standard' } },
    ] },
  ]
}

/** Boot a real profile composition whose patch file the authoring remotes edit. */
async function profileHarness(extraRows: object[] = []): Promise<{ ctx: Context; profile: ProfileContext }> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'preset-authoring-')))
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, [])
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', dir, patchPath: join(dir, 'cordis.patch.yml'), home, cwd: home,
    installAnchor: join(home, 'package.json'), startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  }
  // The home layer plays the deployment: its preset ships with the machine,
  // below the profile patch every authoring remote edits.
  writeFileSync(join(home, 'cordis.patch.yml'), JSON.stringify([
    { insert: [{ id: 'preset-standard', name: 'cordis:preset', config: { id: 'standard', plugins: [] } }] },
  ]))
  writeFileSync(profile.patchPath, JSON.stringify([...baseRows(), ...extraRows]))
  const ctx = await boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), (host) => {
    host.provide('profileContext', profile)
    host.loader.builtins.sessions = SessionStore
    host.loader.builtins.projections = SessionProjectionRegistry
    host.loader.builtins.agents = AgentRegistry
    host.loader.builtins.agentPresets = AgentPresets
    host.loader.builtins.preset = PresetDeclaration
    host.loader.builtins.configEditor = ConfigEditor
    host.loader.builtins.settings = SettingsForms
    // The plugin every authored composition in this suite names; service-free so activation is clean.
    host.loader.builtins.probe = { apply() {} }
  })
  contexts.push(ctx)
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  return { ctx, profile }
}

/** Composition rows mounting the Settings stack beside the registry. */
function settingsRows(): object[] {
  return [{ insert: [
    { id: 'config-editor', name: 'cordis:configEditor' },
    { id: 'settings', name: 'cordis:settings' },
  ] }]
}

const rosterOf = async (ctx: Context): Promise<AgentPresetRoster> => await ctx.agentPresets.remoteExportList()

describe('preset authoring', () => {
  it('marks shipped presets system and reports the profile authorable', async () => {
    const { ctx } = await profileHarness()
    const roster = await rosterOf(ctx)
    expect(roster.authorable).toBe(true)
    expect(roster.modeSelectionEnabled).toBe(true)
    expect(roster.models).toEqual([])
    expect(roster.presets).toHaveLength(1)
    expect(roster.presets[0]).toMatchObject({ id: 'standard', trust: 'system', isDefault: true })
    expect(await ctx.agentPresets.readDocument('standard')).toMatchObject({ trust: 'system' })
  })

  it('creates a preset from caller content into the profile patch', async () => {
    const { ctx, profile } = await profileHarness()
    await ctx.agentPresets.create('standard', 'mine', 'My agent', '- name: cordis:probe\n')
    // The reconciled row activates the cordis:preset plugin asynchronously; wait for it to register.
    await vi.waitFor(async () => {
      const roster = await rosterOf(ctx)
      console.error('[auth debug] presets:', JSON.stringify(roster.presets.map(row => ({ id: row.id, trust: (row as { trust?: string }).trust }))))
      return roster.presets.some(row => row.id === 'mine')
    })
    const roster = await rosterOf(ctx)
    expect(roster.presets.find(row => row.id === 'mine')).toMatchObject({ trust: 'user', name: 'My agent' })
    expect(roster.presets.find(row => row.id === 'standard')?.trust).toBe('system')
    expect(await ctx.agentPresets.readDocument('mine')).toMatchObject({ trust: 'user' })
    const stored = readFileSync(profile.patchPath, 'utf8')
    expect(stored).toContain('id: preset-mine')
    expect(stored).toContain('- name: cordis:probe')
  })

  it('refuses unusable ids, taken ids, and unknown sources', async () => {
    const { ctx } = await profileHarness()
    await expect(ctx.agentPresets.create('standard', 'Nope', undefined, '[]\n')).rejects.toThrow(/must match/)
    await expect(ctx.agentPresets.create('standard', 'standard', undefined, '[]\n')).rejects.toThrow(/already exists/)
    await expect(ctx.agentPresets.create('absent', 'mine', undefined, '[]\n')).rejects.toThrow('Unknown agent preset: absent')
    await expect(ctx.agentPresets.write('standard', '[]\n')).rejects.toThrow(/ships with the deployment/)
    await expect(ctx.agentPresets.remove('standard')).rejects.toThrow(/ships with the deployment/)
    expect((await rosterOf(ctx)).presets).toHaveLength(1)
  })

  it('refuses invalid composition text and leaves the patch untouched', async () => {
    const { ctx, profile } = await profileHarness()
    const before = readFileSync(profile.patchPath, 'utf8')
    await expect(ctx.agentPresets.create('standard', 'mine', undefined, 'just a string')).rejects.toThrow(/must be a top-level list/)
    await expect(ctx.agentPresets.create('standard', 'mine', undefined, '- name: ""\n')).rejects.toThrow(/names no plugin/)
    expect(readFileSync(profile.patchPath, 'utf8')).toBe(before)
    expect((await rosterOf(ctx)).presets).toHaveLength(1)
  })

  it('copies a preset whole, then rewrites and deletes the copy', async () => {
    const { ctx, profile } = await profileHarness()
    await ctx.agentPresets.copy('standard', 'mine', 'My copy')
    expect((await rosterOf(ctx)).presets.find(row => row.id === 'mine')).toMatchObject({ trust: 'user', name: 'My copy' })
    await ctx.agentPresets.write('mine', '- id: probe\n  name: cordis:probe\n')
    expect((await ctx.agentPresets.readDocument('mine')).content).toContain('cordis:probe')
    await ctx.agentPresets.remove('mine')
    const roster = await rosterOf(ctx)
    expect(roster.presets).toHaveLength(1)
    expect(roster.presets[0]?.id).toBe('standard')
    const stored = readFileSync(profile.patchPath, 'utf8')
    expect(stored).not.toContain('mine')
  })

  it('keeps a retained revision for a cold reader across the delete', async () => {
    const { ctx } = await profileHarness()
    await ctx.agentPresets.copy('standard', 'mine')
    const lease = await ctx.agentPresets.acquireScope('mine')
    const key = lease.key
    await ctx.agentPresets.remove('mine')
    // The roster no longer lists the preset, but the reader's revision stays
    // composed — the same guarantee a live session's composition relies on.
    expect((await rosterOf(ctx)).presets.map(row => row.id)).toEqual(['standard'])
    expect(ctx.agentPresets.inspectCompositions().map(row => row.id)).toEqual(['standard', 'mine'])
    await lease[Symbol.asyncDispose]()
    expect(ctx.agentPresets.inspectCompositions().map(row => row.id)).toEqual(['standard'])
    expect(key).toBeDefined()
  })

  it('clears the selected default and model bindings a delete orphans', async () => {
    const { ctx } = await profileHarness(settingsRows())
    await ctx.agentPresets.copy('standard', 'mine')
    await ctx.settings.update(SETTINGS_NAMESPACE, { selectedDefault: 'mine', models: { route: { model: 'mine' } } })
    expect(ctx.agentPresets.defaultId).toBe('mine')
    await ctx.agentPresets.remove('mine')
    expect(ctx.agentPresets.defaultId).toBe('standard')
    expect(ctx.agentPresets.presetIdForModel('route', 'model')).toBe('standard')
    const stored = readFileSync(join(ctx.profileContext.dir, 'cordis.patch.yml'), 'utf8')
    expect(stored).not.toContain('mine')
  })

  it('stores !!js conditions in a created composition as the Loader dialect', async () => {
    const { ctx, profile } = await profileHarness()
    await ctx.agentPresets.create('standard', 'mine', undefined, '- name: cordis:probe\n  disabled: !!js process.platform === \'win32\'\n')
    const stored = readFileSync(profile.patchPath, 'utf8')
    expect(stored).toContain('!!js process.platform')
    expect(stored).not.toContain('__jsExpr')
  })

  it('answers nothing authorable in a composition no profile launched', async () => {
    const bare = new Context()
    contexts.push(bare)
    bare.baseUrl = 'file:///preset-authoring-bare/'
    await bare.plugin(Loader)
    await bare.plugin(SessionStore)
    await bare.plugin(SessionProjectionRegistry)
    await bare.plugin(AgentRegistry)
    await bare.plugin(AgentPresets, { default: 'standard' })
    const roster = await bare.agentPresets.remoteExportList()
    expect(roster.authorable).toBe(false)
    expect(roster.presets).toEqual([])
    await expect(bare.agentPresets.copy('standard', 'mine')).rejects.toThrow(/cannot be changed/)
  })
})
