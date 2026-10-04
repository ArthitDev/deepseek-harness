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
  it('renders a multi-line pre-colored shield', () => {
    expect(SHIELD_ART.split('\n').length).toBeGreaterThan(5)
    expect(SHIELD_ART).toContain('████')
  })
})
