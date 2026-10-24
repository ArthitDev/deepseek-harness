/** The visible session's event window, resolved by the sidebar slot's session inject. */
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** The exec page takes no parameters. */
    exec: Record<string, never>
  }
}

/** The exec panel's live read face: the session's event window observable. */
export interface ExecInjected {
  readonly hooks: {
    /** @returns the session's event window; a permanently empty one while no binding is retained. */
    readonly events: HostObservable<SessionEventWindow>
  }
}
