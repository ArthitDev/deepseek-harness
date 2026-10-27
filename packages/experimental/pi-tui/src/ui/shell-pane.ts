/**
 * Native right-pane shell: a live PTY session mounted in the screen's split
 * layout, mirroring the overlay's session semantics (named owner-scoped
 * sessions the model's `terminal_*` tools address). The pane streams output
 * by polling the PTY scrollback, so commands the AGENT runs in the shared
 * session appear here too — not only lines the operator types.
 *
 * @module shell-pane
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  TerminalReadResult,
  TerminalSendOperation,
  TerminalSessionId,
  TerminalSessionSnapshot,
} from '@deepseek-ai/dsh-terminal'
import { Editor, ScrollView, Text, VStack, type TUI } from '@earendil-works/pi-tui'
import { editorTheme, style } from './theme.js'

/** Which registered PTY backend the pane drives. */
export type ShellVariant = 'win' | 'kali'

/** Backend registry type for each variant (terminal-bash rows in the bundle). */
export const SHELL_BACKEND_TYPES: Record<ShellVariant, string> = { win: 'shell', kali: 'kali' }

/** Owner-local session names, also how the model's terminal tools find the shared shell. */
export const SHELL_SESSION_NAMES: Record<ShellVariant, string> = { win: 'shared-win', kali: 'shared-kali' }

/** Bounded tail of retained output rendered above the input line. */
const PANE_OUTPUT_LINES = 22

/** How often the pane re-reads PTY scrollback while it is mounted. */
export const PANE_POLL_MS = 250

interface TerminalServiceLike {
  listBackends(): string[]
  list(owner: Agent): TerminalSessionSnapshot[]
  spawn(
    owner: Agent,
    request: { type: string; name?: string; cwd?: string },
    signal?: AbortSignal,
  ): Promise<{ sessionId: TerminalSessionId; motd: string }>
  startSend(owner: Agent, id: TerminalSessionId, request: { text: string; submit: boolean; signal?: AbortSignal }): TerminalSendOperation
  read(owner: Agent, id: TerminalSessionId, request?: { offset?: number; count?: number }): TerminalReadResult
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
    throw new Error('the PTY service is not mounted in this profile')
  }
  const backendType = SHELL_BACKEND_TYPES[variant]
  if (!terminals.listBackends().includes(backendType)) {
    throw new Error(`no "${backendType}" PTY backend is mounted for the ${variant} shell`)
  }
  const sessionName = SHELL_SESSION_NAMES[variant]
  const existing = terminals.list(agent).find(snapshot => snapshot.name === sessionName)
  const sessionId = existing?.sessionId
    ?? (await terminals.spawn(agent, { type: backendType, name: sessionName })).sessionId
  return { id: sessionId, terminals, owner: agent }
}

/**
 * Right-pane shell: scrolling output above a bottom-pinned input. Submitting a line
 * sends it to the PTY and streams the response into the tail; a poll timer
 * re-reads the scrollback so every writer to the shared session (operator or
 * agent) is rendered live. The pane is a layout child — it renders whenever
 * the split layout includes it, and the session survives focus changes and
 * pane closes.
 */
export class ShellPane extends VStack {
  /** The PTY backend family this pane currently streams. */
  variant: ShellVariant
  /** The bottom-pinned input the operator submits commands through. */
  readonly editor: Editor
  private readonly tui: TUI
  private readonly output: Text
  private readonly header: Text
  private readonly prompt = new Text('', 0, 0)
  private promptText = ''
  private session: ShellPaneSession
  private title: string
  private readonly onClose: (() => void) | undefined
  private readonly abort = new AbortController()
  private focused = false
  private tail = ''
  private pollTimer: NodeJS.Timeout | undefined

  /**
   * @param tui - renderer the pane renders through and schedules redraws on.
   * @param session - the resolved PTY session this pane streams.
   * @param variant - which backend family the session belongs to.
   * @param title - pane header text.
   * @param onClose - invoked when the pane asks to close (`/exit` inside it).
   * @param bottomRows - reserved rows below the input, matching the chat status bar.
   */
  constructor(
    tui: TUI,
    session: ShellPaneSession,
    variant: ShellVariant,
    title: string,
    onClose?: () => void,
    bottomRows: (width: number) => number = () => 0,
  ) {
    super()
    this.tui = tui
    this.session = session
    this.variant = variant
    this.title = title
    this.onClose = onClose ?? undefined
    this.output = new Text('', 0, 0)
    this.header = new Text('', 0, 0)
    this.editor = new Editor(tui, editorTheme, { paddingX: 1 })
    this.addChild(this.header, { basis: 'auto' })
    this.addChild(new ScrollView(this.output, { follow: 'end', overscroll: 'contain' }), { basis: 0, grow: 1, minSize: 1 })
    this.addChild(new VStack([
      this.prompt,
      this.editor,
      { invalidate: () => {}, render: width => Array.from({ length: bottomRows(width) }, () => '') },
    ]), { basis: 'auto', shrink: 1, minSize: 1 })
    this.editor.onSubmit = (line: string): void => {
      if (line.trim().length === 0) return
      if (/^\s*\/(exit|quit)\s*$/i.test(line)) {
        this.requestClose()
        return
      }
      this.editor.setText('')
      void this.send(line)
    }
    this.renderHeader()
    this.renderTail()
    this.startPolling()
  }

