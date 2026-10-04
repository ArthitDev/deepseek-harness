/**
 * Startup banner: the Shield Break shield rendered as block characters
 * (~40 columns), plus the product line, session facts, and one-line key
 * hints. Shown on boot and on every session switch.
 */
import chalk from 'chalk'

const BLUE = chalk.hex('#4fc1ff')
const MUTED = chalk.dim

/** The Shield Break mark: a shield with the breaking bolt, half-block art. */
export const SHIELD_ART = [
  '      ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄',
  '   ▄████████████████████████▄',
  '  ████████████████████████████',
  ' ████▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀████',
  ' ████   ▄▄▄▄▄▄▄▄▄▄▄▄▄   ████',
  ' ████  ████████████████  ████',
  ' ████  █████▀▀▀▀▀██████  ████',
  ' ████  ██████   ███████  ████',
  ' ████  █████████ ▀█████  ████',
  ' ████  ███████████▄ ███  ████',
  ' ████  ██████████████▄  ████',
  ' ████   ▀▀▀▀▀▀▀▀▀▀▀▀▀   ████',
  ' ████▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄████',
  '  ▀████████████████████████▀',
  '     ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀',
].join('\n')

export interface BannerInfo {
  cwd?: string
  preset?: string
  model?: string
}

/** Compose the welcome block (pre-colored; the view renders it verbatim). */
export function buildBanner(info: BannerInfo): string {
  const lines: string[] = [
    BLUE(SHIELD_ART),
    '',
    `${BLUE('Shield Break TUI')} · Shield Break Harness Terminal`,
  ]
  const facts: string[] = []
  if (info.model !== undefined) facts.push(`model: ${info.model}`)
  if (info.preset !== undefined) facts.push(`preset: ${info.preset}`)
  if (info.cwd !== undefined) facts.push(`cwd: ${info.cwd}`)
  if (facts.length > 0) lines.push(MUTED(facts.join(' · ')))
  lines.push(MUTED('Esc interrupt · Ctrl+C exit · /hotkeys all keys'))
  return lines.join('\n')
}
