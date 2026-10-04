/**
 * Startup banner: the Shield Break mark — the operator's shield-and-bolt art
 * downsampled to half-block rows with baked truecolor codes (bright-red
 * shield, white bolt). Shown on boot and on every session switch.
 */
import chalk from 'chalk'

const BLUE = chalk.hex('#4fc1ff')
const MUTED = chalk.dim

/** The shield-breakthrough mark: 13 half-block rows, colors baked in. */
export const SHIELD_ART = [
  '      [0m[91m▄[0m[91m▄[0m[91m[91m█[0m[91m[91m█[0m[91m▀[0m[91m▀[0m[91m▀[0m[91m▀[0m[91m▀[0m[91m▀[0m[91m[91m█[0m[91m[91m█[0m[91m▄[0m[91m▄  [0m[91m▄[0m[91m▄[0m[91m[91m█[0m[91m[91m█[0m[91m▀[0m[91m▀[0m[91m▀[0m[91m▀[0m[91m▀[0m[91m▀[0m[91m[91m█[0m[91m[91m█[0m[91m▄[0m[91m▄',
  '    [0m[91m▄[0m[91m[91m█[0m[91m▀          [0m[91m▄[0m[91m▄[0m[91m[91m█[0m[91m[91m█[0m[91m[91m█[0m[91m[91m█[0m[91m▄[0m[91m▄          [0m[91m▀[0m[91m[91m█[0m[91m▄',
  '  [0m[91m▄[0m[91m[91m█[0m[91m▀          [0m[91m▄[0m[91m▀        [0m[91m▀[0m[91m▄          [0m[91m▀[0m[91m[91m█[0m[91m▄',
  '[0m[91m▄[0m[91m[91m█[0m[91m▀          [0m[91m▄[0m[91m▀  [0m[97m▄    [0m[97m▄    [0m[91m▀ [0m[91m▄         [0m[91m▀[0m[91m▀[0m[91m▄[0m[91m▄',
  '[0m[91m[91m█           [0m[91m[91m█       [0m[91m▄[0m[91m▄       [0m[91m[91m█           [0m[91m[91m█',
  '[0m[91m▀[0m[91m[91m█[0m[91m▄          [0m[91m▀[0m[91m▄   [0m[91m▄[0m[91m▀[0m[91m▄[0m[91m▄[0m[91m▀[0m[91m▄   [0m[91m▄[0m[91m▀          [0m[91m▄[0m[91m[91m█[0m[91m▀',
  '  [0m[91m▀[0m[91m[91m█[0m[91m▄          [0m[91m▀[0m[91m▀[0m[91m▀[0m[91m▄[0m[91m▀  [0m[91m▀[0m[91m▄[0m[91m▀[0m[91m▀[0m[91m▀          [0m[91m▄[0m[91m[91m█[0m[91m▀',
  '    [0m[91m▀[0m[91m[91m█[0m[91m▄         [0m[91m▄[0m[91m▀  [0m[91m▄[0m[91m▄  [0m[91m▀[0m[91m▄         [0m[91m▄[0m[91m[91m█[0m[91m▀',
  '      [0m[91m▀[0m[91m[91m█[0m[91m▄            [0m[97m[97m█[0m[97m[97m█         [0m[91m▄[0m[91m[91m█[0m[91m▀',
  '        [0m[91m▀[0m[91m[91m█[0m[91m▄         [0m[97m▄[0m[97m[97m█[0m[97m[97m█[0m[97m▄      [0m[91m▄[0m[91m[91m█[0m[91m▀',
  '          [0m[91m▀[0m[91m[91m█[0m[91m▄     [0m[97m▄[0m[97m▀ [0m[97m[97m█[0m[97m[97m█ [0m[97m▀[0m[97m▄  [0m[91m▄[0m[91m[91m█[0m[91m▀',
  '                  [0m[97m▀[0m[97m▄ [0m[97m[97m█[0m[97m[97m█ [0m[97m▄[0m[97m▀',
  '                    [0m[97m▀[0m[97m[97m█[0m[97m[97m█[0m[97m▀',
].join('\n')

export interface BannerInfo {
  cwd?: string
  preset?: string
  model?: string
}

/** Compose the welcome block (pre-colored; the view renders it verbatim). */
export function buildBanner(info: BannerInfo): string {
  const lines: string[] = [
    SHIELD_ART,
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
