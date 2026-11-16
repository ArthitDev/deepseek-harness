/** Required model transport through SB; unavailable routing blocks before dispatch. */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { installModelProxyDispatcher } from '@deepseek-ai/dsh-http-proxy'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-llm'

/**
 * Scope model transport to SB while retaining the selected provider and model.
 * The owner supplies bounded startup and active-stream accounting; cancellation never replays a request.
 * @param ctx - host owning the listener and dispatcher lifetime.
 * @param endpoint - owner's loopback SB transport origin.
 * @param acquire - await verified SB CONNECT readiness and reserve it; cancellation rejects before dispatch.
 * @returns a disposer that unregisters routing and restores the prior dispatcher.
 */
export async function installModelRouting(
  ctx: Context, endpoint: URL, acquire: (signal: AbortSignal) => Promise<() => Promise<void>>,
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
  const routing = await installModelProxyDispatcher(authenticated)
  const remove = ctx.on('llm/stream', async function* (options, next) {
    const signal = options.signal === undefined ? controller.signal : AbortSignal.any([options.signal, controller.signal])
    let release: (() => Promise<void>) | undefined
    let unavailableMessage = 'SB Proxy unavailable; model request blocked. Check Proxy Server settings and local setup.'
    let onAbort = (): void => {}
    try {
      if (!signal.aborted) {
        const pending = acquire(signal).then(async (reserved) => {
          if (signal.aborted) await reserved()
          else release = reserved
        })
        try {
          await Promise.race([pending, new Promise<void>((complete) => {
            onAbort = complete
            signal.addEventListener('abort', onAbort, { once: true })
            if (signal.aborted) complete()
          })])
        } catch (error) { unavailableMessage = remoteErrorOf(error)?.message ?? unavailableMessage }
        finally { signal.removeEventListener('abort', onAbort) }
      }
      if (signal.aborted) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Model proxy wait cancelled' } } }
        return
      }
      if (release === undefined) {
        yield { type: 'finish', reason: { kind: 'error', failure: {
          code: 'proxy-server/start-failed',
          message: unavailableMessage,
        } } }
        return
      }
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
