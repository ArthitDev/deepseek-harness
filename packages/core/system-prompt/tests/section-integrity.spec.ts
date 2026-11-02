import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { createScope, scopeOf, type Scope } from '@deepseek-ai/dsh-scope'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function mount(preserveSections = true, requiredSections?: Record<string, string>) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, {
    preserveSections, includeHarnessIdentity: false,
    ...(requiredSections === undefined ? {} : { requiredSections }),
  })
  ctx.systemPrompt.section({ name: 'core', order: 100, text: 'PRIVATE CORE INSTRUCTION' })
  ctx.systemPrompt.section({ name: 'workflow', order: 200, text: 'Read evidence before changing files.' })
  return ctx
}

const mutations: Array<[string, (assembly: PromptAssembly) => void]> = [
  ['remove', (assembly) => { assembly.sections = assembly.sections.filter(section => section.name !== 'core') }],
  ['rename', (assembly) => { assembly.sections.find(section => section.name === 'core')!.name = 'renamed' }],
  ['rewrite', (assembly) => { assembly.sections.find(section => section.name === 'core')!.text = 'REPLACED' }],
  ['empty', (assembly) => { assembly.sections.find(section => section.name === 'core')!.text = '' }],
  ['reorder', (assembly) => { assembly.sections.reverse() }],
  ['interpolation', (assembly) => { assembly.sections.find(section => section.name === 'core')!.interpolate = false }],
  ['duplicate', (assembly) => { assembly.sections.push({ name: 'core', text: 'EXTRA' }) }],
]

