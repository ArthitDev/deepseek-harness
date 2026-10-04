import { describe, expect, it } from 'vitest'
import { buildBanner, SHIELD_ART } from '../src/ui/banner.ts'

describe('buildBanner', () => {
  it('always shows the product line and key hints', () => {
    const banner = buildBanner({})
    expect(banner).toContain('Shield Break TUI')
    expect(banner).toContain('Esc interrupt')
  })

  it('lists the model, preset, and cwd facts when present', () => {
    const banner = buildBanner({ cwd: 'proj', preset: 'standard', model: 'deepseek-v4-flash' })
    expect(banner).toContain('model: deepseek-v4-flash')
    expect(banner).toContain('preset: standard')
    expect(banner).toContain('cwd: proj')
  })

  it('omits absent facts and carries the shield art verbatim', () => {
    const banner = buildBanner({ model: 'm' })
    expect(banner).not.toContain('preset:')
    expect(banner).not.toContain('cwd:')
    expect(banner).toContain(SHIELD_ART)
  })
})

describe('SHIELD_ART', () => {
  it('renders 8 half-block rows with the bolt shaft and baked colors', () => {
    const rows = SHIELD_ART.split('\n')
    expect(rows.length).toBe(8)
    expect(rows.join('')).toContain('\u2588')
    // Baked truecolor codes: bright-red shield (91), white bolt shaft (97).
    expect(SHIELD_ART).toContain('\u001b[91m')
    expect(SHIELD_ART).toContain('\u001b[97m')
  })
})
