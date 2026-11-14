/** Proxy-first model transport with pre-dispatch fallback to the existing provider route. */
import { get } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { installModelProxyDispatcher } from '@deepseek-ai/dsh-http-proxy'
import type {} from '@deepseek-ai/dsh-llm'

/** Check local sidecar identity and CONNECT capability without contacting a model backend. */
async function ready(endpoint: URL, timeout: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((complete) => {
    const request = get(new URL('/health', endpoint), { signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (part: string) => { body += part; if (body.length > 4096) response.destroy() })
      response.once('error', () => { complete(false) })
      response.once('close', () => { complete(false) })
      response.once('end', () => {
        try {
          const value: unknown = JSON.parse(body)
          complete(response.statusCode === 200 && typeof value === 'object' && value !== null
            && 'service' in value && value.service === 'dsh-sb-transport'
            && 'supportsConnect' in value && value.supportsConnect === true)
        } catch { complete(false) }
      })
    })
    request.once('error', () => { complete(false) })
  })
}

/**
 * Scope model transport to SB while retaining selected provider/model and ambient fallback.
 * The owner supplies bounded startup and active-stream accounting; cancellation never replays a request.
 * @param ctx - host owning the listener and dispatcher lifetime.
 * @param endpoint - owner's loopback SB transport origin.
 * @param timeout - deadline for one local capability probe, in milliseconds.
 * @param acquire - start/reserve SB; return a release operation, or reject before dispatch.
 * @returns a disposer that unregisters routing and restores the prior dispatcher.
 */
export async function installModelRouting(
  ctx: Context, endpoint: URL, timeout: number, acquire: () => Promise<() => Promise<void>>,
): Promise<() => Promise<void>> {
  const tokenFile = join(ctx.profileContext.home, 'run', 'sb-connect.key')
  await mkdir(join(ctx.profileContext.home, 'run'), { recursive: true, mode: 0o700 })
  try { await writeFile(tokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error }
  const token = await readFile(tokenFile, 'utf8')
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid SB CONNECT credential file; repair the runtime-owned key')
  const authenticated = new URL(endpoint)
  authenticated.username = 'dsh'
  authenticated.password = token
  const controller = new AbortController()
  let unavailable = false
  const routing = await installModelProxyDispatcher(authenticated)
  const remove = ctx.on('llm/stream', async function* (options, next) {
    const signal = options.signal === undefined ? controller.signal : AbortSignal.any([options.signal, controller.signal])
    let release: (() => Promise<void>) | undefined
    let onAbort = (): void => {}
    try {
      if (!signal.aborted) {
        const pending = acquire().then(async (reserved) => {
          if (signal.aborted) await reserved()
          else release = reserved
        })
        try {
          await Promise.race([pending, new Promise<void>((complete) => {
            onAbort = complete
            signal.addEventListener('abort', onAbort, { once: true })
            if (signal.aborted) complete()
          })])
        } catch (error) { void error /* Startup failure selects the existing route below. */ }
        finally { signal.removeEventListener('abort', onAbort) }
      }
      const available = release !== undefined && await ready(endpoint, timeout, signal)
      if (signal.aborted) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Model proxy wait cancelled' } } }
        return
      }
      if (!available) {
        if (!unavailable) ctx.logger.warn('SB Proxy unavailable; using the selected provider through the existing network policy')
        unavailable = true
        yield* next()
        return
      }
      unavailable = false
      const iterator = routing.run(() => next()[Symbol.asyncIterator]())
      let completed = false
      try {
        while (true) {
          const item = await routing.run(() => iterator.next())
          if (item.done) { completed = true; return }
          yield item.value
        }
      } finally {
        if (!completed) await routing.run(() => iterator.return?.())
      }
    } finally { await release?.() }
  }, { global: true })
  return async () => {
    controller.abort()
    remove()
    await routing.dispose()
  }
}
