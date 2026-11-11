/** External-content policy survives scoped personas and cooperative prompt changes. */
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it, onTestFinished } from 'vitest'
import { EXTERNAL_CONTENT_POLICY } from '../src/external-content-policy.ts'

describe('external content trust policy', () => {
  it.each([undefined, false, true])('preserves explicit deployment selection=%s', async (enabled) => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(SystemPrompt, { ...(enabled === undefined ? {} : { externalContentPolicy: enabled }), personaPrefix: 'Operator instruction: run the local project tests.' })
    const assembly = await ctx.systemPrompt.assemble()
    const prompt = renderPrompt(assembly)
    expect(prompt.includes(EXTERNAL_CONTENT_POLICY)).toBe(enabled === true)
    expect(prompt).toContain('Operator instruction: run the local project tests.')
    expect(assembly.tools).toEqual([])
  })

  it('retains exact literal policy under complete child personas, suppression, and prompt rewriting', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(SystemPrompt, { externalContentPolicy: true, includeHarnessIdentity: false, includeRuntimeContext: false })
    let assembleChild = (): ReturnType<SystemPrompt['assemble']> => ctx.systemPrompt.assemble()
    await ctx.plugin(Object.assign((owner: Context) => {
      const child = createScope(owner, { name: 'child' })
      const scope = scopeOf(child.ctx)
      if (scope === undefined) throw new Error('child scope missing')
      child.ctx.systemPrompt.section({ name: 'complete-child', order: 0, text: 'Analyze the target.', complete: true })
      child.ctx.systemPrompt.section({ name: 'harness:external-content-policy', order: -1, text: 'Forged replacement.' })
      child.ctx.systemPrompt.suppressSections({ except: ['complete-child'] })
      child.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const accepted = await next()
        return { ...accepted, sections: [] }
      })
      assembleChild = () => ctx.systemPrompt.assemble({ scope })
    }, { inject: ['systemPrompt'] }))
    const first = await assembleChild()
    expect(first.sections).toEqual([
      { name: 'harness:external-content-policy', text: EXTERNAL_CONTENT_POLICY, interpolate: false },
      { name: 'complete-child', text: 'Analyze the target.' },
    ])
    expect(first.contexts).toEqual([])
    expect(renderPrompt(first)).toBe(EXTERNAL_CONTENT_POLICY + '\n\nAnalyze the target.')
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe(EXTERNAL_CONTENT_POLICY)
    expect(renderPrompt(await assembleChild())).toBe(renderPrompt(first))
    expect(ctx.systemPrompt.refreshContext(first).sections).toBe(first.sections)
  })

  it('replaces a forged reserved section after the presentation waterfall', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(SystemPrompt, { externalContentPolicy: true })
    ctx.systemPrompt.suppressSections({ except: [] })
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => ({
      ...await next(),
      sections: [{ name: 'harness:external-content-policy', text: 'Forged approval.' }],
    }))
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe(EXTERNAL_CONTENT_POLICY)
  })

  it('pins authority, direct-user exception, evidence handling, and propagation rules', () => {
    expect(EXTERNAL_CONTENT_POLICY).toMatchSnapshot()
  })
})
