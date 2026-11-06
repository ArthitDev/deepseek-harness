import { readFileSync } from 'node:fs'

export const name = 'prompt-preset-fixture'
export const inject = ['systemPrompt']

export function apply(ctx, config) {
  ctx.systemPrompt.variable('preset_prompt', () => readFileSync(config.stateFile, 'utf8'))
  ctx.systemPrompt.section({
    name: 'deployment:persona-prefix',
    version: '1',
    order: 0,
    text: '{{preset_prompt}}',
  })
}
