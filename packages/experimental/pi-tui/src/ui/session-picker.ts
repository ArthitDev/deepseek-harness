import type { Context } from '@deepseek-ai/cordis'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { TUI } from '@earendil-works/pi-tui'
import { listSessions, sessionSummaries } from '../core/session.js'
import { pickFromListWithSearch, type ListPickItem } from './overlays.js'

function cachedSessionTitle(ctx: Context, header: SessionHeader): string {
  const cache = ctx.get('sessionProjectionCache')
  try {
    const cached = cache?.cachedSnapshot(header, ['title']) ?? cache?.cachedPredecessorTitle(header)
    return cached?.values.title?.trim() ?? ''
  } catch (error) {
    ctx.logger.debug('Could not read the cached session title for the resume picker.', error)
    return ''
  }
}

/** Build the newest-first resume list from persisted user conversations. */
export async function resumeSessionItems(ctx: Context): Promise<ListPickItem[]> {
  const archived = new Set(ctx.get('workspaceRegistry')?.archivedSessionIds)
  const headers = (await listSessions(ctx)).filter(header => header.origin !== 'subagent' && !archived.has(header.id))
  const summaries = await sessionSummaries(ctx, headers)
  return headers.flatMap((header) => {
    const summary = summaries.get(header.id)
    if (summary?.blank === true) return []
    const id = String(header.id)
    const shortId = id.startsWith('session-') ? id.slice(8).slice(-8) || id : id.slice(0, 8)
    const project = header.cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
    const title = summary?.title ?? cachedSessionTitle(ctx, header)
    const label = title || (project === '' ? `Session ${shortId}` : `${project} · ${shortId}`)
    const description = [title === '' ? '' : shortId, new Date(header.createdAt).toLocaleString(),
      summary === undefined ? '' : `${summary.events} events`, header.parentSession === undefined ? '' : 'fork',
    ].filter(Boolean).join(' · ')
    return [{ value: id, label, description, searchText: `${label} ${id} ${project}` }]
  })
}

/** Select a persisted session by title or ID, or return undefined on cancel. */
export function pickSession(tui: TUI, items: ListPickItem[]): Promise<string | undefined> {
  return pickFromListWithSearch(tui, { title: 'Resume session', items })
}
