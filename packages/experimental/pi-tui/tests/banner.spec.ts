import chalk from 'chalk'
import { describe, expect, it } from 'vitest'
import { buildBanner } from '../src/ui/banner.ts'

chalk.level = 1

describe('buildBanner', () => {
  it('opens with the red product line and session facts', () => {
    const banner = buildBanner({ version: '0.4.1', model: 'deepseek-v4-flash', preset: 'standard', cwd: 'proj' })
    expect(banner.startsWith('\u001b[91mShield Break Agent v0.4.1')).toBe(true)
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
