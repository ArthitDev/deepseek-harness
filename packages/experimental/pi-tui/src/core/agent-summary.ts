/** Bounded, event-derived Agent Debug facts for one live or replayed agent. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm'
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
  calls: { pending: Map<string, number | undefined>; completed: number; failed: number; cancelled: number; stopped: number }
  startedAt?: number
  endedAt?: number
  /** First `turn/start` to `step/start` interval; absent when either event is missing. */
  preStepMs?: number
  /** Sum of matched `step/start` to `assistant/message` intervals. */
  requestSumMs: number
  requestSamples: number
  stepsStarted: number
  ttftSumMs: number
  ttftSamples: number
  /** Sum of matched root `tool/call` to `tool/result` intervals. */
  toolSumMs: number
  toolSamples: number
  toolCallsStarted: number
  turn?: number
  openStep?: { turn: number; step: number; startedAt: number; firstTokenAt?: number }
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
    calls: emptyCalls(),
    requestSumMs: 0,
    requestSamples: 0,
    stepsStarted: 0,
    ttftSumMs: 0,
    ttftSamples: 0,
    toolSumMs: 0,
    toolSamples: 0,
    toolCallsStarted: 0,
  }
}

function elapsedMs(start: number, end: number): number {
  return Math.max(0, end - start)
}

function emptyCalls(): AgentSummary['calls'] {
  return { pending: new Map(), completed: 0, failed: 0, cancelled: 0, stopped: 0 }
}

/** Fold one accepted session event into an agent summary.
 * @param summary - mutable summary for one agent.
 * @param event - durable event accepted by that agent.
 */
export function foldAgentSummary(summary: AgentSummary, event: SessionEvent): void {
  if (event.type === 'turn/start') {
    summary.calls = emptyCalls()
    delete summary.latestTool
    delete summary.inputTokens
    delete summary.outputTokens
    delete summary.preStepMs
    delete summary.openStep
    summary.requestSumMs = 0
    summary.requestSamples = 0
    summary.stepsStarted = 0
    summary.ttftSumMs = 0
    summary.ttftSamples = 0
    summary.toolSumMs = 0
    summary.toolSamples = 0
    summary.toolCallsStarted = 0
    summary.turn = event.data.turn
    summary.startedAt = event.time
    delete summary.endedAt
  } else if (event.type === 'step/start') {
    summary.stepsStarted++
    if (summary.turn === event.data.turn && summary.preStepMs === undefined && summary.startedAt !== undefined) {
      summary.preStepMs = elapsedMs(summary.startedAt, event.time)
    }
    summary.openStep = { turn: event.data.turn, step: event.data.step, startedAt: event.time }
  } else if (event.type === 'assistant/attempt') {
    const openStep = summary.openStep
    if (openStep?.turn === event.data.turn && openStep.step === event.data.step && openStep.firstTokenAt === undefined) {
      const firstTokenAt = assistantStreamFirstTokenTime(event.data.stream)
      if (firstTokenAt !== undefined) openStep.firstTokenAt = firstTokenAt
    }
  } else if (event.type === 'assistant/message') {
    if (event.data.usage !== undefined) {
      summary.inputTokens = (summary.inputTokens ?? 0) + event.data.usage.inputTokens
      summary.outputTokens = (summary.outputTokens ?? 0) + event.data.usage.outputTokens
    }
    const openStep = summary.openStep
    if (openStep?.turn === event.data.turn && openStep.step === event.data.step) {
      summary.requestSumMs += elapsedMs(openStep.startedAt, event.time)
      summary.requestSamples++
      const firstTokenAt = openStep.firstTokenAt ?? assistantStreamFirstTokenTime(event.data.stream)
      if (firstTokenAt !== undefined) {
        summary.ttftSumMs += elapsedMs(openStep.startedAt, firstTokenAt)
        summary.ttftSamples++
      }
      delete summary.openStep
    }
  } else if (event.type === 'step/end') {
    if (summary.openStep?.turn === event.data.turn && summary.openStep.step === event.data.step) delete summary.openStep
  } else if (event.type === 'tool/call') {
    summary.latestTool = boundedText(event.data.name, 80)
    summary.toolCallsStarted++
    summary.calls.pending.set(event.data.callId, event.time)
  } else if (event.type === 'tool/result') {
    const id = event.data.message.source.callId
    if (summary.calls.pending.has(id)) {
      const startedAt = summary.calls.pending.get(id)
      summary.calls.pending.delete(id)
      if (startedAt !== undefined) {
        summary.toolSumMs += elapsedMs(startedAt, event.time)
        summary.toolSamples++
      }
      if (event.data.error?.code === 'ABORTED' || event.data.error?.code === 'ABORTED_BEFORE_DISPATCH') summary.calls.cancelled++
      else if (event.data.message.isError === true || event.data.error !== undefined) summary.calls.failed++
      else summary.calls.completed++
    }
  } else if (event.type === 'turn/end' && summary.turn === event.data.turn && summary.startedAt !== undefined) {
    summary.endedAt = event.time
    summary.calls.cancelled += event.data.reason.kind === 'aborted' ? summary.calls.pending.size : 0
    summary.calls.stopped += event.data.reason.kind === 'aborted' ? 0 : summary.calls.pending.size
    summary.calls.pending.clear()
    delete summary.openStep
  } else if (event.type === 'user/message' && event.data.source.kind === 'user') {
    const task = textOf(event.data.content)
    if (task !== '') summary.task = boundedText(task, 160)
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
      summary.calls.pending.set(`ptc:${raw.data.subCallId}`, undefined)
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
    summary.turn === undefined ? undefined : `pre-step: ${summary.preStepMs === undefined ? 'unknown' : `${Math.round(summary.preStepMs)}ms`}`,
    summary.turn === undefined && summary.stepsStarted === 0 ? undefined
      : `request sum: ${summary.requestSamples === 0 ? 'unknown' : `${Math.round(summary.requestSumMs)}ms (${summary.requestSamples})`}`,
    summary.turn === undefined && summary.stepsStarted === 0 ? undefined
      : `TTFT avg: ${summary.ttftSamples === 0 ? 'unknown' : `${Math.round(summary.ttftSumMs / summary.ttftSamples)}ms (${summary.ttftSamples})`}`,
    summary.turn === undefined && summary.toolCallsStarted === 0 ? undefined
      : `tool sum: ${summary.toolSamples === 0 ? 'unknown' : `${Math.round(summary.toolSumMs)}ms (${summary.toolSamples})`}`,
    summary.inputTokens === undefined ? 'usage: unknown' : `usage: ${summary.inputTokens} in / ${summary.outputTokens} out tokens`,
    summary.todos === undefined ? undefined : `todos: ${summary.todos.completed}/${summary.todos.total} completed, ${summary.todos.total - summary.todos.completed} remaining${summary.todos.remainingLabels.length === 0 ? '' : ` (${summary.todos.remainingLabels.join('; ')})`}`,
  ].filter((line): line is string => line !== undefined).join(' · ')
}
