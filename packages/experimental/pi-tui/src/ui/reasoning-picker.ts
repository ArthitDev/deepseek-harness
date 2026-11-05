/** Numbered reasoning-level picker over the selected model's advertised capabilities. */
import chalk from 'chalk'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { TUI } from '@earendil-works/pi-tui'
import { pickFromList } from './overlays.js'
import { BRAND_RED, selectListTheme, style } from './theme.js'

const descriptions: Readonly<Record<string, string>> = {
  off: 'Disable optional thinking',
  minimal: 'Use the least reasoning',
  low: 'Faster responses with lighter reasoning',
  medium: 'Balance speed and reasoning depth',
  high: 'More reasoning for complex tasks',
  xhigh: 'Extra reasoning for demanding tasks',
  max: 'Highest available effort; may take longer',
}

/**
 * Show only supported levels, focusing the current selection or configured default.
 * @param tui - live terminal UI hosting the overlay.
 * @param model - exact-route metadata, including supported efforts and any configured default.
 * @param current - selected effort; an unsupported value is not marked as current.
 * @returns the selected effort id, or undefined on cancellation or absent controls.
 */
export function pickReasoningLevel(
  tui: TUI,
  model: LlmResolvedModelInfo,
  current?: string,
): Promise<string | undefined> {
  const efforts = model.reasoning?.efforts ?? []
  if (efforts.length === 0) return Promise.resolve(undefined)
  const defaultEffort = model.reasoning?.defaultEffort
  const active = current ?? defaultEffort
  const binary = efforts.filter(effort => effort.id !== 'off').length === 1
    && efforts.some(effort => effort.id === 'off')
  const initial = efforts.some(effort => effort.id === active) ? active : defaultEffort
  return pickFromList(tui, {
    title: `Select Reasoning Level for ${model.name || model.id}`,
    body: '\n' + style.muted('↑/↓ choose · number jump · Enter apply · Esc cancel') + '\n',
    ...(initial === undefined ? {} : { initial }),
    numberKeys: true,
    theme: { ...selectListTheme, selectedText: text => chalk.bgHex(BRAND_RED).black.bold(text) },
    items: efforts.map((effort, index) => {
      const tags = [effort.id === active ? 'current' : '', effort.id === defaultEffort ? 'default' : ''].filter(Boolean)
      const name = effort.id === 'xhigh' ? 'Extra high' : effort.name || effort.id
      return {
        value: effort.id,
        label: `${index + 1}. ${name}${tags.length ? ` (${tags.join(', ')})` : ''}`,
        description: effort.description ?? (binary && effort.id !== 'off'
          ? 'Enable thinking'
          : descriptions[effort.id] ?? 'Provider-defined reasoning level'),
      }
    }),
  })
}
