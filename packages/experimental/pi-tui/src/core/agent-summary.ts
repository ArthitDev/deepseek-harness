/** Bounded, event-derived Agent Debug facts for one live or replayed agent. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { stripVTControlCharacters } from 'node:util'
import { textOf } from './model.js'

function boundedText(value: string, limit: number): string {
  return stripVTControlCharacters(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
}

type SummaryPluginEvent = {
  type: string
  data: {
    subCallId?: string
    name?: string
    isError?: boolean
    error?: { code?: string }
    todos?: readonly { content: string; status: 'pending' | 'in_progress' | 'completed' }[]
  }
}

/** Read locally merged tool/todo events that the package does not import. */
function summaryPluginEvent(event: SessionEvent): SummaryPluginEvent {
  return event as SummaryPluginEvent
}

/** Factual summary of one agent's accepted task and observed work. */
export interface AgentSummary {
  task?: string
  latestTool?: string
  calls: { pending: Set<string>; completed: number; failed: number; cancelled: number; stopped: number }
  startedAt?: number
  endedAt?: number
  inputTokens?: number
  outputTokens?: number
  todos?: { total: number; completed: number; remainingLabels: string[] }
}

/** Create empty per-agent summary state.
 * @param task - optional confirmed delegation label.
 * @returns empty turn counters with the supplied task, when present.
 */
export function createAgentSummary(task?: string): AgentSummary {
  return {
    ...(task === undefined ? {} : { task: boundedText(task, 160) }),
    calls: { pending: new Set(), completed: 0, failed: 0, cancelled: 0, stopped: 0 },
  }
}

/** Fold one accepted session event into an agent summary.
 * @param summary - mutable summary for one agent.
 * @param event - durable event accepted by that agent.
 */
export function foldAgentSummary(summary: AgentSummary, event: SessionEvent): void {
  if (event.type === 'user/message' && event.data.source.kind === 'user') {
    const task = textOf(event.data.content)
    if (task !== '') summary.task = boundedText(task, 160)
  } else if (event.type === 'tool/call') {
    summary.latestTool = boundedText(event.data.name, 80)
    summary.calls.pending.add(event.data.callId)
  } else if (event.type === 'tool/result') {
    const id = event.data.message.source.callId
    if (summary.calls.pending.delete(id)) {
      if (event.data.error?.code === 'ABORTED' || event.data.error?.code === 'ABORTED_BEFORE_DISPATCH') summary.calls.cancelled++
      else if (event.data.message.isError === true || event.data.error !== undefined) summary.calls.failed++
      else summary.calls.completed++
    }
  } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    summary.inputTokens = (summary.inputTokens ?? 0) + event.data.usage.inputTokens
    summary.outputTokens = (summary.outputTokens ?? 0) + event.data.usage.outputTokens
  } else if (event.type === 'turn/start') {
    summary.calls = { pending: new Set(), completed: 0, failed: 0, cancelled: 0, stopped: 0 }
    delete summary.latestTool
    delete summary.inputTokens
    delete summary.outputTokens
    summary.startedAt = event.time
    delete summary.endedAt
  } else if (event.type === 'turn/end' && summary.startedAt !== undefined) {
    summary.endedAt = event.time
    summary.calls.cancelled += event.data.reason.kind === 'aborted' ? summary.calls.pending.size : 0
    summary.calls.stopped += event.data.reason.kind === 'aborted' ? 0 : summary.calls.pending.size
    summary.calls.pending.clear()
  } else {
    const raw = summaryPluginEvent(event)
    if (raw.type === 'todo/write' && raw.data.todos !== undefined) {
      summary.todos = {
        total: raw.data.todos.length,
        completed: raw.data.todos.filter(todo => todo.status === 'completed').length,
        remainingLabels: raw.data.todos.filter(todo => todo.status !== 'completed').slice(0, 2).map(todo => boundedText(todo.content, 48)),
      }
    } else if (raw.type === 'tool/ptc-dispatch-start' && typeof raw.data.subCallId === 'string' && typeof raw.data.name === 'string') {
      summary.latestTool = boundedText(raw.data.name, 80)
      summary.calls.pending.add(`ptc:${raw.data.subCallId}`)
    } else if (raw.type === 'tool/ptc-dispatch' && typeof raw.data.subCallId === 'string'
      && summary.calls.pending.delete(`ptc:${raw.data.subCallId}`)) {
      if (raw.data.error?.code === 'ABORTED' || raw.data.error?.code === 'ABORTED_BEFORE_DISPATCH') summary.calls.cancelled++
      else if (raw.data.isError === true) summary.calls.failed++
      else summary.calls.completed++
    }
  }
}

/** Rebuild after clear or rewind, excluding the marker's shadowed log ranges.
 * @param events - complete ordered session snapshot.
 * @param seed - optional confirmed delegation label.
 * @returns summary folded from the surviving events.
 */
export function rebuildAgentSummary(events: readonly SessionEvent[], seed?: string): AgentSummary {
  const ranges: { start: number; end: number }[] = []
  for (const event of events) {
    if (event.type !== 'developer/message') continue
    const marker = event as SessionEvent & { surfaceOp?: { op?: string; startSeq?: number; endSeq?: number } }
    const operation = marker.surfaceOp
    if (operation?.op !== 'replace' || typeof operation.startSeq !== 'number' || typeof operation.endSeq !== 'number') continue
    ranges.push({ start: operation.startSeq, end: event.data.message.content.some(block =>
      block.type === 'text' && block.text.startsWith('the operator cleared')) ? event.seq : operation.endSeq })
  }
  const summary = createAgentSummary(seed)
  for (const event of events) {
    if (event.type === 'developer/message' || ranges.some(range => event.seq >= range.start && event.seq <= range.end)) continue
    foldAgentSummary(summary, event)
  }
  return summary
}

/** Render observed facts for one Agent Debug row.
 * @param summary - current per-agent facts.
 * @param now - observation time used for an active turn.
 * @returns one concise summary line without tool or prompt output.
 */
export function formatAgentSummary(summary: AgentSummary, now = Date.now()): string {
  const counts = summary.calls
  const total = counts.pending.size + counts.completed + counts.failed + counts.cancelled + counts.stopped
  const elapsed = summary.startedAt === undefined ? undefined : Math.max(0, ((summary.endedAt ?? now) - summary.startedAt) / 1000)
  return [
    summary.task === undefined ? undefined : `task: ${summary.task}`,
    summary.latestTool === undefined ? undefined : `last tool: ${summary.latestTool}`,
    `calls: ${total === 0 ? 'none' : `${counts.pending.size} pending, ${counts.completed} completed, ${counts.failed} failed, ${counts.cancelled} cancelled, ${counts.stopped} stopped`}`,
    elapsed === undefined ? undefined : `elapsed: ${elapsed.toFixed(1)}s`,
    summary.inputTokens === undefined ? 'usage: unknown' : `usage: ${summary.inputTokens} in / ${summary.outputTokens} out tokens`,
    summary.todos === undefined ? undefined : `todos: ${summary.todos.completed}/${summary.todos.total} completed, ${summary.todos.total - summary.todos.completed} remaining${summary.todos.remainingLabels.length === 0 ? '' : ` (${summary.todos.remainingLabels.join('; ')})`}`,
  ].filter((line): line is string => line !== undefined).join(' · ')
}
