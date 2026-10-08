import chalk from 'chalk'
import { describe, expect, it } from 'vitest'
import { buildBanner } from '../src/ui/banner.ts'
import { logoLines } from '../src/ui/logo.ts'

chalk.level = 1

describe('buildBanner', () => {
  it('opens with the logo over the red product line', () => {
    const banner = buildBanner({ version: '0.4.1', model: 'deepseek-v4-flash', preset: 'standard', cwd: 'proj' })
    expect(banner.startsWith(logoLines().join('\n'))).toBe(true)
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

  it('paints the product line red, never the deepseek blue', () => {
    const banner = buildBanner({ version: '0.4.1' })
    expect(banner).toContain('\u001b[91mShield Break Agent v0.4.1\u001b[39m')
    expect(banner).not.toContain('#4fc1ff')
  })
})