  /**
   * The pane header title (re-derived on rebind).
   * @returns the current header title text.
   */
  getTitle(): string {
    return this.title
  }

  /** Ask the screen to close this pane (focus returns to the chat editor). */
  requestClose(): void {
    this.onClose?.()
  }

  /**
   * Whether keyboard focus currently lives in this pane.
   * @returns true while the pane is the focused component's owner.
   */
  isFocused(): boolean {
    return this.focused
  }

  /**
   * Restyle the header for the gained or lost keyboard focus.
   * @param focused - whether keyboard focus now lives in the pane.
   */
  setFocused(focused: boolean): void {
    if (this.focused === focused) return
    this.focused = focused
    this.renderHeader()
  }

  /**
   * Point the pane at another resolved session (the `/shell win|kali` variant
   * switch): the layout position, editor, and poll loop carry over.
   * @param session - the newly resolved PTY session to stream.
   * @param variant - the backend family the new session belongs to.
   * @param title - the replacement header title.
   * @throws if the editor contains unsubmitted input.
   */
  rebind(session: ShellPaneSession, variant: ShellVariant, title: string): void {
    if (this.editor.getText() !== '') throw new Error('shell input is not empty; review or clear it before switching backends')
    this.session = session
    this.variant = variant
    this.title = title
    this.tail = ''
    this.promptText = ''
    this.renderHeader()
    this.renderTail()
  }

  /** Stop the poll loop and cancel an in-flight send; the PTY session stays. */
  dispose(): void {
    this.stopPolling()
    this.abort.abort()
  }

  /**
   * Fill an empty editor for human review without sending input to the PTY.
   * @param command - command text to review and submit manually.
   * @throws if the input is occupied or the command is empty or contains terminal controls.
   */
  stageCommand(command: string): void {
    if (command.trim().length === 0 || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(command)) {
      throw new Error('draft command must contain text without terminal control characters')
    }
    if (this.editor.getText() !== '') throw new Error('shell input is not empty; review or clear it before staging another draft')
    this.editor.setText(command)
    this.tui.requestRender()
  }

  /** Re-read the retained scrollback into the output view. */
  renderTail(): void {
    try {
      this.renderPage(this.session.terminals.read(this.session.owner, this.session.id, { count: PANE_OUTPUT_LINES }))
    } catch {
      // A dying owner session keeps the last painted tail; polling stops.
      this.stopPolling()
    }
  }

  /**
   * Send one line to the PTY and stream its output into the tail.
   * @param line - the command text to submit.
   */
  async send(line: string): Promise<void> {
    try {
      const operation = this.session.terminals.startSend(this.session.owner, this.session.id, {
        text: line, submit: true, signal: this.abort.signal,
      })
      const pump = setInterval(() => {
        const { delta } = operation.readOutput()
        if (delta.length > 0) this.renderTail()
      }, 80)
      try {
        await operation.done
      } finally {
        clearInterval(pump)
      }
    } catch (error) {
      this.appendTail(`\n[shell error] ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.renderTail()
    }
  }

  private startPolling(): void {
    if (this.pollTimer !== undefined) return
    this.pollTimer = setInterval(() => {
      if (this.abort.signal.aborted) {
        this.stopPolling()
        return
      }
      let page: TerminalReadResult
      try {
        page = this.session.terminals.read(this.session.owner, this.session.id, { count: PANE_OUTPUT_LINES })
      } catch {
        this.stopPolling()
        return
      }
      if (page.text.trimEnd() === this.tail) return
      this.renderPage(page)
    }, PANE_POLL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer === undefined) return
    clearInterval(this.pollTimer)
    this.pollTimer = undefined
  }

  private renderPage(page: TerminalReadResult): void {
    this.tail = page.text.trimEnd()
    this.renderOutput()
  }

  private appendTail(text: string): void {
    this.tail = `${this.tail}${text}`.split('\n').slice(-PANE_OUTPUT_LINES).join('\n')
    this.renderOutput()
  }

  private renderOutput(): void {
    let output = this.tail
    if (this.variant === 'kali') {
      const prompt = [...this.tail.matchAll(/^┌?──\([^\n]*㉿[^\n]*\)-\[[^\n]*\]\n└─[#$] ?/gm)].at(-1)
      if (prompt !== undefined) {
        this.promptText = prompt[0].trimEnd()
        if (this.tail.slice(prompt.index + prompt[0].length).trim() === '') {
          output = this.tail.slice(0, prompt.index).trimEnd()
        }
      }
      this.prompt.setText(style.accent(this.promptText || 'kali ❯'))
    } else {
      this.prompt.setText('')
    }
    this.output.setText(style.accent(output))
    this.tui.requestRender()
  }

  private renderHeader(): void {
    const mark = this.focused ? '▾' : '▸'
    this.header.setText(this.focused
      ? style.accent(`── ${mark} ${this.title} · Esc to chat ──`)
      : style.muted(`── ${mark} ${this.title} · Ctrl+P focus ──`))
  }
}
