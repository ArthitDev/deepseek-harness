import { expect, it, onTestFinished, vi } from 'vitest'
import { installModelProxyDispatcher, modelProxyEndpointForCall } from '@deepseek-ai/dsh-http-proxy'
import { catalogModels, catalogProvider } from '../src/catalog.ts'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { resolveHttpProxyUrlForTarget } from '@earendil-works/pi-ai/utils/node-http-proxy'

it.each(['amazon-bedrock', 'openai-codex'])('keeps %s transport overrides inside the model proxy scope', async (provider) => {
  const catalog = catalogProvider(provider)
  const model = [...catalogModels(provider).values()][0]
  if (catalog === undefined || model === undefined) throw new Error('missing installed provider')
  const boundary = vi.spyOn(catalog, 'streamSimple').mockImplementation(() => { throw new Error('fixture SDK boundary') })
  onTestFinished(() => { boundary.mockRestore() })
  const adapter = new PiAiAdapter({
    profiles: () => resolveProfiles({ [provider]: { apiKeyEnv: 'FIXTURE', transport: 'websocket', models: [{ id: model.id }] } }),
    resolveApiKey: () => Promise.resolve('fixture'), auth: memoryAuth(),
  })
  const drain = async () => {
    for await (const chunk of adapter.stream({ provider, model: model.id, messages: [] })) void chunk
  }
  const scope = await installModelProxyDispatcher(new URL('http://127.0.0.1:18899'))
  const inactiveScope = await installModelProxyDispatcher(new URL('http://127.0.0.1:18900'))
  onTestFinished(async () => { await inactiveScope.dispose(); await scope.dispose() })
  vi.stubEnv('NO_PROXY', '*')
  onTestFinished(() => { vi.unstubAllEnvs() })
  expect(await modelProxyEndpointForCall()).toBeUndefined()
  await scope.run(drain)
  expect(boundary).toHaveBeenCalledOnce()
  expect(boundary.mock.calls[0]?.[0]).toMatchObject({ provider, id: model.id })
  expect(boundary.mock.calls[0]?.[2]).toMatchObject(provider === 'amazon-bedrock'
    ? { env: { https_proxy: 'http://127.0.0.1:18899', HTTPS_PROXY: 'http://127.0.0.1:18899', no_proxy: ' ', NO_PROXY: ' ' }, maxRetries: 0 }
    : { transport: 'sse', maxRetries: 0 })
  if (provider === 'amazon-bedrock') {
    expect(resolveHttpProxyUrlForTarget('https://bedrock-runtime.us-east-1.amazonaws.com', boundary.mock.calls[0]?.[2]?.env)?.origin)
      .toBe('http://127.0.0.1:18899')
  }
  boundary.mockClear()
  await drain()
  expect(boundary).toHaveBeenCalledOnce()
  expect(boundary.mock.calls[0]?.[2]?.env).toBeUndefined()
  expect(boundary.mock.calls[0]?.[2]?.transport).toBe('websocket')
})
