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
  /** `--help` / `-h`: print usage and exit. */
  help: boolean
  /** Unrecognized positional/flags, reported as a usage error. */
  unknown: string[]
}

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
    args.unknown.push(token)
  }
  return args
}

export const USAGE = `Shield Break TUI — terminal front door for Shield Break Harness

Usage:
  dsh --profile pi-tui                 start a fresh session
  dsh --profile pi-tui --resume <id>   reopen a persisted session
  dsh --profile pi-tui --resume        pick a persisted session from a list
  dsh --profile pi-tui --preset <id>   choose an agent preset (standard/minimal/code…)
  dsh --profile pi-tui --preset        pick a preset from the roster
  dsh --profile pi-tui --machine <id>  run the session on a saved SSH machine
  dsh --profile pi-tui --help          this help

Keys:
  Esc        interrupt · cancel autocomplete · exit card browse
  Ctrl+C     running→interrupt · text→clear · empty→again exits
  Ctrl+D     exit when the editor is empty
  Ctrl+T     toggle thinking display
  Ctrl+O     toggle full tool output
  Ctrl+F     find in transcript · Alt+C copy last assistant
  Ctrl+L     model picker · Ctrl+X cycle thinking
  Ctrl+R     search message history · Shift+Tab cycle mode
  Ctrl+Z     suspend to background
  Ctrl+G     edit input in $EDITOR
  Tab        complete paths · / slash commands · @ attach files
             (empty editor: cycle tool-card focus · Enter expand)

Commands:
  /new                    start a fresh session
  /fork                   fork this session at its current end
  /resume [query]         list sessions / reopen one
  /tree                   subagent session tree
  /model [query]          switch model (picker without a query)
  /thinking off|high|max  set thinking effort (next step)
  /skills                 list user-invocable skills
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
  /clear                  clear the conversation (same session, fresh context)
  /compact /goal /plan /feedback   official dsh commands`
