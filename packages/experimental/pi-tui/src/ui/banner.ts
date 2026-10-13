/**
 * Startup banner: the red Shield Break product line, session facts, and key
 * hints. Shown on boot and on every session switch.
 */
import chalk from 'chalk'
import { BRAND_RED } from './theme.ts'

const MUTED = chalk.dim
const BOLD_RED = chalk.hex(BRAND_RED).bold

/** Shield glyph + letter-spaced wordmark, brand-red on boot. */
const LOGO = `⧉  ${'SHIELD BREAK AGENT'.split('').join(' ')}`

export interface BannerInfo {
  /** The running TUI release, rendered in parentheses after the product name. */
  version?: string
  cwd?: string
  preset?: string
  model?: string
}

/** Compose the welcome block (pre-colored; the view renders it verbatim). */
export function buildBanner(info: BannerInfo): string {
  const version = info.version === undefined ? '' : ` v${info.version}`
  const lines: string[] = [BOLD_RED(LOGO)]
  if (version !== '') lines.push(MUTED(version.trim()))
  const facts: string[] = []
  if (info.model !== undefined) facts.push(`model: ${info.model}`)
  if (info.preset !== undefined) facts.push(`preset: ${info.preset}`)
  if (info.cwd !== undefined) facts.push(`cwd: ${info.cwd}`)
  if (facts.length > 0) lines.push(MUTED(facts.join(' · ')))
  lines.push(MUTED('Esc interrupt · Ctrl+C exit · /hotkeys all keys'))
  return lines.join('\n')
}
