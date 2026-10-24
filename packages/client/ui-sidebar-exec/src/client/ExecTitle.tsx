/** Executed-command count in the tab chip, live with the session's event window. */
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { collectExecHistory } from './exec-history.ts'
import type { ExecInjected } from './face.ts'
import type {} from './locales.ts'

/** The title's composed props: the framework runtime seat, its injected window, and its copy. */
export type ExecTitleProps =
  & PropsRuntime<'sidebar.right.pane.tab.title'>
  & PropsLocale<'sidebarExec'>
  & InjectFace<ExecInjected>

/**
 * Render the chip title: the count once any command ran, else the captured title.
 * @param props - framework runtime seat, the session's event window, and copy.
 * @returns the localized title with its live command count.
 */
export function ExecTitle({ useTabInfo, useEvents, t }: ExecTitleProps): ReactNode {
  const { tab } = useTabInfo()
  const count = collectExecHistory(useEvents(current => current).entries).length
  return <>{count > 0 ? t('chip', { count }) : tab.title}</>
}
