import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-compaction'

export const name = 'compaction-glm-live-fixture'

/** Trigger one controlled compaction before the marked continuation enters the model request. */
export function apply(ctx: Context): void {
  const compacted = new Set<string>()
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    if (!ctx.llm.listProviders().some(provider => provider.id === 'zai')) {
      throw new Error('GLM live compaction evaluation requires the registered zai adapter route')
    }
    const sessionId = String(agent.session.id)
    if (!messages.some(message => textOf(message).includes('RESUME_AFTER_COMPACTION'))
      || compacted.has(sessionId)) return next()
    const events = agent.session.snapshotEvents()
    const bySeq = new Map(events.map(event => [event.seq, event]))
    const nodes = agent.session.surface.nodes
    const firstUser = nodes.find(seq => bySeq.get(seq)?.type === 'user/message')
    const lastNode = nodes.at(-1)
    if (firstUser === undefined || lastNode === undefined) {
      throw new Error('GLM compaction fixture found no completed seed turn to compact')
    }
    const result = await ctx.compaction.compactRegion(firstUser, lastNode, agent, signal)
    if (result.shadowedSeqs.length === 0) throw new Error('GLM compaction fixture compacted no seed history')
    compacted.add(sessionId)
    return next()
  })
}

export const inject = ['compaction', 'llm']

function textOf(message: UserMessage): string {
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}
