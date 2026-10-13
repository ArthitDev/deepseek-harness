import { vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'

/** Mock the driver boundary while keeping the real session and Cordis events. */
export function fixtureAgent(ctx: Context, session: Session, options: AgentOptions = {}): Agent {
  return {
    id: session.id, ctx, session, options, status: 'idle',
    inbox: {
      nextTurn: [], nextStep: [], clear: vi.fn(), append: vi.fn(), prepend: vi.fn(),
      replace: vi.fn(() => false), remove: vi.fn(() => false), splice: vi.fn(() => []),
    },
    cancel: vi.fn(), whenIdle: vi.fn(async () => {}), runMaintenance: vi.fn(),
    send: vi.fn(), followup: vi.fn(), steer: vi.fn(), inject: vi.fn(),
  }
}
