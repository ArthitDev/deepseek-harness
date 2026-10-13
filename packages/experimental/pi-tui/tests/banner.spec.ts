import chalk from 'chalk'
import { describe, expect, it } from 'vitest'
import { buildBanner } from '../src/ui/banner.ts'
import { BRAND_RED } from '../src/ui/theme.ts'

chalk.level = 1

describe('buildBanner', () => {
  it('opens with the wordmark and version over the session facts', () => {
    const banner = buildBanner({ version: '0.4.1', model: 'deepseek-v4-flash', preset: 'standard', cwd: 'proj' })
    expect(banner).toContain('S H I E L D   B R E A K   A G E N T')
    expect(banner).toContain('v0.4.1')
    expect(banner).toContain('model: deepseek-v4-flash')
    expect(banner).toContain('preset: standard')
    expect(banner).toContain('cwd: proj')
    expect(banner).toContain('Esc interrupt')
  })

  it('omits the version and absent facts', () => {
    const banner = buildBanner({})
    expect(banner).toContain('S H I E L D   B R E A K   A G E N T')
    expect(banner).not.toContain('v0')
    expect(banner).not.toContain('preset:')
    expect(banner).not.toContain('cwd:')
  })

  it('paints the wordmark with the brand red', () => {
    const banner = buildBanner({ version: '0.4.1' })
    expect(banner).toContain(chalk.hex(BRAND_RED).bold('⧉  S H I E L D   B R E A K   A G E N T'))
  })
})
