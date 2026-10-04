import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../src/core/model.ts'
import { buildSearchIndex, itemSearchText, snippetOf } from '../src/core/search.ts'

const user = (id: number, text: string): ChatItem => ({ id, kind: 'user', text, streaming: false })
const assistant = (id: number, text: string): ChatItem => ({
  id,
  kind: 'assistant',
  text,
  streaming: false,
})

describe('itemSearchText', () => {
  it('returns message text for user, assistant, reasoning, and notice items', () => {
    expect(itemSearchText(user(0, 'prompt'))).toBe('prompt')
    expect(itemSearchText(assistant(0, 'reply'))).toBe('reply')
    expect(itemSearchText({ id: 0, kind: 'reasoning', text: 'thinking', streaming: true })).toBe('thinking')
    expect(itemSearchText({ id: 0, kind: 'notice', text: 'note', streaming: false })).toBe('note')
  })

  it('joins tool name, args, and the fullest result text', () => {
    const text = itemSearchText({
      id: 0,
      kind: 'tool',
      text: '',
      streaming: false,
      tool: {
        callId: 'c1',
        name: 'read_file',
        argsPreview: '{"path":"a.ts"}',
        status: 'ok',
        resultPreview: 'short',
        resultFull: 'the full file body',
      },
    })
    expect(text).toBe('read_file {"path":"a.ts"} the full file body')
  })

  it('falls back to the preview and then to empty for tool cards', () => {
    expect(
      itemSearchText({
        id: 0,
        kind: 'tool',
        text: '',
        streaming: false,
        tool: { callId: 'c1', name: 'bash', argsPreview: 'ls', status: 'running', resultPreview: 'out' },
      }),
    ).toBe('bash ls out')
    expect(
      itemSearchText({
        id: 0,
        kind: 'tool',
        text: '',
        streaming: false,
        tool: { callId: 'c1', name: 'bash', argsPreview: 'ls', status: 'running' },
      }),
    ).toBe('bash ls ')
    expect(itemSearchText({ id: 0, kind: 'tool', text: '', streaming: true })).toBe('')
  })
})

describe('snippetOf', () => {
  it('collapses whitespace and trims', () => {
    expect(snippetOf('  a\n\n  b\tc  ')).toBe('a b c')
  })

  it('truncates long text with an ellipsis', () => {
    expect(snippetOf('x'.repeat(120))).toBe(`${'x'.repeat(90)}…`)
    expect(snippetOf('x'.repeat(90))).toBe('x'.repeat(90))
  })
})

describe('buildSearchIndex', () => {
  it('matches nothing for a blank query', () => {
    expect(buildSearchIndex([user(0, 'hello')], '')).toEqual([])
    expect(buildSearchIndex([user(0, 'hello')], '   ')).toEqual([])
  })

  it('indexes one entry per matching item in transcript order, case-insensitively', () => {
    const items = [user(0, 'Find the needle here'), assistant(1, 'no match'), assistant(2, 'NEEDLE found')]
    const matches = buildSearchIndex(items, 'needle')
    expect(matches.map(match => match.itemId)).toEqual([0, 2])
    expect(matches[0]).toMatchObject({ kind: 'user', snippet: 'Find the needle here' })
    expect(matches[1]).toMatchObject({ kind: 'assistant' })
  })

  it('centers the snippet window on the match in long collapsed text', () => {
    const padding = 'y'.repeat(200)
    const items = [assistant(0, `${padding} target ${padding}`)]
    const [match] = buildSearchIndex(items, 'target')
    expect(match?.snippet.length).toBe(92) // 90 window chars plus both ellipses
    expect(match?.snippet.startsWith('…')).toBe(true)
    expect(match?.snippet.endsWith('…')).toBe(true)
    expect(match?.snippet).toContain('target')
  })

  it('omits the leading ellipsis when the match sits near the text start', () => {
    const items = [assistant(0, `target ${'y'.repeat(200)}`)]
    const [match] = buildSearchIndex(items, 'target')
    expect(match?.snippet.startsWith('target')).toBe(true)
    expect(match?.snippet.endsWith('…')).toBe(true)
  })

  it('omits the trailing ellipsis when the match window reaches the text end', () => {
    const items = [assistant(0, `${'y'.repeat(200)} target`)]
    const [match] = buildSearchIndex(items, 'target')
    expect(match?.snippet.startsWith('…')).toBe(true)
    expect(match?.snippet.endsWith('target')).toBe(true)
  })
})
