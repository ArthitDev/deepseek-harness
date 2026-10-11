import chalk from 'chalk'
import { describe, expect, it } from 'vitest'
import { buildBanner } from '../src/ui/banner.ts'
import { gradient } from '../src/ui/theme.ts'

chalk.level = 1

describe('buildBanner', () => {
  it('opens with the gradient wordmark over the session facts', () => {
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

  it('paints the wordmark with the brand gradient, never the deepseek blue', () => {
    const banner = buildBanner({ version: '0.4.1' })
    expect(banner).toContain(gradient('Shield Break Agent v0.4.1', '#ff4655', '#ff9a3d'))
    expect(banner).not.toContain('#4fc1ff')
  })
})
