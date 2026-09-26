import { describe, expect, it } from 'vitest'
import {
  findRow, globalEnablement, globalToggleAllowed, presetEnablement, readRows, revision,
} from '../src/enablement.ts'

describe('plugin enablement documents', () => {
  it('preserves prompt strings and expressions when editing a nested plugin', () => {
    const source = '- id: group\n  name: cordis:group\n  group: true\n  config:\n    - id: test\n      name: test-module\n      config:\n        text: "colon: value\\nsecond line"\n        port: !!js ctx.port\n'
    const row = findRow(readRows(presetEnablement(source, 'test', 'test-module', false)), 'test', 'test-module')
    expect(row.disabled).toBe(true)
    expect(row.config).toEqual({ text: 'colon: value\nsecond line', port: { __jsExpr: 'ctx.port' } })
  })

  it('rejects missing, duplicate, conditional and ancestor-disabled rows', () => {
    const row = { id: 'x', name: 'x' }
    expect(() => findRow([], 'x', 'x')).toThrow('missing')
    expect(() => findRow([row, row], 'x', 'x')).toThrow('ambiguous')
    expect(() => findRow([{ ...row, disabled: { __jsExpr: 'true' } }], 'x', 'x')).toThrow('expression')
    expect(() => findRow([{ group: true, disabled: true, config: [row] }], 'x', 'x')).toThrow('group')
    expect(() => readRows('invalid: document')).toThrow('array')
  })

  it.each(['[]\n', '[{id: other, disabled: true}]\n', '- id: other\n  disabled: true\n'])('stores a narrow override in supported YAML forms', (source) => {
    const rows = readRows(globalEnablement(source, 'x', 'module-x', false))
    expect(rows.at(-1)).toEqual({ id: 'x', name: 'module-x', disabled: true })
    expect(rows.slice(0, -1)).toEqual(readRows(source))
  })

  it('retains comments and rejects infrastructure toggles', () => {
    const source = '# user comment\n- id: other\n  disabled: false\n'
    expect(globalEnablement(source, 'x', 'x', true)).toContain(source)
    expect(globalToggleAllowed('webserver', '@deepseek-ai/dsh-host-webserver')).toBe(false)
    expect(globalToggleAllowed('tool-fs', '@deepseek-ai/dsh-tool-fs')).toBe(true)
    expect(revision('a')).not.toBe(revision('b'))
  })
})
