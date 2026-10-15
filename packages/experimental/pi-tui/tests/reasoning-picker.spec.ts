import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import { pickReasoningLevel } from '../src/ui/reasoning-picker.ts'

const model: LlmResolvedModelInfo = {
  provider: 'gateway', id: 'model', name: 'GPT-5.6-Sol',
  reasoning: {
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'].map(id => ({ id: ReasoningEffortId(id), name: id[0]!.toUpperCase() + id.slice(1) })),
    defaultEffort: ReasoningEffortId('low'),
  },
}

function terminal(): Terminal {
  return {
    columns: 120, rows: 30, kittyProtocolActive: false,
    start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
    moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
    clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
  }
}

function open(info = model, current?: string) {
  const tui = new TuiAltScreen(terminal())
  const show = vi.spyOn(tui, 'showOverlay')
  const picked = pickReasoningLevel(tui, info, current)
  const panel = show.mock.calls[0]?.[0]
  return { tui, picked, panel, text: (width = 108) => stripVTControlCharacters(panel?.render(width).join('\n') ?? '').split('\n').map(line => line.trimEnd()).join('\n') }
}

describe('reasoning-level picker', () => {
  it('renders numbered levels with descriptions, current and default markers', async () => {
    const { tui, picked, panel, text } = open(model, 'high')
    try {
      expect(text()).toMatchInlineSnapshot(`
        " Select Reasoning Level for GPT-5.6-Sol
         ↑/↓ choose · number jump · Enter apply · Esc cancel
          1. Low (default)                Faster responses with lighter reasoning
          2. Medium                       Balance speed and reasoning depth
        → 3. High (current)               More reasoning for complex tasks
          4. Extra high                   Extra reasoning for demanding tasks
          5. Max                          Highest available effort; may take longer"
      `)
      panel?.handleInput?.('\r')
      await expect(picked).resolves.toBe('high')
      expect(tui.hasOverlay()).toBe(false)
    } finally { tui.stop() }
  })

  it('moves with arrows and numbers, applying only on Enter', async () => {
    const { tui, picked, panel, text } = open(model, 'high')
    try {
      panel?.handleInput?.('\x1b[A')
      expect(text()).toContain('→ 2. Medium')
      panel?.handleInput?.('5')
      expect(text()).toContain('→ 5. Max')
      panel?.handleInput?.('9')
      expect(text()).toContain('→ 5. Max')
      expect(tui.hasOverlay()).toBe(true)
      panel?.handleInput?.('\r')
      await expect(picked).resolves.toBe('max')
    } finally { tui.stop() }
  })

  it('focuses the configured default and cancels without a selection', async () => {
    const { tui, picked, panel, text } = open()
    try {
      expect(text()).toContain('→ 1. Low (current, default)')
      panel?.handleInput?.('\x1b')
      await expect(picked).resolves.toBeUndefined()
      expect(tui.hasOverlay()).toBe(false)
    } finally { tui.stop() }
  })

  it('uses only binary controls and keeps labels readable in a narrow terminal', async () => {
    const binary: LlmResolvedModelInfo = {
      ...model, name: 'Binary model',
      reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }, { id: ReasoningEffortId('high'), name: 'High' }] },
    }
    const { tui, picked, panel, text } = open(binary, 'off')
    try {
      expect(text()).toContain('Enable thinking')
      expect(text()).not.toContain('Medium')
      expect(text(35)).toContain('1. Off (current)')
      expect(text(35)).toContain('2. High')
      panel?.handleInput?.('\x1b[B')
      panel?.handleInput?.('\r')
      await expect(picked).resolves.toBe('high')
    } finally { tui.stop() }
  })

  it('preserves provider descriptions and omits an unsupported inherited effort', async () => {
    const sparse: LlmResolvedModelInfo = {
      ...model, reasoning: { efforts: [{ id: ReasoningEffortId('max'), name: 'Maximum', description: 'Gateway-specific mode' }] },
    }
    const { tui, picked, panel, text } = open(sparse, 'medium')
    try {
      expect(text()).toContain('Maximum')
      expect(text()).toContain('Gateway-specific mode')
      expect(text()).not.toContain('(current)')
      expect(text()).not.toContain('(default)')
      panel?.handleInput?.('\x1b')
      await expect(picked).resolves.toBeUndefined()
    } finally { tui.stop() }
  })

  it('does not invent controls for models without reasoning metadata', async () => {
    const { tui, picked, panel } = open({ provider: model.provider, id: model.id, name: model.name })
    await expect(picked).resolves.toBeUndefined()
    expect(panel).toBeUndefined()
    expect(tui.hasOverlay()).toBe(false)
    tui.stop()
  })
})
