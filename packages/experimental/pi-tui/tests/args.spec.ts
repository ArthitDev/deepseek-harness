import { describe, expect, it } from 'vitest'
import { parseArgs, USAGE } from '../src/args.ts'

describe('parseArgs', () => {
  it('parses no flags into defaults', () => {
    expect(parseArgs([])).toEqual({
      pickSession: false,
      pickPreset: false,
      help: false,
      unknown: [],
    })
  })

  it('reads --resume with a value as the session id', () => {
    expect(parseArgs(['--resume', 'abc'])).toMatchObject({ resumeId: 'abc', pickSession: false })
    expect(parseArgs(['-r', 'abc'])).toMatchObject({ resumeId: 'abc' })
  })

  it('treats --resume without a value or before a flag as the picker gesture', () => {
    const bare = parseArgs(['--resume'])
    expect(bare.resumeId).toBeUndefined()
    expect(bare.pickSession).toBe(true)
    expect(parseArgs(['-r']).pickSession).toBe(true)
    expect(parseArgs(['--resume', '--preset', 'x'])).toMatchObject({ pickSession: true, preset: 'x' })
  })

  it('reads --preset with a value and flags the picker gesture without one', () => {
    expect(parseArgs(['--preset', 'standard'])).toMatchObject({ preset: 'standard', pickPreset: false })
    expect(parseArgs(['-p', 'standard'])).toMatchObject({ preset: 'standard' })
    expect(parseArgs(['--preset']).pickPreset).toBe(true)
    expect(parseArgs(['--preset', '-r']).pickPreset).toBe(true)
  })

  it('reads --machine only with a value; otherwise reports it unknown', () => {
    expect(parseArgs(['--machine', 'box-1'])).toMatchObject({ machine: 'box-1', unknown: [] })
    const bare = parseArgs(['--machine'])
    expect(bare.machine).toBeUndefined()
    expect(bare.unknown).toEqual(['--machine'])
  })

  it('recognizes --help and -h', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
  })

  it('collects unrecognized tokens in order', () => {
    expect(parseArgs(['extra', '--resume', 'id', '--nope']).unknown).toEqual(['extra', '--nope'])
  })

  it('does not consume a flag-looking token as a value', () => {
    const args = parseArgs(['--resume', '--machine'])
    expect(args.resumeId).toBeUndefined()
    expect(args.pickSession).toBe(true)
    expect(args.unknown).toEqual(['--machine'])
  })
})

describe('USAGE', () => {
  it('documents the profile invocations', () => {
    expect(USAGE).toContain('dsh --profile pi-tui')
    expect(USAGE).toContain('--resume')
    expect(USAGE).toContain('--preset')
    expect(USAGE).toContain('--machine')
  })
})
