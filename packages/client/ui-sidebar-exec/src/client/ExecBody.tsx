/** The executed-commands page: newest-first rows over the session's live event window. */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { collectExecHistory, type ExecEntry, type ExecStatus } from './exec-history.ts'
import type { ExecInjected } from './face.ts'
import type {} from './locales.ts'
import css from './ExecBody.module.css'

/** The body's composed props: the framework runtime seat, its injected window, and its copy. */
export type ExecBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'sidebarExec'>
  & InjectFace<ExecInjected>

/** Dictionary key of each settlement state's glyph. */
const STATUS_GLYPH_KEYS: Record<ExecStatus, 'statusOk' | 'statusError' | 'statusRunning'> = {
  ok: 'statusOk', error: 'statusError', running: 'statusRunning',
}

/** Row timestamps show the locale's own clock rendering of the event time. */
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** What every row shares: expansion state, its toggle, and the copy seat. */
interface RowContext {
  readonly expanded: boolean
  readonly onToggle: (callId: string) => void
  readonly t: TranslateNS<'sidebarExec'>
}

/** The expanded result's body: pending and textless results say so in copy. */
function resultBody(entry: ExecEntry, t: TranslateNS<'sidebarExec'>): string {
  if (entry.status === 'running') return t('resultPending')
  return entry.result === '' ? t('resultEmpty') : entry.result
}

/** One executed command: collapsed summary row, plus its full command and result when expanded. */
function ExecRow({ entry, row }: { entry: ExecEntry; row: RowContext }): ReactNode {
  const lineBreak = entry.command.indexOf('\n')
  return (
    <li className={css.item} data-exec-shell={entry.shell} data-exec-status={entry.status}>
      <button type="button" className={css.row} aria-expanded={row.expanded}
        title={row.t(row.expanded ? 'collapse' : 'expand')}
        onClick={() => { row.onToggle(entry.callId) }}>
        <span className={css.status} aria-hidden="true">{row.t(STATUS_GLYPH_KEYS[entry.status])}</span>
        <span className={css.shell}>{row.t(entry.shell === 'kali' ? 'shellKali' : 'shellWin')}</span>
        <span className={css.command}>{lineBreak === -1 ? entry.command : entry.command.slice(0, lineBreak)}</span>
        <time className={css.time} dateTime={new Date(entry.time).toISOString()}>{TIME_FORMAT.format(entry.time)}</time>
      </button>
      {row.expanded && <div className={css.details}>
        <pre className={css.commandText} data-exec-command>{entry.command}</pre>
        <pre className={css.resultText} data-exec-result>{resultBody(entry, row.t)}</pre>
      </div>}
    </li>
  )
}

/**
 * Render the executed-commands list for the visible session.
 * @param props - framework runtime seat, the session's event window, and copy.
 * @returns the newest-first list, or its empty state.
 */
export function ExecBody({ useEvents, t }: ExecBodyProps): ReactNode {
  const window = useEvents(current => current)
  const entries = collectExecHistory(window.entries)
  const [expanded, setExpanded] = useState<string | undefined>(undefined)
  if (entries.length === 0) {
    return (
      <div className={css.empty} data-exec-state="empty">
        <p className={css.emptyMessage} role="status">{t('empty')}</p>
      </div>
    )
  }
  return (
    <div className={css.root} data-exec-state="list">
      <ul className={css.list}>
        {entries.map(entry => (
          <ExecRow key={entry.callId} entry={entry} row={{
            expanded: expanded === entry.callId,
            onToggle: (callId) => { setExpanded(current => current === callId ? undefined : callId) },
            t,
          }} />
        ))}
      </ul>
      {window.hasMore && <p className={css.note} role="note">{t('truncated')}</p>}
    </div>
  )
}
