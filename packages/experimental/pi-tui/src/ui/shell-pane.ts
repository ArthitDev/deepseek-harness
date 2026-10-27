/**
 * Embedded right-pane shell: a live PTY session rendered inside the split
 * layout, mirroring the old overlay's session semantics (named owner-scoped
 * sessions the model's `terminal_*` tools address).
 *
 * @module shell-pane
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

/** Which registered PTY backend the pane drives. */
export type ShellVariant = 'win' | 'kali'

/** Backend registry type for each variant (terminal-bash rows in the bundle). */
export const SHELL_BACKEND_TYPES: Record<ShellVariant, string> = { win: 'shell', kali: 'kali' }

/** Owner-local session names, also how the model's terminal tools find the shared shell. */
export const SHELL_SESSION_NAMES: Record<ShellVariant, string> = { win: 'shared-win', kali: 'shared-kali' }

/** Bounded tail of retained output rendered above the input line. */
const PANE_OUTPUT_LINES = 22

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

/** The pane's resolved PTY session identity plus the send/read surface. */
export interface ShellPaneSession {
  readonly id: TerminalSessionId
  readonly terminals: TerminalServiceLike
  readonly owner: Agent
}

/**
 * Resolve (or spawn) the named shared session for one variant.
 * @param ctx - host context carrying the PTY service.
 * @param agent - the live agent that owns the session.
 * @param variant - `win` for the Windows backend, `kali` for the WSL distro.
 * @returns the session handle the pane streams through.
 */
export async function resolveShellSession(ctx: Context, agent: Agent, variant: ShellVariant): Promise<ShellPaneSession> {
  const terminals = ctx.get('terminals') as TerminalServiceLike | undefined
  if (terminals === undefined) {
    throw new Error('shell: the PTY service is not mounted in this profile')
  }
  const backendType = SHELL_BACKEND_TYPES[variant]
  if (!terminals.listBackends().includes(backendType)) {
    throw new Error(`shell: no "${backendType}" PTY backend is mounted for the ${variant} shell`)
  }
  const sessionName = SHELL_SESSION_NAMES[variant]
  const existing = terminals.list(agent).find(snapshot => snapshot.name === sessionName)
  const sessionId = existing?.sessionId
    ?? (await terminals.spawn(agent, { type: backendType, name: sessionName })).sessionId
  return { id: sessionId, terminals, owner: agent }
}

/**
 * Right-pane shell: output tail above a one-line input. Submitting a line
 * sends it to the PTY and streams the response into the tail. The pane is a
 * layout child — it renders whenever the split layout includes it, and the
 * session survives focus changes and pane closes.
 */
export class ShellPane extends Container {
  /** Render into the pane's fixed-width column (SplitLayout right child). */
  renderColumn(width: number): string[] {
    return super.render(width)
  }

  /** Called when the pane asks to hand focus back (input `/exit`). */
  private readonly onClose: (() => void) | undefined
  readonly editor: Editor
  private readonly session: ShellPaneSession
  private readonly output: Text
  private readonly abort = new AbortController()
  private tail = ''

  /**
   * @param tui - renderer the pane renders through.
   * @param session - the resolved PTY session this pane streams.
   * @param title - pane header text.
   * @param onClose - invoked when the pane asks to close (`/exit` inside it).
   */
  constructor(
    tui: TUI,
    session: ShellPaneSession,
    title: string,
    onClose?: () => void,
  ) {
    super()
    this.onClose = onClose ?? undefined
    this.session = session
    this.output = new Text('', 0, 0)
    this.editor = new Editor(tui, editorTheme, { paddingX: 1 })
    const header = new Text(style.accent(`── ${title} ──`), 0, 0)
    this.addChild(header)
    this.addChild(this.output)
    this.addChild(this.editor)
    this.editor.onSubmit = (line: string): void => {
      if (line.trim().length === 0) return
      if (/^\s*\/(exit|quit)\s*$/i.test(line)) {
        this.requestClose()
        return
      }
      this.editor.setText('')
      void this.send(line)
    }
    this.renderTail()
  }

  /** Ask the screen to close this pane (focus returns to the chat editor). */
  requestClose(): void {
    this.onClose?.()
  }

  /** Render the retained scrollback tail into the output view. */
  renderTail(): void {
    const page = this.session.terminals.read(this.session.owner, this.session.id, { count: PANE_OUTPUT_LINES })
    this.tail = page.text.trimEnd()
    this.output.setText(style.accent(this.tail))
  }

  /** Send one line to the PTY and stream its output into the tail. */
  async send(line: string): Promise<void> {
    try {
      const operation = this.session.terminals.startSend(this.session.owner, this.session.id, {
        text: line, submit: true, signal: this.abort.signal,
      })
      const pump = setInterval(() => {
        const { delta } = operation.readOutput()
        if (delta.length > 0) {
          this.keepTail(delta)
          this.output.setText(style.accent(this.tail))
        }
      }, 80)
      try {
        await operation.done
      } finally {
        clearInterval(pump)
      }
    } catch (error) {
      this.keepTail(`\n[shell error] ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.renderTail()
    }
  }

  private keepTail(text: string): void {
    this.tail = `${this.tail}${text}`.split('\n').slice(-PANE_OUTPUT_LINES).join('\n')
  }
}
