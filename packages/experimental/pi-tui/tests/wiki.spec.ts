import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { knowledgeLibraries, type KnowledgeLibrary } from '@deepseek-ai/dsh-tool-fs-search'
import { openNativePath, runNativeCommand } from '@deepseek-ai/dsh-native-command'
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import { ChatScreen } from '../src/ui/chat.ts'
import { fixtureAgent } from './fixture-agent.ts'

vi.mock('@deepseek-ai/dsh-tool-fs-search', () => ({ knowledgeLibraries: vi.fn() }))
vi.mock('@deepseek-ai/dsh-native-command', () => ({ openNativePath: vi.fn(), runNativeCommand: vi.fn() }))

afterEach(() => vi.resetAllMocks())

async function fixture(libraries: readonly KnowledgeLibrary[]) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const agent = fixtureAgent(ctx, ctx.sessions.create(SessionId('wiki-menu')))
  const followup = vi.spyOn(agent, 'followup')
  vi.mocked(knowledgeLibraries).mockReturnValue(libraries)
  const start = vi.fn<Terminal['start']>()
  const terminal: Terminal = {
    columns: 160, rows: 60, kittyProtocolActive: false,
    start, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
    moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
    clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
  }
  const tui = new TuiAltScreen(terminal)
  const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
  tui.start()
  const input = (data: string): void => { start.mock.calls[0]?.[0](data) }
  const text = async (): Promise<string> => {
    tui.requestRender()
    await new Promise(resolve => setTimeout(resolve, 30))
    return stripVTControlCharacters(tui.getScreenLines().join('\n'))
  }
  return { ctx, agent, followup, tui, screen, input, text, dispose: async () => { tui.stop(); await ctx.fiber.dispose() } }
}

describe('/wiki local menu', () => {
  it('shows index titles from the configured path without sending a message or changing history', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-wiki-menu-'))
    const index = join(dir, 'INDEX.md')
    await writeFile(index, '# Cyber reference\n[Access control](access-control.md)\n')
    const f = await fixture([{ name: 'cyber', root: dir, index }])
    try {
      const before = f.agent.session.snapshotEvents()
      f.screen.submit('/wiki')
      f.screen.submit('/wiki')
      expect(await f.text()).toContain('Wiki libraries')
      expect(await f.text()).toContain('cyber')
      f.input('\r')
      await vi.waitFor(async () => { expect(await f.text()).toContain('View index') })
      f.input('\r')
      await vi.waitFor(async () => { expect(await f.text()).toContain('Access control') })
      expect(f.agent.session.snapshotEvents()).toEqual(before)
      expect(f.followup).not.toHaveBeenCalled()
      expect(openNativePath).not.toHaveBeenCalled()
      expect(runNativeCommand).not.toHaveBeenCalled()
      expect(knowledgeLibraries).toHaveBeenCalledWith(f.ctx, f.agent)
    } finally { await f.dispose(); await rm(dir, { recursive: true, force: true }) }
  })

  it.each(['folder', 'obsidian'] as const)('opens the selected %s using the configured library, including Unicode and spaces', async (action) => {
    const library = { name: 'cyber', root: "C:\\Wiki ทดสอบ & notes'", index: "C:\\Wiki ทดสอบ & notes'\\INDEX.md" }
    const f = await fixture([library])
    try {
      f.screen.submit('/wiki')
      f.input('\r')
      await vi.waitFor(async () => { expect(await f.text()).toContain('Open folder') })
      f.input(action === 'folder' ? '3' : '2')
      f.input('\r')
      if (action === 'folder') {
        await vi.waitFor(() => { expect(openNativePath).toHaveBeenCalledWith(library.root, expect.any(AbortSignal)) })
        expect(runNativeCommand).not.toHaveBeenCalled()
      } else {
        const uri = `obsidian://open?path=${encodeURIComponent(library.index)}`
        const command = process.platform === 'win32' ? 'powershell.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
        const args = process.platform === 'win32'
          ? ['-NoProfile', '-Command', `Start-Process -FilePath '${uri.replace(/'/g, "''")}'`]
          : [uri]
        await vi.waitFor(() => { expect(runNativeCommand).toHaveBeenCalledWith(command, args, expect.any(AbortSignal)) })
        expect(openNativePath).not.toHaveBeenCalled()
      }
      expect(f.followup).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })

  it('reports unavailable Wiki and cancels without opening an application', async () => {
    const f = await fixture([])
    try {
      f.screen.submit('/wiki')
      await vi.waitFor(async () => { expect(await f.text()).toContain('No Wiki is available') })
      vi.mocked(knowledgeLibraries).mockReturnValue([{ name: 'cyber', root: '/wiki', index: '/wiki/INDEX.md' }])
      f.screen.submit('/wiki')
      f.input('\x1b')
      expect(f.tui.hasOverlay()).toBe(false)
      expect(openNativePath).not.toHaveBeenCalled()
      expect(runNativeCommand).not.toHaveBeenCalled()
      expect(f.followup).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })

  it('rejects a changed library and shows native opener errors inside the TUI', async () => {
    const library = { name: 'cyber', root: '/wiki', index: '/wiki/INDEX.md' }
    const f = await fixture([library])
    try {
      f.screen.submit('/wiki')
      f.input('\r')
      await vi.waitFor(async () => { expect(await f.text()).toContain('Open folder') })
      vi.mocked(knowledgeLibraries).mockReturnValue([])
      f.input('3')
      f.input('\r')
      await vi.waitFor(async () => { expect(await f.text()).toContain('Wiki changed') })
      expect(openNativePath).not.toHaveBeenCalled()
      vi.mocked(knowledgeLibraries).mockReturnValue([library])
      vi.mocked(runNativeCommand).mockRejectedValueOnce(new Error('handler not installed'))
      f.screen.submit('/wiki')
      f.input('\r')
      await vi.waitFor(async () => { expect(await f.text()).toContain('Open in Obsidian') })
      f.input('2')
      f.input('\r')
      await vi.waitFor(async () => { expect(await f.text()).toContain('Could not open Obsidian') })
      expect(f.followup).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })
})
