// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { BootPage } from '../src/boot-page.ts'

afterEach(() => {
  document.body.innerHTML = ''
  document.querySelector('[data-test-favicon]')?.remove()
  localStorage.clear()
})

function mount() {
  const el = document.createElement('div')
  document.body.append(el)
  return { el, page: new BootPage(el) }
}

describe('BootPage', () => {
  it('draws the loading skeleton before any plugin state arrives', () => {
    const { el } = mount()
    expect(el.firstElementChild?.getAttribute('data-dsh-boot')).toBe('')
    expect(el.firstElementChild?.getAttribute('data-dsh-agent-mode')).toBe('red')
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/new-logo.png')
    expect(el.textContent).toContain('Red Team Agent')
    expect(el.textContent).toContain('Loading plugins…')
  })

  it.each([
    ['blue', '/new-logo-blue.png', 'Blue Team Agent', 'rgb(0 153 255 / 70%)'],
    ['red', '/new-logo.png', 'Red Team Agent', 'rgb(255 51 71 / 70%)'],
    ['black', '/new-logo-black.png', 'Black Team Agent', 'rgb(255 255 255 / 55%)'],
  ])('uses the saved %s team loading brand', (mode, logo, title, glow) => {
    const favicon = document.createElement('link')
    favicon.rel = 'icon'
    favicon.dataset.testFavicon = ''
    document.head.append(favicon)
    localStorage.setItem('dsh.agentMode', mode)
    const { el } = mount()
    expect(el.firstElementChild?.getAttribute('data-dsh-agent-mode')).toBe(mode)
    expect(el.querySelector('img')?.getAttribute('src')).toBe(logo)
    expect(favicon.getAttribute('href')).toBe(logo)
    expect(el.textContent).toContain(title)
    expect((el.firstElementChild as HTMLElement).style.getPropertyValue('--dsh-agent-glow')).toBe(glow)
  })

  it('keeps loading while entries are active or loading', () => {
    const { el, page } = mount()
    page.setTotal(2)
    const spinner = el.querySelector<HTMLElement>('[data-dsh-boot-spinner]')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('72deg')
    page.setState('a', 'active')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('180deg')
    page.setState('b', 'loading')
    expect(el.querySelector('[data-dsh-boot-spinner]')).toBe(spinner)
    page.setState('b', 'active')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('288deg')
    expect(el.textContent).toContain('Loading plugins…')
    expect(el.textContent).not.toContain('Failed to load plugins')
  })

  it('lists failed entries', () => {
    const { el, page } = mount()
    page.setState('@deepseek-ai/dsh-client-ui-layout', 'failed')
    page.setState('ok', 'active')
    page.setState('@deepseek-ai/dsh-client-ui-tool', 'failed')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-layout')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-tool')
    expect(el.textContent).not.toContain('ok')
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('shows the complete sweep report', () => {
    const { el, page } = mount()
    const report = 'web boot: 1 entry did not activate\nx: pending (waiting for service: y)'
    page.fail(report)
    page.setState('a', 'active')
    expect(el.textContent).toContain(report)
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('detaches on disposal', () => {
    const { el, page } = mount()
    page.dispose()
    expect(el.childNodes).toHaveLength(0)
  })
})
