/** Optional role guidance preserves delegation composition and task text. */
import { describe, expect, it, vi } from 'vitest'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { callSubagent, setup, text } from './harness.ts'

const roles = {
  explore: 'Inspect the assigned question. Return file evidence and limits.',
  implement: 'Implement the assigned change. Return changed files and executed checks.',
  verify: 'Verify the assigned change. Return reproducible findings and limits.',
}
const task = { description: 'inspect this change', prompt: 'Check src/main.ts. Preserve the existing API.' }

describe('subagent task roles', () => {
  it.each(Object.keys(roles))('adds %s instructions without selecting another preset or route', async (role) => {
    const onStart = vi.fn<(request: SubagentStartRequest) => void>()
    const ctx = await setup({ provider: 'mock', roles }, { onStart })
    const before = ctx.tools.schemas()
    const result = await callSubagent(ctx, { ...task, role })
    expect(result.isError).toBe(false)
    const request = onStart.mock.calls[0]![0]
    expect(request.prompt.slice(0, 2)).toEqual([
      { type: 'text', text: `Delegated role: ${role}\n${roles[role as keyof typeof roles]}` },
      { type: 'text', text: task.prompt },
    ])
    expect(request).not.toHaveProperty('agentPreset')
    expect(request).not.toHaveProperty('agentOptions')
    expect(ctx.tools.schemas()).toEqual(before)
    const schema = before.find(tool => tool.name === 'subagent')!
    expect(schema.parameters.properties).toHaveProperty('role.enum', Object.keys(roles))
    expect(schema.parameters.required).not.toContain('role')
  })

  it('keeps the original task when the role is omitted', async () => {
    const onStart = vi.fn<(request: SubagentStartRequest) => void>()
    const ctx = await setup({ provider: 'mock', roles }, { onStart })
    await callSubagent(ctx, task)
    expect(onStart.mock.calls[0]![0].prompt[0]).toEqual({ type: 'text', text: task.prompt })
  })

  it.each([undefined, roles])('rejects unknown roles before child startup with config %j', async (configured) => {
    const onStart = vi.fn<(request: SubagentStartRequest) => void>()
    const ctx = await setup({ provider: 'mock', ...configured === undefined ? {} : { roles: configured } }, { onStart })
    const result = await callSubagent(ctx, { ...task, role: 'missing' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('role')
    expect(onStart).not.toHaveBeenCalled()
  })

  it.each([{}, { ' ': 'inspect' }, { explore: ' ' }])('rejects empty role configuration: %j', async (roles) => {
    await expect(setup({ provider: 'mock', roles })).rejects.toThrow(/roles/)
  })
})
