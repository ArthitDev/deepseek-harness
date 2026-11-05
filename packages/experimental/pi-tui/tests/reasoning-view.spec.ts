import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { Container, type TuiMouseEvent } from '@earendil-works/pi-tui'
import type { ChatItem } from '../src/core/model.ts'
import { ReasoningView } from '../src/ui/views.ts'
import { style } from '../src/ui/theme.ts'

const click: TuiMouseEvent = {
  type: 'click', button: 'left', x: 1, y: 0, screenX: 6, screenY: 10,
  width: 80, height: 2, shift: false, alt: false, ctrl: false,
}
const text = (view: ReasoningView): string => stripVTControlCharacters(view.render(80).join('\n'))

describe('reasoning sections', () => {
  it('renders live reasoning as muted Markdown and restores it after a find', () => {
    const item: ChatItem = { id: 0, kind: 'reasoning', text: '**ตรวจสอบ** แล้ว', streaming: true }
    const view = new ReasoningView(item)
    view.updateFromItem(undefined)
    expect(text(view)).toContain('▾ Thinking')
    expect(text(view)).toContain('   ตรวจสอบ แล้ว')
    expect(text(view)).not.toContain('**')
    view.updateFromItem(undefined, 'ตรวจสอบ')
    expect(text(view)).toContain('**ตรวจสอบ**')
    view.updateFromItem(undefined)
    expect(text(view)).not.toContain('**')
    view.setExpanded(true)
    const live = view.render(80)
    item.streaming = false
    view.updateFromItem(undefined)
    expect(view.render(80)).toEqual(live)
  })

  it('labels and indents live reasoning from the first delta, then folds when sealed', () => {
    const item: ChatItem = { id: 0, kind: 'reasoning', text: 'กำลังคิด', streaming: true }
    const view = new ReasoningView(item)
    view.updateFromItem(undefined)
    expect(text(view)).toContain('▾ Thinking')
    expect(text(view)).toContain('\n   กำลังคิด')
    expect(view.render(80).join('\n')).toContain(style.muted('กำลังคิด'))
    item.text += 'ต่อ'
    view.updateFromItem(undefined)
    expect(text(view)).toContain('กำลังคิดต่อ')
    item.streaming = false
    view.updateFromItem(undefined)
    expect(text(view)).toContain('▸ Thinking')
    expect(text(view)).not.toContain('กำลังคิดต่อ')
    expect(view.render(80)).toHaveLength(1)
  })

  it('folds one live section on header click and retains updates and explicit expansion after sealing', () => {
    const item: ChatItem = { id: 0, kind: 'reasoning', text: 'first thought', streaming: true }
    const view = new ReasoningView(item)
    const other = new ReasoningView({ id: 1, kind: 'reasoning', text: 'other thought', streaming: true })
    view.updateFromItem(undefined)
    other.updateFromItem(undefined)
    const host = new Container()
    host.addChild(view)
    host.render(80)
    const result = host.handleMouse(click)
    expect(result?.handled).toBe(true)
    expect(result?.target).toMatchObject({ component: view, originX: 5, originY: 10 })
    expect(text(view)).toContain('▸ Thinking')
    expect(text(view)).not.toContain('first thought')
    expect(text(other)).toContain('other thought')
    item.text += ' and latest thought'
    view.updateFromItem(undefined)
    expect(text(view)).not.toContain('latest thought')
    view.handleMouse(click)
    expect(text(view)).toContain('first thought and latest thought')
    item.streaming = false
    view.updateFromItem(undefined)
    expect(text(view)).toContain('▾ Thinking')
    expect(text(view)).toContain('latest thought')
    view.setExpanded(false)
    expect(text(view)).not.toContain('latest thought')
  })

  it('leaves scrolling, selection, and body clicks available without folding', () => {
    const view = new ReasoningView({ id: 0, kind: 'reasoning', text: 'visible thought', streaming: true })
    view.updateFromItem(undefined)
    view.render(80)
    for (const event of [
      { ...click, y: 1 }, { ...click, button: 'right' as const },
      { ...click, type: 'wheel' as const }, { ...click, type: 'drag' as const },
      { ...click, shift: true },
    ]) {
      expect(view.handleMouse(event)).toBeUndefined()
      expect(text(view)).toContain('visible thought')
    }
  })
})
