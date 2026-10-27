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
import { ChatScreen } from '../src/ui/chat.ts'
import { fixtureAgent } from './fixture-agent.ts'

describe('/suppress-prompt', () => {
  it.each([false, true])('locks suppression OFF without changing Web=%s, including restart', async (webEnabled) => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-suppress-command-'))
    const dir = join(home, 'profiles', 'tui')
    const bundle = join(dir, 'node_modules', 'suppression-fixture')
    const contexts: Context[] = []
    let tui: TuiAltScreen | undefined
    try {
      initProfile(dir, ['suppression-fixture'])
      await mkdir(bundle, { recursive: true })
      await writeFile(join(home, 'package.json'), '{"name":"suppression-fixture-home"}')
      await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'suppression-fixture', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
      await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
        { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
        { id: 'system-prompt', name: 'cordis:prompt' }, { id: 'session', name: 'cordis:session' },
        { id: 'pentest-mode', name: 'cordis:mode' }, { id: 'tui-settings', name: 'cordis:tui-settings' },
      ] }]))
      await writeFile(join(dir, 'cordis.yml'), '[]')
      const webPath = join(home, 'profiles', 'web', 'cordis.patch.yml')
      await mkdir(join(home, 'profiles', 'web'), { recursive: true })
      const webSource = JSON.stringify([{ id: 'pentest-mode', config: { suppressSections: webEnabled } }])
      await writeFile(webPath, webSource)
      const profile: ProfileContext = { name: 'tui', home, cwd: home, dir,
        startedBundles: ['suppression-fixture'], patchPath: join(dir, 'cordis.patch.yml'),
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
      expect(ctx.pentestModePolicy.current().suppressSections).toBe(false)
      const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId('suppression-command')))
      const followup = vi.spyOn(agent, 'followup')
      const startInput = vi.fn<Terminal['start']>()
      const terminal: Terminal = { columns: 120, rows: 60, kittyProtocolActive: false,
        start: startInput, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(), moveBy: vi.fn(),
        hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(), clearFromCursor: vi.fn(),
        clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn() }
      tui = new TuiAltScreen(terminal)
      const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
      tui.start()
      const visible = () => { tui!.renderNow(); return stripVTControlCharacters(tui!.getScreenLines().join('\n')) }
      const show = vi.spyOn(tui, 'showOverlay')
      const write = vi.spyOn(ctx.settings, 'update')
      const cancel = vi.spyOn(agent, 'cancel')
      screen.handleEvent(agent.session.append('turn/start', { turn: 1 }))
      for (const alias of ['suppress-prompt', 'suppress-promot']) {
        screen.submit(`/${alias}`)
        screen.submit(`/${alias} status`)
        expect(visible()).toContain('suppress-prompt: OFF · locked by strict system prompt protection')
        for (const command of ['on', 'toggle']) {
          screen.submit(`/${alias} ${command}`)
          expect(visible()).toContain('Cannot suppress the system prompt')
          expect(ctx.pentestModePolicy.current().suppressSections).toBe(false)
        }
      }
      expect(show).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      expect(cancel).not.toHaveBeenCalled()
      screen.submit('/suppress-prompt off')
      await vi.waitFor(() => { expect(readProfileConfig(ctx, 'pentest-mode')?.get('suppressSections')).toBe(false) })
      expect(write).toHaveBeenCalledExactlyOnceWith('pentest-mode', { suppressSections: false })
      await ctx.settings.update('pentest-mode', { suppressSections: true })
      await ctx.systemPrompt.assemble()
      expect(ctx.pentestModePolicy.current().suppressSections).toBe(false)
      write.mockRestore()
      const saved = await readFile(profile.patchPath, 'utf8')
      screen.submit('/suppress-prompt status')
      screen.submit('/suppress-prompt invalid')
      expect(visible()).toContain('usage: /suppress-prompt [on|off|toggle|status]')
      expect(await readFile(profile.patchPath, 'utf8')).toBe(saved)
      const update = vi.spyOn(ctx.settings, 'update').mockRejectedValueOnce(new Error('synthetic save failure'))
      screen.submit('/suppress-prompt off')
      await vi.waitFor(() => { expect(visible()).toContain('command failed: synthetic save failure') })
      expect(ctx.pentestModePolicy.current().suppressSections).toBe(false)
      expect(await readFile(profile.patchPath, 'utf8')).toBe(saved)
      update.mockRestore()
      expect(followup).not.toHaveBeenCalled()
      expect(await readFile(webPath, 'utf8')).toBe(webSource)
      tui.stop()
      await ctx.fiber.dispose()
      const restarted = await start()
      expect(restarted.pentestModePolicy.current().suppressSections).toBe(false)
      await restarted.systemPrompt.assemble()
      expect(restarted.pentestModePolicy.current().suppressSections).toBe(false)
    } finally {
      tui?.stop()
      for (const ctx of contexts) await ctx.fiber.dispose()
      await rm(home, { recursive: true, force: true })
    }
  })
})
