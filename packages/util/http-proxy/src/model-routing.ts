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
 * What the proxy arm last observed for one model call in scope.
 *
 * `lastStatus` is the final HTTP status a tunneled request received (provider or gateway answer);
 * `lastError` is transport-level failure text observed before any status arrived (proxy CONNECT
 * refusal, socket error). Both are advisory: the request's own failure classification stays
 * authoritative; adapters consult this only to sharpen a failure already classified as transport.
 */
export interface ModelProxyOutcome {
  /** The local proxy origin the request was routed through; may carry credentials — never log it. */
  readonly endpoint: string
  /** Final HTTP status the tunneled request received, when one arrived. */
  readonly lastStatus?: number
  /** Transport-level failure text observed when no status arrived. */
  readonly lastError?: string
}

interface OutcomeRecord { lastStatus?: number; lastError?: string }

/** Reads the active model-proxy scope's last transport outcome; process-global like the dispatcher. */
let outcomeReader: (() => ModelProxyOutcome | undefined) | undefined

/**
 * Read the transport outcome the active model-proxy scope last recorded.
 * @returns the outcome for model work in the current async scope, or `undefined` for direct work.
 *   Advisory only; never log the endpoint when it may carry credentials.
 */
export function modelProxyOutcomeForCall(): ModelProxyOutcome | undefined {
  return outcomeReader?.()
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
  const previousOutcomeReader = outcomeReader
  const proxy = new ProxyAgent({ uri: endpoint.href, proxyTunnel: true })
  const scope = new AsyncLocalStorage<OutcomeRecord>()
  const origin = endpoint.href.replace(/\/$/, '')
  class ScopedDispatcher extends Dispatcher {
    modelProxyEndpoint(): string | undefined {
      return scope.getStore() !== undefined ? origin : modelProxyEndpointOf(previous)
    }
    override dispatch(options: DispatcherTypes.DispatchOptions, handler: DispatcherTypes.DispatchHandler): boolean {
      // Legacy SB providers already address this proxy's /v1 passthrough directly.
      const record = scope.getStore()
      const proxied = record !== undefined && options.origin?.toString() !== endpoint.origin
      if (!proxied) return previous.dispatch(options, handler)
      // Record what the proxy arm observed so an adapter can distinguish a
      // proxy CONNECT failure from a provider answer the SDK flattened away.
      // undici 8's request handlers speak the onRequestStart/… vocabulary.
      const recording: DispatcherTypes.DispatchHandler = {
        onRequestStart: (controller, context) => handler.onRequestStart?.(controller, context),
        onResponseStart: (controller, statusCode) => {
          record.lastStatus = statusCode
          handler.onResponseStart?.(controller, statusCode, {}, undefined)
        },
        onResponseError: (controller, error) => {
          record.lastError = error instanceof Error ? error.message : String(error)
          handler.onResponseError?.(controller, error)
        },
        onResponseData: (controller, chunk) => { handler.onResponseData?.(controller, chunk) },
        onResponseEnd: (controller, trailers) => { handler.onResponseEnd?.(controller, trailers) },
        onRequestSent: () => { handler.onRequestSent?.() },
        onRequestUpgrade: (controller, statusCode, headers, socket) =>
          handler.onRequestUpgrade?.(controller, statusCode, headers, socket),
      }
      try {
        return proxy.dispatch(options, recording)
      } catch (error: unknown) {
        // undici throws synchronously for a malformed CONNECT target before any
        // handler runs; the adapter must still see the transport failure.
        record.lastError = error instanceof Error ? error.message : String(error)
        throw error
      }
    }
  }
  const dispatcher = new ScopedDispatcher()
  outcomeReader = () => {
    const record = scope.getStore()
    if (record !== undefined) return { endpoint: origin, ...record }
    return previousOutcomeReader?.()
  }
  setGlobalDispatcher(dispatcher)
  return {
    run: operation => scope.run({}, operation),
    async dispose() {
      if (getGlobalDispatcher() !== dispatcher) throw new Error('model proxy dispatcher must be disposed in reverse installation order')
      outcomeReader = previousOutcomeReader
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
