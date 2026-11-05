import { describe, expect, it } from 'vitest'
import { classifyRowSpecifier } from '../src/specifier.ts'

describe('classifyRowSpecifier', () => {
  it('keeps presets authored before workflow-ptc usable', () => {
    expect(classifyRowSpecifier('@deepseek-ai/dsh-workflow-worker-thread')).toEqual({
      kind: 'package',
      specifier: '@deepseek-ai/dsh-workflow-ptc',
    })
  })
})
