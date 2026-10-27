/** Read-only session recap from the active derived history, including compaction checkpoints. */
import type { Message } from '@deepseek-ai/dsh-llm'
import { compactSummaryText, textOf } from './model.js'

function excerpt(text: string, limit: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  return chars.length <= limit ? chars.join('') : `${chars.slice(0, limit - 1).join('')}…`
}

/** A checkpoint section, absent when the summarizer recorded no information for it. */
function section(summary: string, heading: string): string | undefined {
  const lines = summary.split(/\r?\n/)
  const start = lines.indexOf(`## ${heading}`)
  if (start === -1) return undefined
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    body.push(line.replace(/^\s*-\s*/, ''))
  }
  const text = body.join(' ').trim()
  return text === '' || text === '(none)' ? undefined : text
}

/**
 * Quote recent task context without generating new claims or changing model history.
 * @param messages - Active `Session.deriveMessages()` output; excludes shadowed history.
 * @returns A single-line recap of at most 400 Unicode code points, or undefined for empty history.
 */
export function buildRecap(messages: readonly Message[]): string | undefined {
  let request: string | undefined
  let reply: string | undefined
  let checkpoint: string | undefined
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message === undefined) continue
    const text = textOf(message.content)
    if (text === '') continue
    const kind: string = message.source.kind
    if (message.role === 'user' && kind === 'user') request ??= text
    if (message.role === 'assistant') reply ??= text
    if (message.role === 'user' && kind === 'compact-checkpoint') checkpoint ??= compactSummaryText(text)
    if (request !== undefined && reply !== undefined && checkpoint !== undefined) break
  }
  const parts: string[] = []
  if (request !== undefined) parts.push(`Request: ${excerpt(request, 110)}`)
  if (reply !== undefined) parts.push(`Last reply: ${excerpt(reply, 110)}`)
  if (checkpoint !== undefined) {
    const work = section(checkpoint, 'Current Work') ?? section(checkpoint, 'Primary Request and Intent')
    const next = section(checkpoint, 'Next Step')
    const context = [work, next === undefined ? undefined : `Next at checkpoint: ${next}`]
      .filter(part => part !== undefined).join(' · ')
    parts.push(`Checkpoint: ${excerpt(context || checkpoint, 140)}`)
  }
  return parts.length === 0 ? undefined : excerpt(`Recap · ${parts.join(' · ')}`, 400)
}
