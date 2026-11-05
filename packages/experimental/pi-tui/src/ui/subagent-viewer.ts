/** Read-only child transcript overlay; the controlling Agent keeps running underneath. */
import type { Context } from '@deepseek-ai/cordis'
import { stripVTControlCharacters } from 'node:util'
import type { SessionId, SessionEvent } from '@deepseek-ai/dsh-session'
import { Container, ScrollView, Text, matchesKey, type Component, type TUI, type TuiMouseEvent } from '@earendil-works/pi-tui'
import { applyEvent, applyStreamChunk, createModel } from '../core/model.js'
import { loadPersistedSession, replayEvents } from '../core/session.js'
import { createView, updateView } from './views.js'
import { style } from './theme.js'

/**
 * Inspect a child without creating, resuming, messaging, or disposing its Agent.
 * @param ctx - TUI context with live sessions and optional persistence.
 * @param tui - Terminal that owns the temporary full-screen overlay.
 * @param id - Child selected from the parent's subagent catalog.
 * @param label - Child's task label shown above its transcript.
 * @param historyLimit - Latest transcript items rendered until older history is revealed.
 * @returns When the user returns to the main Agent, or the TUI is disposed.
 */
export async function inspectSubagent(ctx: Context, tui: TUI, id: SessionId, label: string, historyLimit: number): Promise<void> {
  const controller = new AbortController()
  let dispose = () => {}
  const stopLifecycle = ctx.effect(() => () => { controller.abort(); dispose() }, 'subagent viewer')
  try {
    const read = async () => {
      const live = ctx.get('sessions')?.get(id)
      if (live !== undefined) return { events: replayEvents(live), live: true }
      const saved = await loadPersistedSession(ctx, id)
      if (saved === undefined) throw new Error(`subagent ${id}: no readable session history is available`)
      const resident = ctx.get('sessions')?.get(id)
      return resident === undefined ? { events: saved.events, live: false } : { events: replayEvents(resident), live: true }
    }
    const initial = await read()
    if (controller.signal.aborted) return
    await new Promise<void>((resolve) => {
      let refreshing = false
      let savedOnly = !initial.live
      let error = ''
      let model = createModel()
      let lastSeq = -1
      let limit = historyLimit
      let expandTools = false
      let expandReasoning: boolean | undefined
      let renderTimer: ReturnType<typeof setTimeout> | undefined
      const views = new Map<number, Component>()
      const body = new Container()
      const heading = new Text('', 1, 0)
      const footer = new Text(style.muted('Read only · Esc main agent · ↑/↓ PgUp/PgDn scroll · Home/End · Ctrl+O tools · Ctrl+T thinking · A older · R refresh'), 1, 0)
      const scroll = new ScrollView(body, { follow: 'end', overscroll: 'contain' })
      const render = () => {
        if (controller.signal.aborted) return
        const boundary = Math.max(0, model.items.length - limit)
        for (const key of views.keys()) if (key < boundary || key >= model.items.length) views.delete(key)
        body.clear()
        if (boundary > 0) body.addChild(new Text(style.muted(`${boundary} older items · A to reveal`), 1, 0))
        if (model.items.length === 0) body.addChild(new Text('No messages yet.', 1, 0))
        for (const item of model.items.slice(boundary)) {
          let view = views.get(item.id)
          if (view === undefined) { view = createView(item); views.set(item.id, view) }
          updateView(view, expandReasoning, expandTools)
          body.addChild(view)
        }
        heading.setText(style.accent(`Subagent · ${stripVTControlCharacters(label)}\n${id} · ${savedOnly ? 'Saved snapshot' : model.working ? 'RUNNING' : 'IDLE / FINISHED'}${refreshing ? ' · refreshing' : ''}${error ? `\n${stripVTControlCharacters(error)}` : ''}`))
        tui.requestRender()
      }
      const fold = (event: SessionEvent) => {
        if (event.seq <= lastSeq) return
        lastSeq = event.seq
        const items = model.items
        applyEvent(model, event)
        if (items !== model.items) views.clear()
      }
      for (const event of initial.events) fold(event)
      const panel = new class implements Component {
        invalidate(): void { heading.invalidate(); body.invalidate(); footer.invalidate() }

        render(width: number): string[] {
          const top = heading.render(width)
          const bottom = footer.render(width)
          const lines = body.render(width)
          const height = Math.max(0, tui.terminal.rows - top.length - bottom.length)
          // Overlays render directly, without pi-tui's layout-node viewport clipping.
          scroll.updateLayout(lines.length, height, () => { tui.requestRender() })
          const visible = lines.slice(scroll.scrollTop, scroll.scrollTop + height)
          while (visible.length < height) visible.push('')
          return [...top, ...visible, ...bottom].slice(0, tui.terminal.rows)
        }

        handleMouse(event: TuiMouseEvent): { handled: true } | undefined {
          if (event.type !== 'wheel') return undefined
          scroll.scrollBy(event.wheelDelta ?? 0)
          return { handled: true }
        }

        handleInput(data: string): void {
          if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c') || matchesKey(data, 'ctrl+d')) close()
          else if (matchesKey(data, 'home')) scroll.scrollToStart()
          else if (matchesKey(data, 'end')) scroll.scrollToEnd()
          else if (matchesKey(data, 'up') || matchesKey(data, 'down')) scroll.scrollBy(matchesKey(data, 'up') ? -1 : 1)
          else if (matchesKey(data, 'pageUp') || matchesKey(data, 'pageDown')) {
            scroll.scrollBy(Math.max(1, scroll.viewportHeight - 1) * (matchesKey(data, 'pageUp') ? -1 : 1))
          } else if (matchesKey(data, 'ctrl+o')) { expandTools = !expandTools; render() }
          else if (matchesKey(data, 'ctrl+t')) { expandReasoning = !expandReasoning; render() }
          else if (data.toLowerCase() === 'a') { limit += historyLimit; render() }
          else if (data.toLowerCase() === 'r' && !refreshing) {
            refreshing = true
            render()
            void read().then((snapshot) => {
              if (controller.signal.aborted) return
              model = createModel()
              lastSeq = -1
              views.clear()
              const resident = ctx.get('sessions')?.get(id)
              for (const event of resident === undefined ? snapshot.events : replayEvents(resident)) fold(event)
              savedOnly = !snapshot.live
              error = ''
            }).catch((cause: unknown) => {
              error = cause instanceof Error ? cause.message : String(cause)
            }).finally(() => { refreshing = false; render() })
          }
          tui.requestRender()
        }
      }()
      const handle = tui.showOverlay(panel, { width: '100%', maxHeight: '100%', anchor: 'top-left' })
      const stopEvents = ctx.on('session/event', (session, event) => {
        if (controller.signal.aborted || session.id !== id) return
        fold(event)
        savedOnly = false
        render()
      }, { global: true })
      const stopStream = ctx.get('agents')?.get(id)?.ctx.on('agent/assistant-stream', ({ agent, frame }) => {
        if (controller.signal.aborted || agent.id !== id || frame.type !== 'chunk') return
        if ((frame.chunk.type !== 'text-delta' && frame.chunk.type !== 'reasoning-delta') || frame.chunk.text === '') return
        applyStreamChunk(model, frame.chunk)
        renderTimer ??= setTimeout(() => { renderTimer = undefined; render() }, 16)
      })
      const close = () => { if (!controller.signal.aborted) { controller.abort(); dispose() } }
      dispose = () => {
        clearTimeout(renderTimer)
        stopEvents()
        stopStream?.()
        handle.hide()
        resolve()
      }
      const resident = ctx.get('sessions')?.get(id)
      if (resident !== undefined) for (const event of replayEvents(resident)) fold(event)
      render()
    })
  } finally { await stopLifecycle() }
}
