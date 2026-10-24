/**
 * Executed-command history collected from a session's durable tool events.
 *
 * @module exec-history
 */

/** Which execution world a command ran in. */
export type ExecShell = 'kali' | 'windows'

/** Settlement state of one executed command. */
export type ExecStatus = 'ok' | 'error' | 'running'

/** One shell command the agent executed. */
export interface ExecEntry {
  /** The `tool/call` event sequence; locates the transcript's tool card. */
  readonly seq: number
  /** The tool-call id pairing the call with its result. */
  readonly callId: string
  /** Shell tool that executed the command. */
  readonly tool: string
  /** Execution world: Kali WSL when the command routes through wsl -d kali. */
  readonly shell: ExecShell
  /** Executed command text. */
  readonly command: string
  /** Event timestamp in epoch milliseconds. */
  readonly time: number
  /** Settlement from the paired `tool/result`. */
  readonly status: ExecStatus
}

/** Model-facing shell tools whose call arguments carry an executed command. */
const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'pwsh',
  'bash',
  'pwsh-persistent',
  'bash-persistent',
])

/** Argument fields, in probe order, that carry the command text. */
const COMMAND_ARGUMENT_FIELDS = ['command', 'cmd', 'script'] as const

/** Matches a Windows→Kali route: `wsl`, `wsl.exe`, or `wsl -d kali-linux`. */
const KALI_ROUTE_PATTERN = /(?:^|[&;|]\s*|\b)wsl(?:\.exe)?\s+(?:-[a-z]\s+\S+\s+)*-d\s+["']?kali/i

/**
 * Classify one executed command's execution world.
 * @param command - the executed command text.
 * @returns `kali` when the command routes into the kali WSL distro, else `windows`.
 */
export function execShellOf(command: string): ExecShell {
  return KALI_ROUTE_PATTERN.test(command) ? 'kali' : 'windows'
}

/**
 * Extract the executed command text from one shell tool call's arguments.
 * @param tool - the shell tool name.
 * @param args - the parsed call arguments.
 * @returns the command text, or undefined when the arguments carry none.
 */
export function execCommandOf(tool: string, args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>
  if (tool === 'pwsh-persistent' || tool === 'bash-persistent') {
    const send = record.send
    if (typeof send === 'string' && send.trim().length > 0) return send
  }
  for (const field of COMMAND_ARGUMENT_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

/**
 * Collect executed shell commands from a session's durable events, oldest
 * first. The result pairs each shell `tool/call` with its `tool/result` by
 * call id; calls without a result yet report `running`.
 * @param events - the session's durable events in log order.
 * @returns executed commands in chronological order.
 */
export function collectExecHistory(events: readonly { type: string; seq: number; time: number; data: unknown }[]): ExecEntry[] {
  const results = new Map<string, { isError: boolean }>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const data = event.data as { callId?: string; isError?: boolean }
    if (typeof data.callId === 'string') results.set(data.callId, { isError: data.isError === true })
  }
  const entries: ExecEntry[] = []
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const data = event.data as { callId?: string; name?: string; arguments?: unknown }
    const tool = data.name
    const callId = data.callId
    if (tool === undefined || callId === undefined || !SHELL_TOOL_NAMES.has(tool)) continue
    const command = execCommandOf(tool, data.arguments)
    if (command === undefined) continue
    const result = results.get(callId)
    entries.push({
      seq: event.seq,
      callId,
      tool,
      shell: execShellOf(command),
      command,
      time: event.time,
      status: result === undefined ? 'running' : result.isError ? 'error' : 'ok',
    })
  }
  return entries
}
