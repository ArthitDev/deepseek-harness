/**
 * App argument parsing over `ctx.cmdlineArgs.get()`.
 *
 * `dsh --profile pi-tui --resume <id>` hands `['--resume', '<id>']` to the
 * booted profile; the launcher consumes its own flags first.
 */
export interface PiTuiArgs {
  /** Session id to resume (from `--resume <id>`). */
  resumeId?: string
  /** `--resume` without a value: pick from the persisted-session list. */
  pickSession: boolean
  /** Agent preset id (from `--preset <id>`). */
  preset?: string
  /** `--preset` without a value: pick from the preset roster. */
  pickPreset: boolean
  /** Saved remote machine id (from `--machine <id>`): new sessions run on it. */
  machine?: string
  /** Leading positional directory: the session working directory (e.g. `.`). */
  cwd?: string
  /** `--help` / `-h`: print usage and exit. */
  help: boolean
  /** Unrecognized positional/flags, reported as a usage error. */
  unknown: string[]
}

/**
 * Parse the launcher's argument tokens. `--resume`/`-r` and `--preset`/`-p`
 * consume a following non-flag value and, when bare, become their
 * pick-from-a-list flag (`pickSession`/`pickPreset`); a valueless `--machine`
 * lands in `unknown`. The first unconsumed positional is the session working
 * directory; further positionals land in `unknown`.
 * @param argv - the raw tokens handed to the booted profile.
 * @returns the parsed flags, with `unknown` carrying unrecognized tokens.
 */
export function parseArgs(argv: readonly string[]): PiTuiArgs {
  const args: PiTuiArgs = { pickSession: false, pickPreset: false, help: false, unknown: [] }
  let skipValue = false
  for (const [index, token] of argv.entries()) {
    if (skipValue) {
      skipValue = false
      continue
    }
    if (token === '--resume' || token === '-r') {
      const value = argv[index + 1]
      if (value !== undefined && !value.startsWith('-')) {
        args.resumeId = value
        skipValue = true
      } else {
        args.pickSession = true
      }
      continue
    }
    if (token === '--preset' || token === '-p') {
      const value = argv[index + 1]
      if (value !== undefined && !value.startsWith('-')) {
        args.preset = value
        skipValue = true
      } else {
        args.pickPreset = true
      }
      continue
    }
    if (token === '--machine') {
      const value = argv[index + 1]
      if (value !== undefined && !value.startsWith('-')) {
        args.machine = value
        skipValue = true
      } else {
        args.unknown.push(token)
      }
      continue
    }
    if (token === '--help' || token === '-h') {
      args.help = true
      continue
    }
    if (!token.startsWith('-') && args.cwd === undefined) {
      args.cwd = token
      continue
    }
    args.unknown.push(token)
  }
  return args
}

/** The `--help` text: usage lines, key table, and slash-command reference. */
export const USAGE = `Shield Break TUI — terminal front door for Shield Break Harness

Usage:
  dsh tui [cwd]                      start a fresh session in the directory
  dsh tui [cwd] --resume <id>        reopen a persisted session
  dsh tui --resume                   pick a persisted session from a list
  dsh tui --preset <id>              choose an agent preset
  dsh tui --preset                   pick a preset from the roster
  dsh tui --machine <id>             run the session on a saved SSH machine
  dsh tui --help                     this help

Keys:
  Esc        interrupt · cancel autocomplete · exit card browse
  Ctrl+C     running→interrupt · text→clear · empty→again exits
  Ctrl+D     exit when the editor is empty
  Ctrl+T     toggle thinking display
  Ctrl+O     toggle full tool output
  Ctrl+F     find in transcript · Alt+C copy last assistant
  Ctrl+L     model picker · Ctrl+X reasoning picker
  Ctrl+R     search message history · Shift+Tab cycle mode
  Ctrl+Z     suspend to background
  Ctrl+G     edit input in $EDITOR
  Tab        complete paths · / slash commands · @ attach files
             (empty editor: cycle tool-card focus · Enter expand)

Commands:
  /exit                   exit and show the session resume command
  /new                    start a fresh session
  /fork                   fork this session at its current end
  /resume [query]         list sessions / reopen one
  /tree                   subagent session tree
  /model [query]          switch model (picker without a query)
  /thinking [level]       choose reasoning level (next step)
  /suppress-prompt [on|off|toggle|status]   choose prompt suppression (ON/OFF picker)
  /mcp [on|off|toggle|status]   list MCP servers or control all MCP tools
  /jev [on|off|toggle|status]   enable or disable JEV tools and policy context
  /team-mode [blue|red|black|dead]   choose the team mode (numbered picker)
  /skills [on|off|toggle|status]   list and toggle skills or control them all
  /agents                 list live subagents
  /jobs                   list background jobs
  /export                 write this transcript to a markdown file
  /rename <title>         rename this session
  /copy last|tool|error|id|resume   copy to clipboard
  /retry                  re-send the last prompt after a failure
  /expand-all             toggle folding of old messages
  /hotkeys                this key table
  /key [ref]              save a provider credential (masked entry)
  /provider               register a custom endpoint + key + model list
  /memory [global]        edit AGENTS.md (project or harness-home) in   /sessions [delete <id>] list or permanently delete persisted sessions
  /rewind or Esc Esc     rewind to an earlier prompt and resend it
  /preset-create          create a new preset from pasted text
  /clear                  clear the conversation (same session, fresh context)
  /queue [remove <id>|clear]   manage messages queued while busy
  /providers              list provider routes, model counts, and key state
  /compact /goal /plan /feedback   official dsh commands`
