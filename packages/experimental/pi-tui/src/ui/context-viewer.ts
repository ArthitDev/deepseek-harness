import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Container, ScrollView, Text, matchesKey, type Component, type TUI } from '@earendil-works/pi-tui'
import { readContextSnapshot } from '../core/context.js'
import { style } from './theme.js'

/** Show a read-only summary of captured and current context metadata.
 * @param ctx - Context used to read token-meter and active prompt-section metadata.
 * @param tui - Terminal UI that displays and hides the overlay.
 * @param agent - Agent whose session and inbox provide the snapshot data.
 * @param onClose - Callback invoked once when the user or returned closer closes the viewer.
 * @returns An idempotent closer that hides the overlay and invokes `onClose` once.
 */
export function showContextViewer(ctx: Context, tui: TUI, agent: Agent, onClose: () => void): () => void {
  const snapshot = readContextSnapshot(ctx, agent.session, agent.inbox)
  const body = new Container()
  const scroll = new ScrollView(body, { follow: 'none', overscroll: 'contain' })
  const window = snapshot.lastRequest?.contextWindow
  const request = snapshot.lastRequest
  const estimatedRequestTokens = request === undefined ? undefined : request.messageTokens + request.toolSchemaTokens
  const requestHeadroom = window === undefined || estimatedRequestTokens === undefined || request?.maxTokens === undefined
    ? 'unknown'
    : `${Math.max(0, window - estimatedRequestTokens - request.maxTokens).toLocaleString()} tokens`
  const rows = [
    style.accent('Context diagnostics'),
    request === undefined ? 'Harness request at llm/stream (pre-adapter): unavailable' : `Harness request at llm/stream (pre-adapter): ${request.provider} / ${request.model} · capture ${request.generation} · session seq ${request.seq}`,
    request === undefined ? 'Last request messages and tools: unknown' : `Messages: ${request.messageCount} · estimated ${request.messageTokens.toLocaleString()} tokens`,
    request === undefined ? 'Tool / MCP schemas: unknown' : `Tool / MCP schemas: ${request.toolCount} · estimated ${request.toolSchemaTokens.toLocaleString()} tokens`,
    ...(request === undefined ? [] : [
      `Request sources: system ${request.categories.system.count}/${request.categories.system.tokens} tok · agent instructions ${request.categories.agentInstructions.count}/${request.categories.agentInstructions.tokens} tok`,
      `Runtime ${request.categories.runtimeContext.count}/${request.categories.runtimeContext.tokens} tok · checkpoint ${request.categories.checkpoint.count}/${request.categories.checkpoint.tokens} tok`,
      `Tool results ${request.categories.toolResults.count}/${request.categories.toolResults.tokens} tok · ordinary history ${request.categories.history.count}/${request.categories.history.tokens} tok`,
    ]),
    'Flattened system section sources and sizes: unknown',
    `Configured required sections (registration requirements, not sent-section evidence): ${snapshot.configuredSections === undefined ? 'unknown' : snapshot.configuredSections.map(section => `${section.name}@${section.version}`).join(', ') || 'none'}`,
    `Provider uncached input/output: ${request?.usage === undefined ? 'unknown' : `${request.usage.inputTokens.toLocaleString()} / ${request.usage.outputTokens.toLocaleString()} tokens`}`,
    `Provider cache read/write: ${request?.usage === undefined ? 'unknown' : `${request.usage.cacheReadTokens?.toLocaleString() ?? 'unknown'} / ${request.usage.cacheWriteTokens?.toLocaleString() ?? 'unknown'} tokens`}`,
    `Provider reported total: ${request?.usage?.totalTokens?.toLocaleString() ?? 'unknown'} tokens`,
    `Captured request context window: ${window?.toLocaleString() ?? 'unknown'} tokens`,
    `Current session context window: ${snapshot.contextWindow?.toLocaleString() ?? 'unknown'} tokens`,
    `Output reserve: ${request?.maxTokens?.toLocaleString() ?? 'unknown'} tokens`,
    `Last-request headroom after reserve: ${requestHeadroom} (estimate)`,
    `Current retained context: ${snapshot.currentTokens?.toLocaleString() ?? 'unknown'} tokens · ${snapshot.currentBaseline ?? 'unknown'} baseline ${snapshot.currentBaselineTokens?.toLocaleString() ?? 'unknown'} + surface delta ${snapshot.currentSurfaceDelta?.toLocaleString() ?? 'unknown'} tokens`,
    `Current retained surface estimate: ${snapshot.currentSurfaceTokens?.toLocaleString() ?? 'unknown'} tokens`,
    `Queued next-step: ${snapshot.nextStep.count} messages · estimated ${snapshot.nextStep.tokens.toLocaleString()} tokens`,
    `Queued next-turn: ${snapshot.nextTurn.count} messages · estimated ${snapshot.nextTurn.tokens.toLocaleString()} tokens`,
    'Queued input is shown separately and may be merged, filtered, or rewritten before a request.',
    '',
    'Message and queue estimates use the shared fixed-density estimator. Retained pressure is labeled by its meter baseline.',
    'No message text, prompt, tool arguments, or credentials are shown.',
  ]
  for (const row of rows) body.addChild(new Text(row, 1, 0))
  const footer = new Text(style.muted('Read only · ↑/↓ PgUp/PgDn scroll · Home/End · Esc close'), 1, 0)
  let hide = () => {}
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    hide()
    onClose()
  }
  const panel = new class implements Component {
    invalidate(): void { body.invalidate(); footer.invalidate() }

    render(width: number): string[] {
      const top = new Text(style.accent('Context'), 1, 0).render(width)
      const bottom = footer.render(width)
      const lines = body.render(width)
      const height = Math.max(0, tui.terminal.rows - top.length - bottom.length)
      scroll.updateLayout(lines.length, height, () => { tui.requestRender() })
      const visible = lines.slice(scroll.scrollTop, scroll.scrollTop + height)
      while (visible.length < height) visible.push('')
      return [...top, ...visible, ...bottom].slice(0, tui.terminal.rows)
    }

    handleInput(data: string): void {
      if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c') || matchesKey(data, 'ctrl+d')) close()
      else if (matchesKey(data, 'home')) scroll.scrollToStart()
      else if (matchesKey(data, 'end')) scroll.scrollToEnd()
      else if (matchesKey(data, 'up') || matchesKey(data, 'down')) scroll.scrollBy(matchesKey(data, 'up') ? -1 : 1)
      else if (matchesKey(data, 'pageUp') || matchesKey(data, 'pageDown')) {
        scroll.scrollBy(Math.max(1, scroll.viewportHeight - 1) * (matchesKey(data, 'pageUp') ? -1 : 1))
      }
      tui.requestRender()
    }
  }()
  const handle = tui.showOverlay(panel, { width: '100%', maxHeight: '100%', anchor: 'top-left' })
  hide = () => { handle.hide() }
  return close
}
