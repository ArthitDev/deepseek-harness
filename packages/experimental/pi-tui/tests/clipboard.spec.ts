import { describe, expect, it } from 'vitest'
import { decodeOsc52, osc52Encode } from '../src/core/clipboard.ts'

describe('osc52Encode', () => {
  it('wraps UTF-8 text in an OSC 52 clipboard write', () => {
    expect(osc52Encode('hello')).toBe('\x1b]52;c;aGVsbG8=\x07')
    expect(osc52Encode('héllo')).toBe('\x1b]52;c;aMOpbGxv\x07')
  })
})

describe('decodeOsc52', () => {
  it('returns an empty array for data without OSC 52', () => {
    expect(decodeOsc52('plain text')).toEqual([])
    expect(decodeOsc52('\x1b]0;title\x07')).toEqual([])
  })

  it('decodes an encoded payload back to text', () => {
    expect(decodeOsc52(osc52Encode('copied text'))).toEqual(['copied text'])
  })

  it('decodes every payload in a multi-write stream', () => {
    const stream = `${osc52Encode('one')}${osc52Encode('two')}`
    expect(decodeOsc52(stream)).toEqual(['one', 'two'])
  })

  it('skips empty payloads', () => {
    expect(decodeOsc52('\x1b]52;c;\x07')).toEqual([])
  })

  it('skips payloads that decode to empty text', () => {
    expect(decodeOsc52('\x1b]52;c;=\x07')).toEqual([])
  })

  it('skips malformed payloads between two valid ones (best effort)', () => {
    const stream = `${osc52Encode('ok')}\x1b]52;c;not base64!!\x07${osc52Encode('also ok')}`
    expect(decodeOsc52(stream)).toEqual(['ok', 'also ok'])
  })
})
