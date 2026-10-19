/** Wiki discovery availability in the composer's bottom status strip. */
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-tool-fs-search/knowledge-types'
import type { ComposerBarProps } from '../contract/slots.ts'
import css from './KnowledgeStatus.module.css'

/** The projection read seat and the owning composer's locale. */
export interface KnowledgeStatusProps {
  useProjection: UseProjection
  t: ComposerBarProps['t']
}

/** Render only the libraries the host currently exposes to this session. */
export function KnowledgeStatus({ useProjection, t }: KnowledgeStatusProps) {
  const status = useProjection('knowledgeStatus')
  if (status === undefined || status.libraries.length === 0) return null
  return (
    <span className={css.root} title={t('wiki.available', { libraries: status.libraries.join(', ') })} data-knowledge-status>
      <span aria-hidden>📚</span>
      <span>{t('wiki.label')}</span>
    </span>
  )
}
