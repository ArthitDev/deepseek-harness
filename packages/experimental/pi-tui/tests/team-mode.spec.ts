import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '../../../boot/app-boot/src/index.ts'
import ConfigEditor from '../../../boot/config-editor/src/index.ts'
import Settings from '../../../settings/settings/src/index.ts'
import SystemPrompt from '../../../core/system-prompt/src/index.ts'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import PentestModePolicy from '@deepseek-ai/dsh-pentest-executor'
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import { installWebPromptSettings } from '../src/core/prompt-settings.ts'
import { readProfileConfig } from '../src/core/web-settings.ts'
import { TEAM_MODE_OPTIONS } from '../src/core/team-mode.ts'
import { ChatScreen } from '../src/ui/chat.ts'
import { fixtureAgent } from './fixture-agent.ts'

describe('/team-mode', () => {
  it.each([false, true])('picks, persists and displays team modes with suppression=%s', async (suppressed) => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-team-mode-command-'))
    const dir = join(home, 'profiles', 'tui')
    const bundle = join(dir, 'node_modules', 'team-mode-fixture')
    const contexts: Context[] = []
    let tui: TuiAltScreen | undefined
    try {
      initProfile(dir, ['team-mode-fixture'])
      await mkdir(bundle, { recursive: true })
      await writeFile(join(home, 'package.json'), '{"name":"team-mode-fixture-home"}')
      await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'team-mode-fixture', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
      await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
        { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
        { id: 'system-prompt', name: 'cordis:prompt' }, { id: 'session', name: 'cordis:session' },
        { id: 'pentest-mode', name: 'cordis:mode' }, { id: 'tui-settings', name: 'cordis:tui-settings' },
      ] }]))
      await writeFile(join(dir, 'cordis.yml'), '[]')
      const webPath = join(home, 'profiles', 'web', 'cordis.patch.yml')
      await mkdir(join(home, 'profiles', 'web'), { recursive: true })
      const webConfig = { mode: 'blue', suppressSections: suppressed, bluePrompt: 'WEB_BLUE', redPrompt: 'WEB_RED', blackPrompt: 'WEB_BLACK', deadPrompt: 'WEB_DEAD' }
      const webSource = JSON.stringify([{ id: 'pentest-mode', config: webConfig }])
      await writeFile(webPath, webSource)
      const profile: ProfileContext = { name: 'tui', home, cwd: home, dir,
        startedBundles: ['team-mode-fixture'], patchPath: join(dir, 'cordis.patch.yml'),
        installAnchor: join(home, 'package.json'), overlays: [], telemetryDisabledEnv: undefined }
      const start = async () => {
        const ctx = await boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), (ctx) => {
          ctx.provide('profileContext', profile)
          ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
          Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, prompt: SystemPrompt,
            session: SessionStore, mode: PentestModePolicy,
            'tui-settings': { name: 'tui-settings', inject: ['pentestModePolicy', 'systemPrompt'], apply: installWebPromptSettings } })
        })
        contexts.push(ctx)
        return ctx
      }
      const ctx = await start()
      expect(ctx.pentestModePolicy.current().mode).toBe('blue')
      expect(ctx.pentestModePolicy.current().bluePrompt).toBe('WEB_BLUE')
      const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId('team-mode-command')))
      const followup = vi.spyOn(agent, 'followup')
      const cancel = vi.spyOn(agent, 'cancel')
      const startInput = vi.fn<Terminal['start']>()
      const terminal: Terminal = { columns: 120, rows: 60, kittyProtocolActive: false,
        start: startInput, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(), moveBy: vi.fn(),
        hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(), clearFromCursor: vi.fn(),
        clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn() }
      tui = new TuiAltScreen(terminal)
      const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
      tui.start()
      const visible = () => { tui!.renderNow(); return stripVTControlCharacters(tui!.getScreenLines().join('\n')) }
      const input = (data: string) => startInput.mock.calls[0]?.[0](data)
      const write = vi.spyOn(ctx.settings, 'update')
      const show = vi.spyOn(tui, 'showOverlay')
      const before = await readFile(profile.patchPath, 'utf8')
      screen.submit('/team-mode')
      screen.submit('/team-mode')
      expect(show).toHaveBeenCalledOnce()
      expect(visible()).toContain('Select Team Mode')
      expect(visible()).toContain('1. 🛡 Blue Team (current)')
      input('3')
      expect(visible()).toContain('→ 3. ◆ Black Team')
      expect(write).not.toHaveBeenCalled()
      expect(await readFile(profile.patchPath, 'utf8')).toBe(before)
      input('\r')
      await vi.waitFor(() => { expect(ctx.pentestModePolicy.current().mode).toBe('black') })
      await vi.waitFor(() => { expect(visible()).toContain('team-mode: black · applies to the next request') })
      expect(tui.hasOverlay()).toBe(false)
      expect(write).toHaveBeenCalledExactlyOnceWith('pentest-mode', { mode: 'black' })
      expect(readProfileConfig(ctx, 'pentest-mode')?.get('mode')).toBe('black')
      expect(visible()).toContain('◆ Black Team')
      screen.handleEvent(agent.session.append('turn/start', { turn: 1 }))
      const saved = await readFile(profile.patchPath, 'utf8')
      screen.submit('/team-mode')
      expect(visible()).toContain('3. ◆ Black Team (current)')
      input('\x1b')
      await vi.waitFor(() => { expect(tui!.hasOverlay()).toBe(false) })
      expect(cancel).not.toHaveBeenCalled()
      expect(await readFile(profile.patchPath, 'utf8')).toBe(saved)
      expect(write).toHaveBeenCalledOnce()
      for (const option of [TEAM_MODE_OPTIONS[0], TEAM_MODE_OPTIONS[1], TEAM_MODE_OPTIONS[3], TEAM_MODE_OPTIONS[2]]) {
        screen.submit(`/team-mode ${option.value}`)
        await vi.waitFor(() => { expect(ctx.pentestModePolicy.current().mode).toBe(option.value) })
        await vi.waitFor(() => { expect(readProfileConfig(ctx, 'pentest-mode')?.get('mode')).toBe(option.value) })
        await vi.waitFor(() => { expect(visible()).toContain(`${option.icon} ${option.label}`) })
        await ctx.systemPrompt.assemble()
        expect(ctx.pentestModePolicy.current().mode).toBe(option.value)
        expect(ctx.pentestModePolicy.current().suppressSections).toBe(false)
      }
      const stable = await readFile(profile.patchPath, 'utf8')
      const count = write.mock.calls.length
      screen.submit('/team-mode status')
      screen.submit('/team-mode invalid')
      expect(visible()).toContain('usage: /team-mode [blue|red|black|dead|status]')
      expect(await readFile(profile.patchPath, 'utf8')).toBe(stable)
      expect(write).toHaveBeenCalledTimes(count)
      write.mockRejectedValueOnce(new Error('synthetic save failure'))
      screen.submit('/team-mode red')
      await vi.waitFor(() => { expect(visible()).toContain('command failed: synthetic save failure') })
      expect(ctx.pentestModePolicy.current().mode).toBe('black')
      expect(await readFile(profile.patchPath, 'utf8')).toBe(stable)
      write.mockRestore()
      expect(followup).not.toHaveBeenCalled()
      expect(await readFile(webPath, 'utf8')).toBe(webSource)
      tui.stop()
      await ctx.fiber.dispose()
      const restarted = await start()
      expect(restarted.pentestModePolicy.current().mode).toBe('black')
      expect(restarted.pentestModePolicy.current().suppressSections).toBe(false)
      // Web prompt edits remain shared, while saved TUI mode and suppression retain precedence.
      await writeFile(webPath, JSON.stringify([{ id: 'pentest-mode', config: { ...webConfig, mode: 'red', blackPrompt: 'UPDATED_WEB_BLACK' } }]))
      const assembly = await restarted.systemPrompt.assemble()
      expect(restarted.pentestModePolicy.current().mode).toBe('black')
      expect(restarted.pentestModePolicy.current().blackPrompt).toBe('UPDATED_WEB_BLACK')
      expect(assembly.sections.find(section => section.name === 'pentest:mode-policy')?.text)
        .toBe('UPDATED_WEB_BLACK')
    } finally {
      tui?.stop()
      for (const ctx of contexts) await ctx.fiber.dispose()
      await rm(home, { recursive: true, force: true })
    }
  })
})
