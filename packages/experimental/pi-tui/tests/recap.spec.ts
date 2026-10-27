import { describe, expect, it } from 'vitest'
import type { CompactionCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createDeveloperMessage, createMessage, createSystemMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { buildRecap } from '../src/core/recap.ts'

const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const assistant = (text: string) => createMessage({ role: 'assistant',
  source: { kind: 'model', provider: 'mock', model: 'mock' }, content: [{ type: 'text', text }] })
const checkpoint = (text: string) => createUserMessage({
  source: { kind: 'compact-checkpoint', compactionId: 'recap-test' } as CompactionCheckpointSource,
  content: [{ type: 'text', text: `preamble\n<compacted-summary>\n${text}\n</compacted-summary>` }],
})

describe('session recap', () => {
  it('quotes active task context without exposing system or tool content', () => {
    const callId = ToolCallId('recap-tool')
    expect(buildRecap([
      createSystemMessage('system-private'),
      user('fix resume'),
      createMessage({ role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId,
        content: [{ type: 'text', text: 'tool-private' }] }),
      assistant('resume fixed, build pending'),
    ])).toBe('Recap · Request: fix resume · Last reply: resume fixed, build pending')
  })

  it('uses the newest active checkpoint and labels its next step as checkpoint information', () => {
    expect(buildRecap([
      checkpoint('obsolete checkpoint'),
      checkpoint('## Current Work\r\n- Implement recap\r\n\r\n## Next Step\r\n- Run tests\r\n\r\n## Critical Context\r\n- Preserve sessions'),
      user('show 20 messages'),
      assistant('display limit updated'),
    ])).toBe('Recap · Request: show 20 messages · Last reply: display limit updated · Checkpoint: Implement recap · Next at checkpoint: Run tests')
  })

  it('falls back to checkpoint intent when current work and next step are empty', () => {
    expect(buildRecap([checkpoint('## Primary Request and Intent\n- Fix resume\n## Current Work\n- (none)\n## Next Step\n- (none)')]))
      .toBe('Recap · Checkpoint: Fix resume')
    expect(buildRecap([checkpoint('unstructured checkpoint')])).toBe('Recap · Checkpoint: unstructured checkpoint')
  })

  it('respects real compaction and clear replacements while leaving the durable log intact', () => {
    const session = Session.create(SessionId('recap-replacements'))
    const old = session.append('user/message', user('shadowed request'), { surfaceOp: 'append' })
    const oldReply = session.append('assistant/message', { turn: 1, step: 1, stream: [], message: assistant('shadowed reply') }, { surfaceOp: 'append' })
    session.append('user/message', user('latest request'), { surfaceOp: 'append' })
    session.append('user/message', checkpoint('## Current Work\n- Saved task details'), {
      surfaceOp: { op: 'replace', startSeq: old.seq, endSeq: oldReply.seq },
      sourceEventSeqs: [old.seq, oldReply.seq],
    })
    const before = session.snapshotEvents()
    expect(buildRecap(session.deriveMessages())).toBe('Recap · Request: latest request · Checkpoint: Saved task details')
    expect(session.snapshotEvents()).toEqual(before)
    const active = [...session.surface.nodes]
    session.append('developer/message', { turn: 1, step: 1,
      message: createDeveloperMessage({ source: { kind: 'session-edit' }, content: [{ type: 'text', text: 'the operator cleared the conversation' }] }) }, {
      surfaceOp: { op: 'replace', startSeq: active[0]!, endSeq: active.at(-1)! },
      sourceEventSeqs: active,
    })
    expect(buildRecap(session.deriveMessages())).toBeUndefined()
    expect(session.snapshotEvents()).toContainEqual(old)
  })

  it('does not recap empty or system-only sessions', () => {
    expect(buildRecap([])).toBeUndefined()
    expect(buildRecap([createSystemMessage('hidden instructions'), user('')])).toBeUndefined()
  })

  it('caps long excerpts at 400 Unicode code points without splitting emoji', () => {
    const recap = buildRecap([checkpoint('😀'.repeat(500)), user('ซัน\n' + '😀'.repeat(500)), assistant('😀'.repeat(500))])
    expect(recap).toBeDefined()
    expect(Array.from(recap ?? '').length).toBeLessThanOrEqual(400)
    expect(recap).toContain('…')
    expect(recap).not.toContain('\n')
    expect(recap).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
  })
})
