import { expect, it, onTestFinished } from 'vitest'
import { installModelProxyDispatcher, modelProxyEndpointForCall, modelProxyOutcomeForCall } from '../src/model-routing.ts'

it('retains the outer model proxy when a later installation has no active call', async () => {
  const outerUrl = new URL('http://127.0.0.1:18899')
  const innerUrl = new URL('http://127.0.0.1:18900')
  const outer = await installModelProxyDispatcher(outerUrl)
  const inner = await installModelProxyDispatcher(innerUrl)
  onTestFinished(async () => { await inner.dispose(); await outer.dispose() })

  expect(await modelProxyEndpointForCall()).toBeUndefined()
  expect(await outer.run(() => modelProxyEndpointForCall())).toBe(outerUrl.origin)
  expect(await outer.run(() => inner.run(() => modelProxyEndpointForCall()))).toBe(innerUrl.origin)
  expect(await outer.run(() => modelProxyEndpointForCall())).toBe(outerUrl.origin)
})

it('keeps concurrent model scopes and unrelated async work independent', async () => {
  const outerUrl = new URL('http://127.0.0.1:18899')
  const innerUrl = new URL('http://127.0.0.1:18900')
  const outer = await installModelProxyDispatcher(outerUrl)
  const inner = await installModelProxyDispatcher(innerUrl)
  onTestFinished(async () => { await inner.dispose(); await outer.dispose() })
  const barrier = Promise.withResolvers<undefined>()
  const outerCall = outer.run(async () => { await barrier.promise; return modelProxyEndpointForCall() })
  const innerCall = inner.run(async () => { await barrier.promise; return modelProxyEndpointForCall() })
  const unrelated = (async () => { await barrier.promise; return modelProxyEndpointForCall() })()
  barrier.resolve(undefined)

  expect(await Promise.all([outerCall, innerCall, unrelated])).toEqual([outerUrl.origin, innerUrl.origin, undefined])
})

it('reports no outcome outside a model scope', () => {
  expect(modelProxyOutcomeForCall()).toBeUndefined()
})

it('restores the previous outcome reader in reverse installation order', async () => {
  const outer = await installModelProxyDispatcher(new URL('http://127.0.0.1:18899'))
  const inner = await installModelProxyDispatcher(new URL('http://127.0.0.1:18900'))
  onTestFinished(async () => { await outer.dispose() })
  await inner.dispose()
  expect(await outer.run(() => modelProxyOutcomeForCall())?.endpoint).toBe('http://127.0.0.1:18899')
})
