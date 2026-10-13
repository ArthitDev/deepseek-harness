import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { Markdown, visibleWidth } from '@earendil-works/pi-tui'
import type { ChatItem } from '../src/core/model.ts'
import { AssistantMessageView } from '../src/ui/views.ts'
import { markdownTheme } from '../src/ui/theme.ts'

const text = (view: AssistantMessageView): string => stripVTControlCharacters(
  view.render(80).map(line => line.trimEnd()).join('\n'),
)

describe('live assistant Markdown', () => {
  it('retains the Markdown cache across unchanged updates and completion', () => {
    const item: ChatItem = { id: 0, kind: 'assistant', text: '**cached**', streaming: true }
    const view = new AssistantMessageView(item)
    view.updateFromItem()
    view.render(80)
    const setText = vi.spyOn(Markdown.prototype, 'setText')
    try {
      for (let frame = 0; frame < 100; frame++) {
        view.updateFromItem()
        view.render(80)
      }
      item.streaming = false
      view.updateFromItem()
      expect(setText).not.toHaveBeenCalled()
      item.text = '**corrected**'
      view.updateFromItem()
      expect(text(view)).toContain('corrected')
      expect(setText).toHaveBeenCalledTimes(1)
    } finally {
      setText.mockRestore()
    }
  })

  it('formats a streamed answer before completion and preserves its layout when sealed', () => {
    const item: ChatItem = { id: 0, kind: 'assistant', text: '**พร้อม**\n\n- ตรวจโค้ด\n- ทดสอบ', streaming: true }
    const view = new AssistantMessageView(item)
    view.updateFromItem()
    const live = text(view)
    expect(live).toMatchInlineSnapshot(`
      " พร้อม

       - ตรวจโค้ด
       - ทดสอบ"
    `)
    item.streaming = false
    view.updateFromItem()
    expect(text(view)).toBe(live)
  })

  it('keeps code visible and stable while its closing fence arrives one character at a time', () => {
    const item: ChatItem = { id: 0, kind: 'assistant', text: '```ts\nconst ready = true;\n', streaming: true }
    const view = new AssistantMessageView(item)
    view.updateFromItem()
    const open = view.render(80)
    expect(text(view)).toContain('const ready = true;')
    for (const marker of ['`', '`', '`']) {
      item.text += marker
      view.updateFromItem()
      expect(view.render(80)).toEqual(open)
    }
    item.streaming = false
    view.updateFromItem()
    expect(view.render(80)).toEqual(open)
  })

  it('reinterprets incomplete inline syntax and reference links without changing the source', () => {
    const item: ChatItem = { id: 0, kind: 'assistant', text: '**กำลัง', streaming: true }
    const view = new AssistantMessageView(item)
    view.updateFromItem()
    expect(text(view)).toContain('กำลัง')
    item.text += 'ตอบ**\n\n[คู่มือ][docs]\n\n[docs]: https://example.com'
    view.updateFromItem()
    expect(text(view)).toContain('กำลังตอบ')
    expect(text(view)).not.toContain('**')
    expect(text(view)).not.toContain('[คู่มือ][docs]')
    expect(item.text).toContain('**กำลังตอบ**')
    const final = new Markdown(item.text, 1, 0, markdownTheme)
    expect(view.render(80)).toEqual(final.render(80))
  })

  it('renders growing tables within the viewport and restores Markdown after finding source text', () => {
    const item: ChatItem = { id: 0, kind: 'assistant', text: '| ชื่อ | ผล |\n| --- | --- |\n| **หนึ่ง** | ผ่าน |', streaming: true }
    const view = new AssistantMessageView(item)
    view.updateFromItem()
    expect(text(view)).toContain('หนึ่ง')
    expect(text(view)).not.toContain('**หนึ่ง**')
    item.text += '\n| ยาว'.repeat(5)
    view.updateFromItem()
    for (const width of [20, 80]) {
      expect(view.render(width).every(line => visibleWidth(line) <= width)).toBe(true)
    }
    view.updateFromItem('หนึ่ง')
    expect(text(view)).toContain('**หนึ่ง**')
    view.updateFromItem()
    expect(text(view)).not.toContain('**หนึ่ง**')
  })
})
