/**
 * Pure model-selection seeding: the provider/model/reasoning-effort fallback
 * chain shared by fresh and resumed agents. Unit-testable without a terminal.
 */
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

export const DEFAULT_PROVIDER = 'deepseek-official'
export const DEFAULT_MODEL = 'deepseek-v4-flash'

export interface SelectionSeed {
  header?: { provider?: string; model?: string; reasoningEffort?: string; adapterDefaults?: { reasoningEffort?: boolean } }
  config?: { provider?: string; model?: string }
  agentOptions?: { provider?: string; model?: string }
  defaults?: { provider?: string; model?: string; reasoningEffort?: string }
  /** The prior selection — its provider/model/reasoning effort carry across a session switch. */
  prior?: ModelSelection
}

/**
 * Fold the selection sources into the next-step model selection.
 * Precedence: persisted request header → prior selection (the model currently
 * in use — /new and /clear keep it) → row config → agent options →
 * harness default → hard-coded route. A restored header retains only explicitly
 * selected effort, matching Web. Without a header, effort falls back prior →
 * saved default when the resolved route matches the saved route.
 */
export function seedModelSelection(input: SelectionSeed): ModelSelection {
  const provider =
    input.header?.provider ??
    input.prior?.provider ??
    input.config?.provider ??
    input.agentOptions?.provider ??
    input.defaults?.provider ??
    DEFAULT_PROVIDER
  const model =
    input.header?.model ??
    input.prior?.model ??
    input.config?.model ??
    input.agentOptions?.model ??
    input.defaults?.model ??
    DEFAULT_MODEL
  const savedEffort = input.defaults?.reasoningEffort
  const reasoningEffort =
    input.header !== undefined
      ? input.header.reasoningEffort !== undefined && input.header.adapterDefaults?.reasoningEffort !== true
        ? ReasoningEffortId(input.header.reasoningEffort)
        : undefined
      : input.prior?.reasoningEffort !== undefined
        ? input.prior.reasoningEffort
        : savedEffort !== undefined
          && provider === input.defaults?.provider
          && model === input.defaults.model
          ? ReasoningEffortId(savedEffort)
          : undefined
  return {
    provider,
    model,
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  }
}
