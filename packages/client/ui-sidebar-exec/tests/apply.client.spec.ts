// @vitest-environment jsdom
/** The exec tab type, its seats, and its session-event read follow the plugin lifetime. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId, type SessionId as SessionIdType } from '@deepseek-ai/dsh-session/types'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { ExecBody } from '../src/client/ExecBody.tsx'
import { ExecTitle } from '../src/client/ExecTitle.tsx'
import type { ExecInjected } from '../src/client/face.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const EMPTY_WINDOW: SessionEventWindow = {
  entries: [], hasMore: false, revision: 0, change: { kind: 'replace', entries: [] },
}

interface BindingSource {
  readonly eventSource: { getSnapshot(): SessionEventWindow; subscribe(fn: () => void): () => void }
}

async function mountPlugin(binding: BindingSource | undefined) {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  ctx.provide('sidebarRightTabs', tabs)
  const entries: {
    name: string
    key?: string
    locale: string
    component: unknown
    inject: (id: SessionIdType) => unknown
  }[] = []
  const dictionaries = new Map<string, unknown>()
  const sessions = { binding: vi.fn(() => binding) }
  ctx.provide('sessions', sessions as never)
  ctx.provide('slots', {
    inject: (_name: string, register: () => () => void) => register(),
    register: (options: Omit<typeof entries[number], 'component'>, component: unknown) => {
      const entry = { ...options, component }; entries.push(entry)
      return () => { entries.splice(entries.indexOf(entry), 1) }
    },
  } as never)
  ctx.provide('locale', {
    bind: () => (key: string) => key,
    register: (name: string, values: unknown) => { dictionaries.set(name, values); return () => { dictionaries.delete(name) } },
  } as never)
  const fiber = await ctx.plugin({ inject, apply })
  return {
    tabs, entries, dictionaries, sessions,
    async dispose() { await fiber.dispose(); await ctx.fiber.dispose() },
  }
}

it('registers the exec page type without guide-time opens, then releases contributions on unload', async () => {
  expect(hostApply).not.toThrow()
  const eventSource = { getSnapshot: () => EMPTY_WINDOW, subscribe: () => () => {} }
  const h = await mountPlugin({ eventSource })
  try {
    const definition = h.tabs.get('exec')!
    expect(definition.id).toBe('@deepseek-ai/dsh-client-ui-sidebar-exec')
    expect(definition.title('sidebar://exec')).toBe('type')
    expect(definition.multiple).toBe(false)
    expect(definition.priority).toBe('builtin')
    expect(h.dictionaries.get('sidebarExec')).toEqual({ en, zh })
    expect(h.entries.map(entry => [entry.name, entry.key, entry.component, entry.locale])).toEqual([
      ['sidebar.right.pane.tab', definition.id, ExecBody, 'sidebarExec'],
      ['sidebar.right.pane.tab.title', definition.id, ExecTitle, 'sidebarExec'],
    ])
    const sessionId = SessionId('session')
    const face = h.entries[0]!.inject(sessionId) as ExecInjected
    expect(face.hooks.events.getSnapshot()).toBe(EMPTY_WINDOW)
    expect(h.sessions.binding).toHaveBeenLastCalledWith(sessionId)
    const icon = definition.guide?.[0]?.icon
    if (icon === undefined) throw new Error('Exec guide icon was not registered')
    expect(renderToStaticMarkup(createElement(icon, { size: 22 }))).toContain('width="22"')
  } finally {
    await h.dispose()
  }
  expect(h.tabs.get('exec')).toBeUndefined()
  expect(h.entries).toEqual([])
  expect(h.dictionaries.size).toBe(0)
})

it('falls back to a permanently empty window while no session binding is retained', async () => {
  const h = await mountPlugin(undefined)
  try {
    const face = h.entries[0]!.inject(SessionId('session')) as ExecInjected
    expect(face.hooks.events.getSnapshot()).toEqual(EMPTY_WINDOW)
    let notified = 0
    const unsubscribe = face.hooks.events.subscribe(() => { notified += 1 })
    unsubscribe()
    expect(notified).toBe(0)
  } finally {
    await h.dispose()
  }
})
