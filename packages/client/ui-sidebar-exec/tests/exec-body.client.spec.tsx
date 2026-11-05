// @vitest-environment jsdom
/** The executed-commands list: KALI/WIN classification, status pairing, and expansion. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { SessionEventLikeEntry, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ExecBody, type ExecBodyProps } from '../src/client/ExecBody.tsx'
import { ExecTitle, type ExecTitleProps } from '../src/client/ExecTitle.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

function at(seq: number, type: string, data: unknown): SessionEvent {
  return { seq: SessionSeq(seq), time: 1_700_000_000_000 + seq, type, data } as SessionEvent
}

function event(event: SessionEvent): SessionEventLikeEntry {
  return { type: 'event', event }
}

function windowOf(entries: readonly SessionEventLikeEntry[], hasMore = false): SessionEventWindow {
  return { entries, hasMore, revision: entries.length, change: { kind: 'replace', entries } }
}

/** One settled bash command on Windows, one failed Kali route, one still-running persistent Kali send. */
const FIXTURE: readonly SessionEventLikeEntry[] = [
  event(at(1, 'tool/call', { turn: 1, step: 1, callId: 'win-1', name: 'bash', arguments: '{"command":"ipconfig /all"}' })),
  event(at(2, 'tool/result', { turn: 1, step: 1, message: {
    source: { type: 'tool-result', callId: 'win-1' }, content: [{ type: 'text', text: 'Ethernet adapter:' }], isError: false,
  } })),
  event(at(3, 'tool/call', { turn: 1, step: 2, callId: 'kali-1', name: 'pwsh', arguments: '{"command":"wsl -d kali-linux nmap -sV 10.0.0.5"}' })),
  event(at(4, 'tool/result', { turn: 1, step: 2, message: {
    source: { type: 'tool-result', callId: 'kali-1' }, content: [{ type: 'text', text: 'Host seems down.' }], isError: true,
  } })),
  event(at(5, 'tool/call', { turn: 2, step: 1, callId: 'kali-2', name: 'bash-persistent', arguments: '{"send":"wsl -d kali-linux whoami"}' })),
]

function mountBody(window: SessionEventWindow, dictionary: typeof en = en) {
  const props = {
    useEvents: (select: (value: SessionEventWindow) => unknown) => select(window),
    t: makeTranslate(dictionary),
  } as unknown as ExecBodyProps
  return render(<ExecBody {...props} />)
}

it('renders a KALI row and a WIN row with paired status glyphs, newest first', () => {
  const view = mountBody(windowOf(FIXTURE))
  const rows = view.container.querySelectorAll('[data-exec-shell]')
  expect(rows).toHaveLength(3)
  expect([...rows].map(row => [row.getAttribute('data-exec-shell'), row.getAttribute('data-exec-status')])).toEqual([
    ['kali', 'running'], ['kali', 'error'], ['windows', 'ok'],
  ])
  expect([...rows].map(row => row.querySelector('span[class*=status]')?.textContent)).toEqual(['…', '✗', '✓'])
  expect([...rows].map(row => row.querySelector('span[class*=shell]')?.textContent)).toEqual(['KALI', 'KALI', 'WIN'])
  expect([...rows].map(row => row.querySelector('span[class*=command]')?.textContent)).toEqual([
    'wsl -d kali-linux whoami', 'wsl -d kali-linux nmap -sV 10.0.0.5', 'ipconfig /all',
  ])
  expect(view.queryByText(en.truncated)).toBeNull()
})

it('expands one row at a time with the full command and the paired result text', () => {
  const view = mountBody(windowOf(FIXTURE))
  expect(view.container.querySelector('[data-exec-command]')).toBeNull()
  const rows = [...view.container.querySelectorAll('button[class*=row]')]
  const details = (): [string | undefined, string | undefined] => [
    view.container.querySelector('[data-exec-command]')?.textContent,
    view.container.querySelector('[data-exec-result]')?.textContent,
  ]
  fireEvent.click(rows[2]!)
  expect(details()).toEqual(['ipconfig /all', 'Ethernet adapter:'])
  fireEvent.click(rows[1]!)
  expect(details()).toEqual(['wsl -d kali-linux nmap -sV 10.0.0.5', 'Host seems down.'])
  fireEvent.click(rows[0]!)
  expect(details()).toEqual(['wsl -d kali-linux whoami', 'Still running.'])
  fireEvent.click(rows[0]!)
  expect(view.container.querySelector('[data-exec-command]')).toBeNull()
})

it('reports truncated history and a textless result in copy, and renders the empty state', () => {
  const view = mountBody(windowOf([FIXTURE[0]!, FIXTURE[1]!], true))
  expect(view.getByText(en.truncated)).toBeDefined()
  fireEvent.click(view.container.querySelector('button[class*=row]')!)
  expect(view.getByText('Ethernet adapter:')).toBeDefined()
  const textless = mountBody(windowOf([event(at(6, 'tool/call', {
    turn: 1, step: 1, callId: 'quiet', name: 'bash', arguments: '{"command":"true"}',
  })), event(at(7, 'tool/result', { turn: 1, step: 1, message: {
    source: { type: 'tool-result', callId: 'quiet' }, content: [], isError: false,
  } }))]))
  fireEvent.click(textless.container.querySelector('button[class*=row]')!)
  expect(textless.getByText(en.resultEmpty)).toBeDefined()
  const empty = mountBody(windowOf([]))
  expect(empty.getByRole('status').textContent).toBe(en.empty)
})

it.each([en, zh])('renders the whole list and the live chip count in either locale', (dictionary) => {
  const view = mountBody(windowOf(FIXTURE), dictionary)
  const rows = [...view.container.querySelectorAll('[data-exec-shell]')]
  expect(rows.map(row => row.querySelector('span[class*=shell]')?.textContent))
    .toEqual([dictionary.shellKali, dictionary.shellKali, dictionary.shellWin])
  const titleProps = {
    useTabInfo: () => ({ tab: { title: dictionary.type } }),
    useEvents: (select: (value: SessionEventWindow) => unknown) => select(windowOf(FIXTURE)),
    t: makeTranslate(dictionary),
  } as unknown as ExecTitleProps
  const title = render(<ExecTitle {...titleProps} />)
  expect(title.container.textContent).toBe(dictionary.chip.replace('{count}', '3'))
  const idleTitle = render(<ExecTitle {...{
    ...titleProps,
    useEvents: (select: (value: SessionEventWindow) => unknown) => select(windowOf([])),
  } as unknown as ExecTitleProps} />)
  expect(idleTitle.container.textContent).toBe(dictionary.type)
})
