/**
 * Run-budget enforcement for autonomous (Dead Mode) runs. Once the session's
 * measured token total crosses `maxTotalTokens` or the wall clock since the
 * agent's first observed call crosses `maxWallMs`, every further tool call is
 * refused with a structured `BUDGET_EXCEEDED` result telling the model to stop
 * and produce the partial report — the spec's "งบใกล้หมด: จบด้วยรายงาน partial
 * แทน loop ไม่จำกัด" as an enforcement boundary, not a prompt hope.
 *
 * Metering reuses the durable-log fold from `@deepseek-ai/dsh-token-meter`
 * (structurally typed here so this package stays decoupled); the wall clock
 * starts at this plugin's first observed call per agent, not at session boot.
 *
 * @module @deepseek-ai/dsh-run-budget
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** The structured error `code` on every budget-denied tool result. */
export const BUDGET_EXCEEDED = 'BUDGET_EXCEEDED'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'run-budget'

/** The metering surface this plugin consumes (satisfied by `dsh-token-meter`). */
export interface TokenMeterShape {
  measure(session: Agent['session']): { totalTokens: number }
}

/**
 * Plugin config. `0` disables a ceiling; at least one must be positive —
 * mounting the plugin with both at zero is a misconfiguration and fails loud
 * at load.
 */
export interface Config {
  /** Deny further tool calls once the session's measured token total reaches this. `0` disables. */
  maxTotalTokens?: number
  /** Deny further tool calls once `maxWallMs` have passed since the agent's first observed call. `0` disables. */
  maxWallMs?: number
}

export const Config: z<Config> = z.object({
  maxTotalTokens: z.number().default(0),
  maxWallMs: z.number().default(0),
})

/** Budget-denial rules are one: the run is over budget. */
const RULE = 'budget_exceeded'

/**
 * The structured result substituted for a denied call. The model-facing text
 * instructs the wrap-up directly, so the denied call itself doubles as the
 * partial-report trigger.
 * @param used - measured token total at denial time, when metering is active.
 * @param wallMs - elapsed wall time at denial time, when the clock is active.
 */
function budgetExceededResult(used: number | undefined, wallMs: number | undefined): ToolExecutionResult {
  const spent = [
    used === undefined ? undefined : `totalTokens=${used}`,
    wallMs === undefined ? undefined : `wallMs=${wallMs}`,
  ].filter(part => part !== undefined).join(' ')
  const message = `run budget exhausted (${spent}): stop making tool calls and produce the partial report now`
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: {
      message,
      info: { name: 'RunBudgetError', code: BUDGET_EXCEEDED, reason: `${RULE} ${spent}` },
    },
  }
}

/**
 * Validate the ceilings fail-loud and register the waterfall.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param config - validated {@link Config}; ceilings are re-checked here.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the fields are set after validation.
  const maxTotalTokens = config.maxTotalTokens as number
  const maxWallMs = config.maxWallMs as number
  for (const [field, value] of [['maxTotalTokens', maxTotalTokens], ['maxWallMs', maxWallMs]] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`run-budget: invalid ${field} ${value} — must be an integer >= 0`)
    }
  }
  if (maxTotalTokens === 0 && maxWallMs === 0) {
    throw new Error('run-budget: at least one of `maxTotalTokens`, `maxWallMs` must be > 0')
  }
  const meter = maxTotalTokens > 0
    ? requireMeter(ctx.get('tokenMeter'))
    : undefined
  const started = new WeakMap<Agent, number>()

  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    // A direct `ctx.tools.execute()` caller has no agent to budget.
    if (!exec.agent) return next()
    const now = Date.now()
    let first = started.get(exec.agent)
    if (first === undefined) {
      first = now
      started.set(exec.agent, first)
    }
    const used = meter === undefined ? undefined : meter.measure(exec.agent.session).totalTokens
    const wallMs = maxWallMs > 0 ? now - first : undefined
    if ((used !== undefined && used >= maxTotalTokens) || (wallMs !== undefined && wallMs >= maxWallMs)) {
      return budgetExceededResult(used, wallMs)
    }
    return next()
  })
}

/** Read the metering service fail-loud; a missing or misshaped one never silently disables the token ceiling. */
function requireMeter(tokenMeter: unknown): TokenMeterShape {
  if (tokenMeter !== null && typeof tokenMeter === 'object'
    && typeof (tokenMeter as TokenMeterShape).measure === 'function') {
    return tokenMeter as TokenMeterShape
  }
  throw new Error('run-budget: `maxTotalTokens` requires the token-meter service (`ctx.tokenMeter`) to be mounted')
}
