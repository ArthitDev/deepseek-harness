import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'queued-turn-completion-fixture'
export const inject = ['agents']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Scenario-owned runtime. */
export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.on('session/event', (session, event) => {
      if (session !== agent.session || event.type !== 'turn/end' || event.data.turn !== 1
        || event.data.reason.kind !== 'completed') return
      // Reproduce the completion-to-idle window without relying on IPC timing.
      queueMicrotask(() => agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'Reply with exactly the word: TWO. No tools.' }],
        source: { kind: 'queued-turn-completion-fixture' },
      })))
    })
  })
}
