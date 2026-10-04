import { describe, expect, it } from 'vitest'
import { collectProjection } from '../src/core/projection.ts'

describe('collectProjection', () => {
  it('falls back to the locally counted tokens when values are absent', () => {
    const fallback = { input: 10, output: 5 }
    expect(collectProjection(undefined, fallback)).toEqual({
      tokens: fallback,
      planActive: false,
    })
  })

  it('reads token totals from the tokenUsage projection', () => {
    const snapshot = collectProjection(
      { tokenUsage: { totals: { uncachedInputTokens: 120, outputTokens: 30 } } },
      { input: 1, output: 1 },
    )
    expect(snapshot.tokens).toEqual({ input: 120, output: 30 })
  })

  it('counts completed todos out of the total', () => {
    const snapshot = collectProjection(
      { todos: [{ status: 'completed' }, { status: 'pending' }, { status: 'completed' }] },
      { input: 0, output: 0 },
    )
    expect(snapshot.todos).toEqual({ done: 2, total: 3 })
  })

  it('ignores a null todos list', () => {
    const snapshot = collectProjection({ todos: null }, { input: 0, output: 0 })
    expect(snapshot.todos).toBeUndefined()
  })

  it('reads plan activity and goal phase', () => {
    const snapshot = collectProjection(
      { plan: { active: true }, goal: { goal: { phase: 'execute' } } },
      { input: 0, output: 0 },
    )
    expect(snapshot.planActive).toBe(true)
    expect(snapshot.goalPhase).toBe('execute')
  })

  it('leaves goalPhase absent when the projection is missing the phase', () => {
    const snapshot = collectProjection({ goal: null }, { input: 0, output: 0 })
    expect(snapshot.goalPhase).toBeUndefined()
    expect(snapshot.planActive).toBe(false)
  })

  it('derives the context percentage and totals from the pressure projection', () => {
    const snapshot = collectProjection(
      { contextPressure: { projectedTokens: 250, contextWindow: 1000 } },
      { input: 0, output: 0 },
    )
    expect(snapshot.contextPct).toBe(25)
    expect(snapshot.contextTotal).toBe(1000)
    expect(snapshot.contextUsed).toBe(250)
  })

  it('falls back to pressureTokens for the used count', () => {
    const snapshot = collectProjection(
      { contextPressure: { pressureTokens: 900, contextWindow: 1000 } },
      { input: 0, output: 0 },
    )
    expect(snapshot.contextUsed).toBe(900)
  })

  it('omits context fields when the window is missing or non-positive', () => {
    const empty = collectProjection({ contextPressure: { projectedTokens: 10 } }, { input: 0, output: 0 })
    expect(empty.contextTotal).toBeUndefined()
    expect(empty.contextUsed).toBeUndefined()
    const zero = collectProjection({ contextPressure: { projectedTokens: 10, contextWindow: 0 } }, { input: 0, output: 0 })
    expect(zero.contextTotal).toBeUndefined()
  })

  it('keeps the percentage undefined when the pressure carries no tokens', () => {
    const snapshot = collectProjection(
      { contextPressure: { contextWindow: 1000 } },
      { input: 0, output: 0 },
    )
    expect(snapshot.contextPct).toBeUndefined()
    expect(snapshot.contextTotal).toBe(1000)
  })
})
