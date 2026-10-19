/** Local Wiki picker; never sends commands or note contents to the model. */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { openNativePath, runNativeCommand } from '@deepseek-ai/dsh-native-command'
import { knowledgeLibraries } from '@deepseek-ai/dsh-tool-fs-search'
import type { TUI } from '@earendil-works/pi-tui'
import { pickFromList } from './overlays.js'

/**
 * Select a configured library, then read its index or open its local entry points.
 * @param ctx - Host context with the optional Wiki tool registration.
 * @param agent - Current session owner used to resolve preset visibility.
 * @param tui - Terminal owning the selection overlays.
 * @returns UI notice text, or undefined when the user cancels.
 */
export async function pickWiki(ctx: Context, agent: Agent, tui: TUI): Promise<string | undefined> {
  const libraries = knowledgeLibraries(ctx, agent)
  if (libraries.length === 0) return 'No Wiki is available in the current preset.'
  const selected = await pickFromList(tui, {
    title: 'Wiki libraries',
    body: 'Arrow keys or number to select; Enter to continue; Esc to cancel.',
    numberKeys: true,
    items: libraries.map((library, index) => ({ value: library.name, label: `${index + 1}. ${library.name}`, description: library.root })),
  })
  if (selected === undefined) return
  // Resolve again after selection, since a preset or plugin can change while the picker is open.
  const library = knowledgeLibraries(ctx, agent).find(item => item.name === selected)
  if (library === undefined) throw new Error('Wiki is no longer available in the current preset.')
  const action = await pickFromList(tui, {
    title: `Wiki · ${library.name}`,
    body: `${library.root}\nArrow keys or number to select; Enter to open; Esc to cancel.`,
    numberKeys: true,
    items: [
      { value: 'index', label: '1. View index', description: 'Show titles and links from INDEX.md in the TUI' },
      { value: 'obsidian', label: '2. Open in Obsidian', description: 'Open INDEX.md with obsidian://' },
      { value: 'folder', label: '3. Open folder', description: 'Open this Wiki directory in the file manager' },
    ],
  })
  if (action === undefined) return
  const current = knowledgeLibraries(ctx, agent).find(item => item.name === library.name)
  if (current?.root !== library.root || current.index !== library.index) {
    throw new Error('Wiki changed while the picker was open; run /wiki again.')
  }
  if (action === 'index') return `${library.name} · ${library.index}\n\n${await readFile(library.index, 'utf8')}`
  const signal = AbortSignal.timeout(15_000)
  if (action === 'folder') {
    await openNativePath(library.root, signal)
    return `Opened Wiki folder: ${library.root}`
  }
  const uri = `obsidian://open?path=${encodeURIComponent(library.index)}`
  try {
    if (process.platform === 'win32') {
      await runNativeCommand('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${uri.replace(/'/g, "''")}'`], signal)
    } else {
      await runNativeCommand(process.platform === 'darwin' ? 'open' : 'xdg-open', [uri], signal)
    }
  } catch (error) {
    throw new Error(`Could not open Obsidian. Install Obsidian and register this folder as a vault: ${library.root}. ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  return `Opened in Obsidian: ${library.index}`
}
