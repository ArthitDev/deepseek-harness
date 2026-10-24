/** Register the executed-commands page tab and its live session-event read with the sidebar. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: each merge must be in the program for the register calls to type.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { EXEC_ID, execDefinition } from './definition.tsx'
import { ExecBody } from './ExecBody.tsx'
import { ExecTitle } from './ExecTitle.tsx'
import type { ExecInjected } from './face.ts'
import { en, zh } from './locales.ts'

/** Services needed by the exec panel's two sidebar seats. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sessions']

/** Event window shown while no session binding is retained: permanently empty. */
const NO_EVENTS: HostObservable<SessionEventWindow> = {
  getSnapshot: () => ({ entries: [], hasMore: false, revision: 0, change: { kind: 'replace' as const, entries: [] } }),
  subscribe: () => () => {},
}

/**
 * Register the exec tab type, its dictionaries, its body, and its chip title.
 * @param ctx - Client root Context with the sidebar, slot, locale, and Session services.
 */
export function apply(ctx: Context): void {
  const namespace = 'sidebarExec'
  const id = EXEC_ID
  const t = ctx.locale.bind(namespace)
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'ui-sidebar-exec.copy')
  ctx.effect(() => ctx.sidebarRightTabs.register(execDefinition(t)), 'ui-sidebar-exec.type')
  const inject = (sessionId: SessionId): ExecInjected => ({
    hooks: { events: ctx.sessions.binding(sessionId)?.eventSource ?? NO_EVENTS },
  })
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: id, locale: namespace, inject }, ExecBody,
  )), 'ui-sidebar-exec.body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: id, locale: namespace, inject }, ExecTitle,
  )), 'ui-sidebar-exec.title')
}
