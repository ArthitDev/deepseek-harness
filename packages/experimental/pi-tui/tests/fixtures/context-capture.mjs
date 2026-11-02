import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { installContextCapture, readContextSnapshot } from '../../lib/types/core/context.js'
import { rebuildAgentSummary } from '../../lib/types/core/agent-summary.js'
import { applyEvent, createModel } from '../../lib/types/core/model.js'

/** Capture metadata-only production context and activity state for headless replay.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Loader context for the headless process.
 * @returns {void} The turn-stopping listener writes metadata under `.dsh/`.
 */
export function apply(ctx) {
  if (process.env.DSH_CONTEXT_CAPTURE_TEST !== '1') return
  installContextCapture(ctx)
  ctx.on('agent/turn-stopping', async ({ agent }) => {
    const request = readContextSnapshot(ctx, agent.session, agent.inbox).lastRequest
    if (request === undefined) return
    const summary = rebuildAgentSummary(agent.session.snapshotEvents())
    const directory = join(process.cwd(), '.dsh')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'context-capture.json'), JSON.stringify({
      generation: request.generation,
      messageCount: request.messageCount,
      messageTokens: request.messageTokens,
      toolCount: request.toolCount,
      toolSchemaTokens: request.toolSchemaTokens,
      usage: request.usage === undefined ? undefined : {
        inputTokens: request.usage.inputTokens,
        outputTokens: request.usage.outputTokens,
        cacheReadTokens: request.usage.cacheReadTokens,
      },
      categories: request.categories,
      agentSummary: {
        hasTask: summary.task !== undefined,
        latestTool: summary.latestTool,
        calls: {
          completed: summary.calls.completed,
          failed: summary.calls.failed,
          cancelled: summary.calls.cancelled,
          stopped: summary.calls.stopped,
          pending: summary.calls.pending.size,
        },
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
      },
    }))
    const model = createModel()
    const transitions = []
    for (const event of agent.session.snapshotEvents()) {
      applyEvent(model, event)
      const callIds = event.type === 'assistant/message'
        ? event.data.message.content.filter(block => block.type === 'tool-call').map(block => block.id)
        : event.type === 'tool/call' ? [event.data.callId]
          : event.type === 'tool/result' ? [event.data.message.source.callId] : []
      for (const callId of callIds) {
        const row = model.activity.find(activity => activity.key === `tool:${callId}`)
        if (row !== undefined) transitions.push({ seq: event.seq, status: row.status, hasProgress: row.progress !== undefined })
      }
    }
    await writeFile(join(directory, 'activity-capture.json'), JSON.stringify({
      transitions,
      rows: model.activity.map(row => ({ seq: row.seq, status: row.status, hasProgress: row.progress !== undefined })),
    }))
  })
}
