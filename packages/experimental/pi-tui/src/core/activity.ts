/** Session-derived activity for the single Agent Debug panel; never executes operations. */
import type {} from '@deepseek-ai/dsh-user-approval'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCardState } from './model.js'

/** One bounded activity row, updated in place as its operation settles. */
export interface ActivityEntry {
  seq: number
  key: string
  category: 'Agent' | 'Tool' | 'Shell' | 'MCP' | 'File' | 'Approval' | 'Retry'
  status: 'running' | 'ok' | 'error' | 'rejected' | 'waiting' | 'retry' | 'changed' | 'cancelled' | 'stopped'
  label: string
  detail: string
  time: number
  endedAt?: number
  tool?: ToolCardState
}

/**
 * Fold an observed event after its transcript card has been updated. Keeps the newest 20 rows.
 * @param entries - Current session's mutable activity rows.
 * @param event - Durable event, including replayed events.
 * @param tool - Transcript card for a tool call or result, when present.
 */
export function recordActivity(entries: ActivityEntry[], event: SessionEvent, tool?: ToolCardState): void {
  const add = (entry: Omit<ActivityEntry, 'seq' | 'time'>) => {
    entries.push({ ...entry, seq: event.seq, time: event.time })
  }
  if (event.type === 'tool/call' && tool !== undefined) {
    add({ key: `tool:${tool.callId}`, category: tool.name.startsWith('mcp__') ? 'MCP'
      : /^(terminal_|bash$|pwsh$|shell$)/.test(tool.name) ? 'Shell' : 'Tool',
    status: 'running', label: tool.name, detail: event.data.arguments, tool })
  } else if (event.type === 'tool/result' && tool !== undefined) {
    const row = entries.find(entry => entry.key === `tool:${tool.callId}`)
    if (row !== undefined) {
      row.status = tool.status
      row.endedAt = event.time
    }
    for (const diff of tool.diffs ?? []) {
      add({ key: `file:${event.seq}:${diff.path}`, category: 'File', status: 'changed',
        label: diff.path, detail: `${diff.oldText === null ? 'Created' : 'Modified'} by ${tool.name}\n\n${diff.oldText === null ? '' : `Before:\n${diff.oldText}\n\n`}After:\n${diff.newText}`,
        endedAt: event.time })
    }
  } else if (event.type === 'turn/start') {
    add({ key: `turn:${event.data.turn}`, category: 'Agent', status: 'running',
      label: `turn ${event.data.turn}`, detail: 'Agent is working.' })
  } else if (event.type === 'turn/end') {
    const reason = event.data.reason
    const status = reason.kind === 'completed' ? 'ok' : reason.kind === 'error' ? 'error'
      : reason.kind === 'aborted' ? 'cancelled' : 'stopped'
    for (const row of entries) {
      if (row.endedAt !== undefined) continue
      row.endedAt = event.time
      if (row.category === 'Agent') {
        row.status = status
        row.detail = reason.kind === 'error' ? `${reason.error.code}: ${reason.error.message}` : reason.kind
      } else if (row.category === 'Retry') {
        row.status = status
      } else {
        row.status = reason.kind === 'aborted' ? 'cancelled' : 'stopped'
      }
    }
  } else if (event.type === 'assistant/message') {
    for (const row of entries) {
      if (row.category === 'Retry' && row.endedAt === undefined) {
        row.status = 'ok'
        row.endedAt = event.time
      }
    }
  } else if (event.type === 'approval/asked') {
    add({ key: `approval:${event.data.id}`, category: 'Approval', status: 'waiting',
      label: event.data.toolName, detail: event.data.reason ?? 'Waiting for approval.' })
  } else if (event.type === 'approval/decided') {
    const row = entries.find(entry => entry.key === `approval:${event.data.id}`)
    if (row !== undefined) {
      row.status = event.data.outcome === 'allowed-once' ? 'ok' : event.data.outcome === 'rejected'
        ? 'rejected' : event.data.outcome === 'unavailable' ? 'error' : 'cancelled'
      row.detail += `\n${event.data.outcome}`
      row.endedAt = event.time
    }
  } else {
    // Retry events are plugin-merged and need not be present in this package's type graph.
    const raw = event as {
      type: string
      data: {
        retryId?: unknown
        retry?: unknown
        maxRetries?: unknown
        provider?: unknown
        delayMs?: unknown
        failure?: { message?: unknown; code?: unknown }
      }
    }
    if (raw.type === 'llm/retry' && typeof raw.data.retryId === 'string'
      && typeof raw.data.retry === 'number' && typeof raw.data.provider === 'string'
      && typeof raw.data.delayMs === 'number') {
      for (const row of entries) {
        if (row.category === 'Retry' && row.endedAt === undefined) {
          row.status = 'error'
          row.endedAt = event.time
        }
      }
      add({ key: `retry:${raw.data.retryId}:${raw.data.retry}`, category: 'Retry', status: 'waiting',
        label: `${raw.data.provider} · attempt ${raw.data.retry}${typeof raw.data.maxRetries === 'number' ? `/${raw.data.maxRetries}` : ''}`,
        detail: `Wait ${raw.data.delayMs}ms\n${typeof raw.data.failure?.code === 'string' ? raw.data.failure.code : ''} ${typeof raw.data.failure?.message === 'string' ? raw.data.failure.message : ''}`.trim() })
    } else if (raw.type === 'llm/retry-started' && typeof raw.data.retryId === 'string'
      && typeof raw.data.retry === 'number') {
      const key = `retry:${raw.data.retryId}:${raw.data.retry}`
      const row = entries.find(entry => entry.key === key)
      if (row !== undefined) row.status = 'retry'
    }
    // Other plugin events do not contribute activity rows.
  }
  entries.splice(0, Math.max(0, entries.length - 20))
}
