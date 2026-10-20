import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { discardEmptySession, hasUserContent } from '../src/core/session.js'
import { SessionId } from '@deepseek-ai/dsh-session'

function stubServices(ctx: Context): { forgotten: string[]; deleted: string[] } {
  const forgotten: string[] = []
  const deleted: string[] = []
  ctx.provide('workspaceRegistry', {
    forgetSession: vi.fn(async (sessionId: SessionId) => {
      forgotten.push(String(sessionId))
    }),
  })
  ctx.provide('sessionPersistence', {
    delete: vi.fn(async (sessionId: SessionId) => {
      deleted.push(String(sessionId))
      return true
    }),
  })
  return { forgotten, deleted }
}

describe('hasUserContent', () => {
  it('sees a created-but-never-used session as contentless', () => {
    const session = {
      snapshotEvents: () => [
        { type: 'session' },
        { type: 'permission/preset' },
        { type: 'sandbox/mode' },
        { type: 'approval/policy' },
        { type: 'knowledge/status' },
      ],
    }
    expect(hasUserContent(session)).toBe(false)
  })

  it('counts a submitted user message as content', () => {
    const session = {
      snapshotEvents: () => [
        { type: 'permission/preset' },
        { type: 'user/message' },
      ],
    }
    expect(hasUserContent(session)).toBe(true)
  })

  it('counts a model request as content', () => {
    const session = { snapshotEvents: () => [{ type: 'request/header' }] }
    expect(hasUserContent(session)).toBe(true)
  })
})

describe('discardEmptySession', () => {
  it('forgets the workspace record and deletes the persisted artifact', async () => {
    const ctx = new Context()
    const { forgotten, deleted } = stubServices(ctx)
    const sessionId = SessionId('discard-empty-test')
    await discardEmptySession(ctx, sessionId)
    expect(forgotten).toEqual([String(sessionId)])
    expect(deleted).toEqual([String(sessionId)])
  })

  it('is a no-op when the persistence service is absent', async () => {
    const ctx = new Context()
    const forgotten: string[] = []
    ctx.provide('workspaceRegistry', {
      forgetSession: vi.fn(async (sessionId: SessionId) => {
        forgotten.push(String(sessionId))
      }),
    })
    const sessionId = SessionId('discard-empty-absent')
    await discardEmptySession(ctx, sessionId)
    expect(forgotten).toEqual([])
  })
})
