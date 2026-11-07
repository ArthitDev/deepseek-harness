// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { KnowledgeStatus, type KnowledgeStatusProps } from '../src/client/skeleton/KnowledgeStatus.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

describe('composer Wiki status', () => {
  it.each([en, zh])('shows current libraries and removes stale availability on session change', (dictionary) => {
    const values: Record<string, unknown> = { knowledgeStatus: { libraries: ['cyber'] } }
    const useProjection: KnowledgeStatusProps['useProjection'] = (key: string) => values[key]
    const t = makeTranslate(dictionary) as KnowledgeStatusProps['t']
    const view = render(<KnowledgeStatus useProjection={useProjection} t={t} />)
    expect(view.container.textContent).toBe('📚Wiki')
    expect(view.getByTitle(t('wiki.available', { libraries: 'cyber' }))).toBeTruthy()
    values.knowledgeStatus = { libraries: [] }
    view.rerender(<KnowledgeStatus useProjection={useProjection} t={t} />)
    expect(view.container.textContent).toBe('')
    delete values.knowledgeStatus
    view.rerender(<KnowledgeStatus useProjection={useProjection} t={t} />)
    expect(view.container.textContent).toBe('')
  })
})
