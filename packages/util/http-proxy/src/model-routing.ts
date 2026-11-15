/** Request-scoped model routing layered over the launcher's ambient transport policy. */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Dispatcher as DispatcherTypes } from 'undici'

/** One installed dispatcher whose proxy arm is entered only by its owner's model calls. */
export interface ModelProxyScope {
  /** Execute model transport work through the proxy; unrelated async chains keep the previous dispatcher.
   * @param operation - iterator construction, advancement, or cleanup owned by one model call.
   * @returns the operation's unchanged result.
   */
  run<T>(operation: () => T): T
  /** Restore the previous dispatcher and abort/await this scope's proxy connections. */
  dispose(): Promise<void>
}

/**
 * Install an opaque CONNECT transport for explicitly scoped model work.
 * Requests outside the scope retain the previous dispatcher, including its VPN/proxy policy.
 * This layer never retries a request or changes its URL, payload, headers, provider, or model.
 * @param endpoint - local forward-proxy origin, already validated by the owning plugin.
 * @returns a scope whose owner must dispose after unregistering its model listener.
 */
export async function installModelProxyDispatcher(endpoint: URL): Promise<ModelProxyScope> {
  const { Dispatcher, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } = await import('undici')
  const previous = getGlobalDispatcher()
  const proxy = new ProxyAgent({ uri: endpoint.href, proxyTunnel: true })
  const scope = new AsyncLocalStorage<boolean>()
  class ScopedDispatcher extends Dispatcher {
    modelProxyEndpoint(): string | undefined {
      return scope.getStore() === true ? endpoint.href.replace(/\/$/, '') : modelProxyEndpointOf(previous)
    }
    override dispatch(options: DispatcherTypes.DispatchOptions, handler: DispatcherTypes.DispatchHandler): boolean {
      // Legacy SB providers already address this proxy's /v1 passthrough directly.
      const proxied = scope.getStore() === true && options.origin?.toString() !== endpoint.origin
      return (proxied ? proxy : previous).dispatch(options, handler)
    }
  }
  const dispatcher = new ScopedDispatcher()
  setGlobalDispatcher(dispatcher)
  return {
    run: operation => scope.run(true, operation),
    async dispose() {
      if (getGlobalDispatcher() !== dispatcher) throw new Error('model proxy dispatcher must be disposed in reverse installation order')
      setGlobalDispatcher(previous)
      scope.disable()
      await proxy.destroy()
    },
  }
}

/**
 * Read the explicit model scope for SDKs that use agents instead of native fetch.
 * Outside that scope, preserve the SDK's normal transport and environment.
 * @returns the active local proxy URL, possibly containing credentials; never log it. Undefined for ambient/direct work.
 */
export async function modelProxyEndpointForCall(): Promise<string | undefined> {
  const { getGlobalDispatcher } = await import('undici')
  return modelProxyEndpointOf(getGlobalDispatcher())
}

function modelProxyEndpointOf(dispatcher: DispatcherTypes): string | undefined {
  if ('modelProxyEndpoint' in dispatcher && typeof dispatcher.modelProxyEndpoint === 'function') {
    const readEndpoint = dispatcher.modelProxyEndpoint as () => unknown
    const endpoint = readEndpoint.call(dispatcher)
    return typeof endpoint === 'string' ? endpoint : undefined
  }
  return undefined
}
