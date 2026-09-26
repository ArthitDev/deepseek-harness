import type { Context } from '@deepseek-ai/cordis'
import type AgentPresets from '@deepseek-ai/dsh-agent-presets'

/** Narrow Cordis's shared service key to the implementation mounted by these tests. */
export function agentPresets(context: Context): AgentPresets {
  return context.agentPresets as unknown as AgentPresets
}
