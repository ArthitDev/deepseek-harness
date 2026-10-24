/**
 * Interactive shared-shell overlay: the operator drives the same owner-scoped
 * PTY sessions the model's `terminal_*` tools address, so one shell accepts
 * commands from both the agent and the person at the keyboard.
 *
 * @module shell-overlay
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  TerminalSendOperation,
  TerminalSessionId,
  TerminalSessionSnapshot,
} from '@deepseek-ai/dsh-terminal'
import { Container, Editor, Text, type TUI } from '@earendil-works/pi-tui'
import { editorTheme, style } from './theme.js'

/** Which registered PTY backend the overlay drives. */
export type ShellVariant = 'win' | 'kali'

/** Backend registry type for each variant (terminal-bash rows in the bundle). */
const BACKEND_TYPES: Record<ShellVariant, string> = { win: 'shell', kali: 'kali' }

/** Owner-local session names, also how the model's terminal tools find the shared shell. */
export const SHELL_SESSION_NAMES: Record<ShellVariant, string> = { win: 'shared-win', kali: 'shared-kali' }

/** Bounded tail of retained output rendered above the input line. */
const SHELL_VIEW_LINES = 24

interface TerminalServiceLike {
  listBackends(): string[]
  list(owner: Agent): TerminalSessionSnapshot[]
  spawn(
    owner: Agent,
    request: { type: string; name?: string; cwd?: string },
    signal?: AbortSignal,
  ): Promise<{ sessionId: TerminalSessionId; motd: string }>
  startSend(owner: Agent, id: TerminalSessionId, request: { text: string; submit: boolean; signal?: AbortSignal }): TerminalSendOperation
  read(owner: Agent, id: TerminalSessionId, request?: { offset?: number; count?: number }): { text: string; totalLines: number }
}

/** Overlay root that forwards typing to the editor and closes on Esc. */
class ShellOverlay extends Container {
  constructor(
    private readonly editor: Editor,
    private readonly close: () => void,
  ) {
    super()
  }

  handleInput(data: string): void {
    // The raw escape byte closes the overlay; escape sequences (arrow keys)
    // still reach the editor.
    if (data === '\x1b') {
      this.close()
      return
    }
    this.editor.handleInput(data)
  }
}

/**
 * Open the shared-shell overlay for one variant. A session named for the
 * variant is reused when this agent already owns one, else spawned; typing a
 * line and pressing Enter submits it to the PTY and streams the response into
 * the view. Esc closes the overlay and leaves the session running, so the
 * agent's `terminal_*` tools keep addressing the same shell.
 * @param tui - renderer the overlay mounts on.
 * @param ctx - host context carrying the PTY service.
 * @param agent - the live agent that owns the session.
 * @param variant - `win` for the Windows shell backend, `kali` for the WSL distro.
 * @param signal - cancellation closing the overlay.
 * @returns resolves once the overlay is closed.
 */
export async function openShellOverlay(
  tui: TUI,
  ctx: Context,
  agent: Agent,
  variant: ShellVariant,
  signal: AbortSignal,
): Promise<void> {
  const terminals = ctx.get('terminals') as TerminalServiceLike | undefined
  if (terminals === undefined) {
    throw new Error('shell: the PTY service is not mounted in this profile')
  }
  const backendType = BACKEND_TYPES[variant]
  if (!terminals.listBackends().includes(backendType)) {
    throw new Error(`shell: no "${backendType}" PTY backend is mounted for the ${variant} shell`)
  }
  const sessionName = SHELL_SESSION_NAMES[variant]
  const existing = terminals.list(agent).find(snapshot => snapshot.name === sessionName)
  const sessionId: TerminalSessionId = existing?.sessionId
    ?? (await terminals.spawn(agent, { type: backendType, name: sessionName }, signal)).sessionId

  const output = new Text('', 0, 0)
  const editor = new Editor(tui, editorTheme, { paddingX: 1 })
  const abort = new AbortController()
  const container = new ShellOverlay(editor, () => close())
  container.addChild(output)
  container.addChild(editor)
  const handle = tui.showOverlay(container, { width: '90%', maxHeight: '80%' })

  let closed = false
  let tail = ''
  const close = (): void => {
    if (closed) return
    closed = true
    handle.hide()
    abort.abort()
  }
  signal.addEventListener('abort', close, { once: true })

  const draw = (): void => {
    output.setText(style.accent(tail))
    tui.requestRender()
  }
  const keepTail = (text: string): void => {
    tail = `${tail}${text}`.split('\n').slice(-SHELL_VIEW_LINES).join('\n')
  }
  const renderTail = (): void => {
    const page = terminals.read(agent, sessionId, { count: SHELL_VIEW_LINES })
    tail = page.text.trimEnd()
    draw()
  }
  renderTail()

  editor.onSubmit = (line: string): void => {
    if (line.trim().length === 0) return
    if (/^\s*\/(exit|quit)\s*$/i.test(line)) {
      close()
      return
    }
    editor.setText('')
    void (async () => {
      try {
        const operation = terminals.startSend(agent, sessionId, { text: line, submit: true, signal: abort.signal })
        const pump = setInterval(() => {
          const { delta } = operation.readOutput()
          if (delta.length > 0) {
            keepTail(delta)
            draw()
          }
        }, 80)
        try {
          await operation.done
        } finally {
          clearInterval(pump)
        }
      } catch (error) {
        if (!closed) {
          keepTail(`\n[shell error] ${error instanceof Error ? error.message : String(error)}`)
          draw()
        }
      } finally {
        if (!closed) renderTail()
      }
    })()
  }
  tui.requestRender()
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (closed) {
        clearInterval(check)
        resolve()
      }
    }, 100)
  })
}
