import { readFileSync } from 'node:fs'

export const name = 'prompt-lifecycle-fixture'
export const inject = ['agents', 'systemPrompt', 'loader']

export function apply(ctx, config) {
  ctx.systemPrompt.variable('sdk_prompt', () => readFileSync(config.stateFile, 'utf8'))
  const promptRow = [...ctx.loader.entries()].find(entry => entry.options.id === 'system-prompt')
  const promptConfig = promptRow?.options.config
  if (promptConfig?.preserveSections !== true || promptConfig.requiredSections?.['tools:calling'] !== '1'
    || promptConfig.requiredSections?.['deployment:persona-prefix'] !== '1'
    || promptConfig.requiredSections?.['deployment:persona-suffix'] !== '1'
    || promptConfig.requiredSections?.['harness:identity'] !== '1') {
    throw new Error('SDK prompt lifecycle fixture requires the shipped preservation and core-version config')
  }
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.systemPrompt.section({
      name: 'deployment:persona-prefix',
      version: '1',
      order: 0,
      text: '{{sdk_prompt}}',
    })
  })
}
