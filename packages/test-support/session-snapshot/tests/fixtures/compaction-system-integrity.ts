import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'compaction-system-integrity'
export const inject = ['agents', 'systemPrompt']

/** Check the summary request after a tool adds an in-history system update. */
export async function apply(ctx: Context): Promise<void> {
  let guidance = 'Preserve every project instruction and exact task finding.'
  ctx.systemPrompt.section({ name: 'snapshot:compaction-integrity', order: 400, text: () => guidance })
  const loader = ctx.get('loader') as {
    entries(): IterableIterator<{ options: { id?: string; config?: Record<string, unknown> } }>
  } | undefined
  assert(loader !== undefined)
  const promptEntry = [...loader.entries()].find(entry => entry.options.id === 'system-prompt')
  assert.deepEqual(promptEntry?.options.config?.requiredSections, {
    'tools:calling': '1',
    'deployment:persona-prefix': '1',
    'deployment:persona-suffix': '1',
    'harness:identity': '1',
  })
  assert.equal(promptEntry?.options.config?.preserveSections, true)
  const initial = await ctx.systemPrompt.assemble()
  const sectionNames = initial.sections.map(section => section.name)
  assert(sectionNames.includes('snapshot:compaction-integrity'), `probe section absent; effective sections: ${sectionNames.join(', ')}`)
  const promptScope = createScope(ctx, { name: 'post-interpolation-probe' })
  try {
    promptScope.ctx.systemPrompt.variable('snapshot_probe', () => 'valid scoped value')
    promptScope.ctx.systemPrompt.section({
      name: 'deployment:persona-prefix', version: '1', order: 0,
      text: '{{snapshot_probe}}',
    })
    const validPrompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeOf(promptScope.ctx)! }))
    assert(validPrompt.includes('valid scoped value'))

    const removeValue = promptScope.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const assembly = await next()
      assembly.variables.snapshot_probe = '  '
      return assembly
    })
    try {
      const invalidAssembly = await ctx.systemPrompt.assemble({ scope: scopeOf(promptScope.ctx)! })
      assert.throws(() => renderPrompt(invalidAssembly), /required section "deployment:persona-prefix" rendered empty/)
      assert.throws(() => renderPrompt(invalidAssembly), (error) => {
        assert(error instanceof Error)
        assert(!error.message.includes('PRIVATE SNAPSHOT PERSONA'))
        assert(!error.message.includes('snapshot_probe'))
        return true
      })
    } finally {
      removeValue()
    }
  } finally {
    await promptScope.dispose()
  }
  let intercepted = false
  const disposeProbe = ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    assert(assembly.sections.some(section => section.name === 'snapshot:compaction-integrity'))
    intercepted = true
    return { ...assembly, sections: assembly.sections.filter(section => section.name !== 'snapshot:compaction-integrity') }
  })
  try {
    await assert.rejects(ctx.systemPrompt.assemble(), /section "snapshot:compaction-integrity"/)
    assert(intercepted, 'unscoped assembly probe listener did not run')
  } finally {
    disposeProbe()
  }
  const scope = createScope(ctx, { name: 'prompt-admission-probe' })
  try {
    const wrongPersona = scope.ctx.systemPrompt.section({
      name: 'deployment:persona-prefix', version: '2', order: 0, text: 'wrong persona version',
    })
    try {
      await assert.rejects(ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! }), /deployment:persona-prefix.*actual "2"/)
    } finally {
      wrongPersona()
    }
    const validPersona = scope.ctx.systemPrompt.section({
      name: 'deployment:persona-prefix', version: '1', order: 0, text: 'valid scoped persona',
    })
    try {
      const scopedAssembly = await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })
      assert.equal(scopedAssembly.sections.find(section => section.name === 'deployment:persona-prefix')?.text, 'valid scoped persona')
    } finally {
      validPersona()
    }
    scope.ctx.systemPrompt.section({ name: 'tools:calling', version: '2', order: 0, text: 'wrong version' })
    await assert.rejects(ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! }), /actual "2"/)
  } finally {
    await scope.dispose()
  }
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (exec.name === 'read' && !result.isError) {
      guidance += ' Keep the latest read evidence when continuing the task.'
    }
    return downstream
  })
  ctx.on('llm/stream', (options, next) => {
    if (options.purpose === 'compaction') {
      assert(options.sessionId !== undefined)
      const agent = ctx.agents.get(options.sessionId)
      assert(agent !== undefined)
      const expected = agent.session.deriveMessages().filter(message => message.role === 'system')
      assert.equal(expected.length, 2)
      assert.deepEqual(options.messages.filter(message => message.role === 'system'), expected)
      const instruction = options.messages.at(-1)
      assert.equal(instruction?.role, 'user')
      const text = instruction?.content.find(block => block.type === 'text')
      assert(text?.type === 'text' && text.text.includes('A start acknowledgement is not completion'))
      assert(text?.type === 'text' && text.text.includes('make inspecting current state a prerequisite to retrying'))
    }
    return next()
  })
}
