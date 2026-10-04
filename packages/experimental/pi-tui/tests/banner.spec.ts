import { describe, expect, it } from 'vitest'
import { buildBanner } from '../src/ui/banner.ts'

describe('buildBanner', () => {
  it('shows the product line with the running version', () => {
    const banner = buildBanner({ version: '0.4.1', model: 'deepseek-v4-flash', preset: 'standard', cwd: 'proj' })
    expect(banner).toContain('Shield Break Agent v0.4.1')
    expect(banner).toContain('model: deepseek-v4-flash')
    expect(banner).toContain('preset: standard')
    expect(banner).toContain('cwd: proj')
    expect(banner).toContain('Esc interrupt')
  })

  it('omits the version and absent facts', () => {
    const banner = buildBanner({})
    expect(banner).toContain('Shield Break Agent')
    expect(banner).not.toContain('v0')
    expect(banner).not.toContain('preset:')
    expect(banner).not.toContain('cwd:')
  })
})
