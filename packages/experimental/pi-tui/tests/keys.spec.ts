import { describe, expect, it } from 'vitest'
import { ctrlC, cycleEffort, isPathLikeToken, parseBang, parseSlash } from '../src/core/keys.ts'

describe('ctrlC', () => {
  it('cancels the running turn while working and keeps the arm state', () => {
    const state = { lastPressAt: 1000 }
    expect(ctrlC(state, true, true, 2000)).toEqual({ action: 'cancel', state, arm: false })
  })

  it('clears the editor when idle with text, arming the exit window', () => {
    const result = ctrlC({ lastPressAt: 0 }, false, true, 5000)
    expect(result.action).toBe('clear')
    expect(result.state).toEqual({ lastPressAt: 5000 })
    expect(result.arm).toBe(true)
  })

  it('exits on the second press inside the arm window', () => {
    const result = ctrlC({ lastPressAt: 10_000 }, false, false, 10_400)
    expect(result.action).toBe('exit')
    expect(result.state).toEqual({ lastPressAt: 0 })
    expect(result.arm).toBe(false)
  })

  it('arms a fresh exit window after the previous one expired', () => {
    const result = ctrlC({ lastPressAt: 10_000 }, false, false, 10_501)
    expect(result.action).toBe('arm')
    expect(result.state).toEqual({ lastPressAt: 10_501 })
    expect(result.arm).toBe(true)
  })
})

describe('cycleEffort', () => {
  const efforts = [{ id: 'off' }, { id: 'high' }, { id: 'max' }]

  it('returns undefined for an empty effort list', () => {
    expect(cycleEffort([], 'high')).toBeUndefined()
  })

  it('wraps to the first effort past the end', () => {
    expect(cycleEffort(efforts, 'max')).toBe('off')
  })

  it('steps to the next effort in the list', () => {
    expect(cycleEffort(efforts, 'off')).toBe('high')
  })

  it('starts from the first effort when the current one is unknown', () => {
    expect(cycleEffort(efforts, 'medium')).toBe('off')
    expect(cycleEffort(efforts, undefined)).toBe('off')
  })
})

describe('parseSlash', () => {
  it('rejects non-slash lines', () => {
    expect(parseSlash('hello')).toBeUndefined()
  })

  it('splits a bare command from no input', () => {
    expect(parseSlash('/new')).toEqual({ name: 'new', raw: '' })
  })

  it('lower-cases the command name and keeps the raw remainder', () => {
    expect(parseSlash('/Model deep')).toEqual({ name: 'model', raw: ' deep' })
  })
})

describe('isPathLikeToken', () => {
  it('accepts mention, hidden, home, and path-shaped tokens', () => {
    expect(isPathLikeToken('@file')).toBe(true)
    expect(isPathLikeToken('.hidden')).toBe(true)
    expect(isPathLikeToken('~/notes')).toBe(true)
    expect(isPathLikeToken('a/b')).toBe(true)
    expect(isPathLikeToken('read.me')).toBe(true)
  })

  it('rejects plain words', () => {
    expect(isPathLikeToken('hello')).toBe(false)
  })
})

describe('parseBang', () => {
  it('rejects non-bang lines and bare bangs', () => {
    expect(parseBang('ls')).toBeUndefined()
    expect(parseBang('!')).toBeUndefined()
    expect(parseBang('!!   ')).toBeUndefined()
  })

  it('parses a context-joining command', () => {
    expect(parseBang('!git status')).toEqual({ command: 'git status', excluded: false })
  })

  it('parses an excluded double-bang command', () => {
    expect(parseBang('!!rm -rf /')).toEqual({ command: 'rm -rf /', excluded: true })
  })
})
