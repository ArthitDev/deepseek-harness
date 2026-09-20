/** Host-side standalone feedback recorder; kept off the root entry so its `Session` signature never reaches the client face. */

import type { Session } from '@deepseek-ai/dsh-session'
import type { FeedbackRecord } from './types.ts'

/**
 * Record feedback independently of any UI trigger. Surrounding whitespace is
 * discarded and a blank text is recorded as absent; an entry with neither
 * text nor category is still recorded.
 * @param session - session the feedback describes.
 * @param entry - human-authored remark and its category.
 */
export function recordFeedback(session: Session, entry: FeedbackRecord): void {
  const text = entry.text?.trim() ?? ''
  session.append('feedback/record', {
    ...(text.length === 0 ? {} : { text }),
    ...(entry.category === undefined ? {} : { category: entry.category }),
  })
}
