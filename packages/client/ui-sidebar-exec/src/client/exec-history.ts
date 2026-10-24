/**
 * Executed-command history collected from a session's event window.
 *
 * The panel reads the same `SessionEventSource` window the Conversation
 * assembles from, so this module stays presentation-pure: it pairs shell
 * `tool/call` events with their `tool/result` by call id and classifies each
 * command's execution world.
 *
 * @module
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'

/** Which execution world a command ran in. */
export type ExecShell = 'kali' | 'windows'

/** Settlement state of one executed command, paired from its `tool/result`. */
export type ExecStatus = 'ok' | 'error' | 'running'

/** One shell command the agent executed, with its paired result state. */
export interface ExecEntry {
  /** The `tool/call` event sequence; locates the transcript's tool card. */
  readonly seq: number
  /** The tool-call id pairing the call with its result. */
  readonly callId: string
  /** Shell tool that executed the command. */
  readonly tool: string
  /** Execution world: Kali WSL when the command routes through `wsl -d kali`. */
  readonly shell: ExecShell
  /** Executed command text. */
  readonly command: string
  /** Event timestamp in epoch milliseconds. */
  readonly time: number
  /** Settlement from the paired `tool/result`. */
  readonly status: ExecStatus
  /** The paired result's text content; empty while running or when it carried none. */
  readonly result: string
}

/** Model-facing shell tools whose call arguments carry an executed command. */
const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'pwsh', 'bash', 'pwsh-persistent', 'bash-persistent',
])

/** Persistent shell tools whose interaction field, not a one-shot argument, carries the command. */
const PERSISTENT_TOOL_NAMES: ReadonlySet<string> = new Set(['pwsh-persistent', 'bash-persistent'])

/** Argument fields, in probe order, that carry the command text. */
const COMMAND_ARGUMENT_FIELDS = ['command', 'cmd'] as const

/** Matches a Windows→Kali route: `wsl` or `wsl.exe` targeting the kali distro. */
const KALI_ROUTE_PATTERN = /wsl(?:\.exe)?\s+.*-d\s+["']?kali/i

/**
 * Classify one executed command's execution world.
 * @param command - the executed command text.
 * @returns `kali` when the command routes into the kali WSL distro, else `windows`.
 */
export function execShellOf(command: string): ExecShell {
  return KALI_ROUTE_PATTERN.test(command) ? 'kali' : 'windows'
}

/**
 * Extract the executed command text from one shell tool call's raw argument JSON.
 * @param tool - the shell tool name.
 * @param raw - the `tool/call` `arguments` string exactly as the model produced it.
 * @returns the command text, or undefined when the arguments carry none.
 */
export function execCommandOf(tool: string, raw: string): string | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch {
    // Malformed model JSON carries no readable command.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const args = parsed as Record<string, unknown>
  if (PERSISTENT_TOOL_NAMES.has(tool)) {
    const send = args['send']
    if (typeof send === 'string' && send.trim().length > 0) return send
  }
  for (const field of COMMAND_ARGUMENT_FIELDS) {
    const value = args[field]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

/** The paired result's model-facing text: its text blocks, in order. */
function resultText(data: SessionEvent<'tool/result'>['data']): string {
  const parts: string[] = []
  for (const block of data.message.content) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * Collect executed shell commands from one event window, newest first. Each
 * shell `tool/call` pairs with its `tool/result` by call id; a call without a
 * result yet reports `running` with no result text.
 * @param entries - the window's event entries in log order.
 * @returns executed commands, newest first.
 */
export function collectExecHistory(entries: readonly SessionEventLikeEntry[]): ExecEntry[] {
  const results = new Map<string, { readonly isError: boolean; readonly text: string }>()
  for (const entry of entries) {
    if (entry.type !== 'event' || entry.event.type !== 'tool/result') continue
    const data = entry.event.data
    results.set(String(data.message.source.callId), {
      isError: data.message.isError === true,
      text: resultText(data),
    })
  }
  const calls: ExecEntry[] = []
  for (const entry of entries) {
    if (entry.type !== 'event' || entry.event.type !== 'tool/call') continue
    const data = entry.event.data
    if (!SHELL_TOOL_NAMES.has(data.name)) continue
    const command = execCommandOf(data.name, data.arguments)
    if (command === undefined) continue
    const result = results.get(String(data.callId))
    calls.push({
      seq: entry.event.seq,
      callId: String(data.callId),
      tool: data.name,
      shell: execShellOf(command),
      command,
      time: entry.event.time,
      status: result === undefined ? 'running' : result.isError ? 'error' : 'ok',
      result: result === undefined ? '' : result.text,
    })
  }
  return calls.reverse()
}