describe('registered section integrity', () => {
  it.each([
    [{ ' ': '1' }],
    [{ required: '  ' }],
  ] as const)('rejects blank required-section keys and versions at configuration load', async (requiredSections) => {
    const ctx = new Context()
    contexts.push(ctx)
    await expect(ctx.plugin(SystemPrompt, { requiredSections })).rejects.toThrow()
  })

  it.each([
    ['missing', undefined, /"required" is missing \(expected version "1", actual <missing>\)/],
    ['unversioned', undefined, /"required" has wrong version \(expected "1", actual <unversioned>\)/],
    ['wrong version', '2', /"required" has wrong version \(expected "1", actual "2"\)/],
  ] as const)('checks required registrations before providers (%s)', async (kind, version, error) => {
    const ctx = await mount(false, { required: '1' })
    let providerCalls = 0
    if (kind !== 'missing') {
      ctx.systemPrompt.section({
        name: 'required', order: 300, text: () => { providerCalls++; return 'PRIVATE SECTION TEXT' },
        ...(version === undefined ? {} : { version }),
      })
    }
    ctx.systemPrompt.variable('probe', () => { providerCalls++; return 'value' })
    ctx.systemPrompt.tools(() => { providerCalls++; return { schemas: [] } })
    ctx.systemPrompt.suppressSections({ except: () => { providerCalls++; return [] } })

    await expect(ctx.systemPrompt.assemble()).rejects.toThrow(error)
    await expect(ctx.systemPrompt.assemble()).rejects.not.toThrow('PRIVATE SECTION TEXT')
    expect(providerCalls).toBe(0)
  })

  it('copies the deployment map and checks scoped overrides before suppression or complete selection', async () => {
    const requiredSections = { required: '1' }
    const ctx = await mount(false, requiredSections)
    requiredSections.required = '2'
    const disposeGlobal = ctx.systemPrompt.section({ name: 'required', version: '1', order: 300, text: 'global' })
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, { name: 'child' }) }, {
      inject: ['systemPrompt'],
    }))
    const scoped = scope.ctx.systemPrompt.section({ name: 'required', version: '1', order: 300, text: '' })
    expect((await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })).sections.find(section => section.name === 'required')?.text)
      .toBe('')

    scoped()
    scope.ctx.systemPrompt.section({ name: 'required', version: '2', order: 300, text: 'CHILD PRIVATE TEXT' })
    await expect(ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! }))
      .rejects.toThrow(/"required" has wrong version \(expected "1", actual "2"\)/)
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'required')?.text).toBe('global')
    const sibling = createScope(ctx, { name: 'sibling' })
    expect((await ctx.systemPrompt.assemble({ scope: scopeOf(sibling.ctx)! })).sections.find(section => section.name === 'required')?.text)
      .toBe('global')
    await scope.dispose()
    await sibling.dispose()
    disposeGlobal()
    await expect(ctx.systemPrompt.assemble()).rejects.toThrow(/"required" is missing/)
  })

  it('allows registered required sections to be intentionally suppressed or hidden by a complete section', async () => {
    const ctx = await mount(false, { required: '1' })
    ctx.systemPrompt.section({ name: 'required', order: 300, version: '1', text: 'required text' })
    const suppress = ctx.systemPrompt.suppressSections({ except: () => [] })
    expect((await ctx.systemPrompt.assemble()).sections).toEqual([])
    suppress()
    const complete = ctx.systemPrompt.section({ name: 'complete', order: 0, complete: true, text: '' })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('')
    complete()
  })

  it.each(mutations)('rejects %s without disclosing section text', async (_name, mutate) => {
    const ctx = await mount()
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const result = await next()
      mutate(result)
      return result
    })
    await expect(ctx.systemPrompt.assemble()).rejects.toThrow(
      /removed, changed, duplicated, or reordered|section name "core" is duplicated/,
    )
    await expect(ctx.systemPrompt.assemble()).rejects.not.toThrow('PRIVATE CORE INSTRUCTION')
  })

  it('renders required sections with the final waterfall variables', async () => {
    const ctx = await mount(true, { required: '1' })
    ctx.systemPrompt.section({ name: 'required', version: '1', order: 300, text: 'Guidance: {{value}}' })
    ctx.systemPrompt.variable('value', () => 'initial')
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const result = await next()
      result.variables.value = 'final'
      return result
    })

    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Guidance: final')
  })

  it.each([
    ['empty', ''],
    ['whitespace', ' \n\t'],
  ] as const)('rejects required sections rendered as %s without exposing prompt text or values', async (_kind, value) => {
    const ctx = await mount(true, { required: '1' })
    ctx.systemPrompt.section({ name: 'required', version: '1', order: 300, text: '{{value}}' })
    ctx.systemPrompt.variable('value', () => 'initial')
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const result = await next()
      result.variables.value = value
      return result
    })

    const assembly = await ctx.systemPrompt.assemble()
    expect(() => renderPrompt(assembly)).toThrow('required section "required" rendered empty')
  })

  it.each([
    ['malformed', 'PRIVATE TEMPLATE {{bad-name}}'],
    ['unknown', 'PRIVATE TEMPLATE {{missing}}'],
    ['undefined', 'PRIVATE TEMPLATE {{value}}'],
  ] as const)('sanitizes %s interpolation failures in required sections', async (_kind, text) => {
    const ctx = await mount(true, { required: '1' })
    ctx.systemPrompt.section({ name: 'required', version: '1', order: 300, text })
    if (text.includes('{{value}}')) ctx.systemPrompt.variable('value', () => undefined)

    const assembly = await ctx.systemPrompt.assemble()
    expect(() => renderPrompt(assembly)).toThrow('required section "required" could not be rendered')
    expect(() => renderPrompt(assembly)).not.toThrow('PRIVATE TEMPLATE')
    expect(() => renderPrompt(assembly)).not.toThrow('missing')
    expect(() => renderPrompt(assembly)).not.toThrow('bad-name')
    expect(() => renderPrompt(assembly)).not.toThrow('value')
  })

  it('keeps intentional empty and literal required sections renderable', async () => {
    const ctx = await mount(true, { required: '1' })
    const empty = ctx.systemPrompt.section({ name: 'required', version: '1', order: 300, text: ' \n' })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('PRIVATE CORE INSTRUCTION')
    empty()
    ctx.systemPrompt.section({ name: 'required', version: '1', order: 300, text: '{{missing}}', interpolate: false })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('{{missing}}')
  })

  it('allows additions, tools, contexts, and routed variable resolution', async () => {
    const ctx = await mount()
    ctx.systemPrompt.section({ name: 'route', order: 300, text: 'Model: {{model}}' })
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const result = await next()
      result.sections.push({ name: 'additional', text: 'Extra guidance.' })
      result.contexts.push({ name: 'runtime', text: 'Current workspace.' })
      result.tools.push({ name: 'work', description: 'Work.', parameters: {} })
      result.variables.model = 'selected-model'
      return result
    })
    const result = await ctx.systemPrompt.assemble()
    expect(renderPrompt(result))
      .toContain('Model: selected-model\n\nExtra guidance.')
    expect(result.tools.map(tool => tool.name)).toEqual(['work'])
    expect(result.contexts).toEqual([{ name: 'runtime', text: 'Current workspace.' }])
  })

  it('keeps expert waterfall replacement when preservation is disabled', async () => {
    const ctx = await mount(false)
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => ({
      ...await next(), sections: [],
    }))
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('')
  })

  it('resolves scoped shadowing, suppression, and complete prompts before preservation', async () => {
    const ctx = await mount()
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, { name: 'child' }) }, {
      inject: ['systemPrompt'],
    }))
    scope.ctx.systemPrompt.section({ name: 'core', order: 100, text: 'CHILD CORE' })
    const suppress = scope.ctx.systemPrompt.suppressSections({ except: () => ['core'] })
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! }))).toBe('CHILD CORE')
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('PRIVATE CORE INSTRUCTION')
    suppress()
    const complete = scope.ctx.systemPrompt.section({ name: 'complete', order: 0, complete: true, text: '' })
    scope.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => ({
      ...await next(), sections: [{ name: 'changed', text: 'Do not resurrect this prompt.' }],
    }))
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! }))).toBe('')
    complete()
    await scope.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('PRIVATE CORE INSTRUCTION')
  })

  it('captures fresh provider text and registrations for each assembly after disposal', async () => {
    const ctx = await mount()
    let text = 'first'
    const unregister = ctx.systemPrompt.section({ name: 'dynamic', order: 300, text: () => text })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('first')
    text = 'second'
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('second')
    unregister()
    const replacement = ctx.systemPrompt.section({ name: 'dynamic', order: 300, text: 'replacement' })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('replacement')
    replacement()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('replacement')
  })

  it('prepares before reading providers and filters preparation by scope', async () => {
    const ctx = await mount(true, { 'during-prepare': '1' })
    let prepared = false
    let registered = false
    let scopedPreparations = 0
    ctx.systemPrompt.section({ name: 'prepared', order: 300, text: () => prepared ? 'ready' : 'stale' })
    ctx.on('system-prompt/prepare', async () => {
      await Promise.resolve()
      prepared = true
      if (!registered) {
        registered = true
        ctx.systemPrompt.section({ name: 'during-prepare', order: 400, version: '1', text: 'refreshed' })
      }
    })
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, { name: 'child' }) }, {
      inject: ['systemPrompt'],
    }))
    scope.ctx.on('system-prompt/prepare', async () => { scopedPreparations++ })

    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('ready')
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('refreshed')
    expect(scopedPreparations).toBe(0)
    await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
    expect(scopedPreparations).toBe(1)
    await scope.dispose()
  })

  it('does not read providers when preparation fails', async () => {
    const ctx = await mount()
    let providerCalls = 0
    ctx.systemPrompt.section({ name: 'unread', order: 300, text: () => { providerCalls++; return 'text' } })
    ctx.on('system-prompt/prepare', async () => { throw new Error('settings unavailable') })

    await expect(ctx.systemPrompt.assemble()).rejects.toThrow('settings unavailable')
    expect(providerCalls).toBe(0)
  })
})
