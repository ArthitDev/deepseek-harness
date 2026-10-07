import { describe, expect, it } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { DEFAULT_MODEL, DEFAULT_PROVIDER, seedModelSelection } from '../src/core/selection.ts'

const selection = (provider: string, model: string, reasoningEffort?: string): ModelSelection => ({
  provider,
  model,
  ...(reasoningEffort !== undefined ? { reasoningEffort: ReasoningEffortId(reasoningEffort) } : {}),
})

describe('seedModelSelection', () => {
  it('falls through to the hard-coded route with nothing set', () => {
    expect(seedModelSelection({})).toEqual({ provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL })
  })

  it('prefers the persisted request header over every other source', () => {
    expect(
      seedModelSelection({
        header: { provider: 'header-p', model: 'header-m' },
        config: { provider: 'config-p', model: 'config-m' },
        agentOptions: { provider: 'option-p', model: 'option-m' },
        defaults: { provider: 'default-p', model: 'default-m' },
      }),
    ).toEqual({ provider: 'header-p', model: 'header-m' })
  })

  it('carries the prior provider/model over agent options and defaults', () => {
    const seeded = seedModelSelection({
      agentOptions: { provider: 'antigravity', model: 'gemini-3-flash' },
      defaults: { provider: 'antigravity', model: 'gemini-3-flash' },
      prior: { provider: 'b-ai', model: 'glm-5.3-flash' },
    })
    expect(seeded.provider).toBe('b-ai')
    expect(seeded.model).toBe('glm-5.3-flash')
  })

  it('walks config, agent options, then defaults per field', () => {
    expect(seedModelSelection({ config: { model: 'config-m' } })).toEqual({
      provider: DEFAULT_PROVIDER,
      model: 'config-m',
    })
    expect(seedModelSelection({ agentOptions: { provider: 'option-p' } })).toEqual({
      provider: 'option-p',
      model: DEFAULT_MODEL,
    })
    expect(
      seedModelSelection({ defaults: { provider: 'default-p', model: 'default-m' } }),
    ).toEqual({ provider: 'default-p', model: 'default-m' })
  })

  it('takes the reasoning effort from the header when present', () => {
    const seeded = seedModelSelection({ header: { reasoningEffort: 'high' } })
    expect(seeded.reasoningEffort).toBe(ReasoningEffortId('high'))
  })

  it('carries the prior selection model and effort when the header has neither', () => {
    const seeded = seedModelSelection({
      header: { provider: 'header-p' },
      prior: selection('p', 'm', 'max'),
    })
    expect(seeded).toMatchObject({ provider: 'header-p', model: 'm', reasoningEffort: ReasoningEffortId('max') })
  })

  it('omits the reasoning effort when neither header nor prior has one', () => {
    const seeded = seedModelSelection({ prior: selection('p', 'm') })
    expect(seeded.reasoningEffort).toBeUndefined()
    expect(Object.hasOwn(seeded, 'reasoningEffort')).toBe(false)
  })
})
