/**
 * Pure key-semantics helpers, unit-testable without a terminal.
 *
 * The Ctrl+C state machine mirrors the pi / Claude Code convention:
 * running → interrupt; idle with editor text → clear; idle empty → arm,
 * and a second press inside the window exits.
 */
export type CtrlCAction = 'cancel' | 'clear' | 'arm' | 'exit'

/** Ctrl+C exit-arm state: ms timestamp of the press that opened the exit window, 0 when disarmed. */
export interface ExitArm {
  lastPressAt: number
}

/**
 * Resolve the next Ctrl+C action and successor state: running cancels,
 * editor text clears and re-arms, a press within 500ms of an armed press exits.
 * @param state - Current exit-arm state.
 * @param working - Whether an agent turn is running.
 * @param editorHasText - Whether the editor holds text.
 * @param now - Current ms timestamp, compared against `state.lastPressAt`.
 * @returns The action, the successor state, and whether the exit window is left armed.
 */
export function ctrlC(
  state: ExitArm,
  working: boolean,
  editorHasText: boolean,
  now: number,
): { action: CtrlCAction; state: ExitArm; arm: boolean } {
  if (working) return { action: 'cancel', state, arm: false }
  if (editorHasText) {
    // Clearing also arms the timer (pi semantics): the next press inside
    // the window exits.
    return { action: 'clear', state: { lastPressAt: now }, arm: true }
  }
  if (now - state.lastPressAt < 500) {
    return { action: 'exit', state: { lastPressAt: 0 }, arm: false }
  }
  return { action: 'arm', state: { lastPressAt: now }, arm: true }
}

/**
 * Split a slash line into its lower-case command name and raw input.
 * @param line - Editor line; parsed only when it starts with `/`.
 * @returns The lower-case command name and the raw text after it (empty when there are no arguments), or undefined without the `/` prefix.
 */
export function parseSlash(line: string): { name: string; raw: string } | undefined {
  if (!line.startsWith('/')) return undefined
  const rest = line.slice(1)
  const space = rest.search(/\s/)
  if (space === -1) return { name: rest.toLowerCase(), raw: '' }
  return { name: rest.slice(0, space).toLowerCase(), raw: rest.slice(space) }
}

/**
 * Whether Tab path completion should offer for this token (Tab-restraint
 * option B): only tokens that already look like a path or a mention.
 * @param token - Editor token under the cursor.
 * @returns True when the token starts with `@`, `.`, or `~` or contains `/` or `.`.
 */
export function isPathLikeToken(token: string): boolean {
  return (
    token.startsWith('@') ||
    token.startsWith('.') ||
    token.startsWith('~') ||
    token.includes('/') ||
    token.includes('.')
  )
}

/**
 * Parse a bang line: `!cmd` (output joins context) / `!!cmd` (excluded).
 * @param line - Editor line; parsed only when it starts with `!`.
 * @returns The trimmed command and whether its output stays out of context, or undefined without a `!` prefix or with an empty command.
 */
export function parseBang(line: string): { command: string; excluded: boolean } | undefined {
  if (!line.startsWith('!')) return undefined
  const excluded = line.startsWith('!!')
  const command = excluded ? line.slice(2).trim() : line.slice(1).trim()
  if (command === '') return undefined
  return { command, excluded }
}
