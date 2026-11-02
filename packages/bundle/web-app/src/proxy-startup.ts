/** Shared checkout proxy lifecycle for Web and terminal hosts. */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'

/**
 * Start or reuse the checkout's shared ZCode proxy.
 * @param installAnchor - CLI package manifest supplied by profileContext.
 * @param signal - Cancels the helper, leaving an already running proxy available.
 * @throws when startup fails or exceeds the helper deadline.
 */
export async function ensureZcodeProxy(installAnchor: string, signal?: AbortSignal): Promise<void> {
  await ensureProxy(installAnchor, 'sb-auto-start.cjs', 'start-zcode', 'ZCode', signal)
}

/**
 * Start or reuse the checkout's transparent SB transport.
 * @param installAnchor - CLI package manifest supplied by profileContext.
 * @param signal - Cancels the helper, leaving an already running transport available.
 * @throws when startup fails or exceeds the helper deadline.
 */
export async function ensureSbProxy(installAnchor: string, signal?: AbortSignal): Promise<void> {
  await ensureProxy(installAnchor, 'sb-transport.cjs', 'start', 'SB', signal)
}

async function ensureProxy(installAnchor: string, script: string, command: string, label: string, signal?: AbortSignal): Promise<void> {
  const root = resolve(dirname(installAnchor), '../..')
  await new Promise<void>((complete, reject) => {
    const helper = spawn(process.execPath, [resolve(root, 'scripts', script), command], {
      cwd: root, stdio: 'ignore', windowsHide: true, timeout: 300_000, signal,
    })
    let failure: Error | undefined
    helper.once('error', (error) => { failure = error })
    helper.once('close', (code, exitSignal) => {
      if (code === 0 && failure === undefined) complete()
      else reject(failure ?? new Error(`${label} startup helper exited with ${String(exitSignal ?? code)}`))
    })
  })
}

/**
 * Await one shared ZCode startup attempt before matching model requests.
 * Other providers proceed independently; disposal cancels and awaits the helper.
 * @param ctx - host context owning the stream listener and helper lifetime.
 * @param installAnchor - CLI package manifest supplied by profileContext.
 * @param warn - host-specific startup failure notice, invoked once without credential details.
 */
export function installZcodeStartup(ctx: Context, installAnchor: string, warn: () => void): void {
  const controller = new AbortController()
  let startup: Promise<void> | undefined
  ctx.on('llm/stream', async function* (options, next) {
    if (options.provider === 'zcode-direct' || /^zcode\/glm-5\.3(?:-flash)?$/.test(options.model)) {
      const signal = options.signal === undefined ? controller.signal : AbortSignal.any([options.signal, controller.signal])
      if (!signal.aborted) {
        startup ??= ensureZcodeProxy(installAnchor, controller.signal).catch(() => {
          if (!controller.signal.aborted) warn()
        })
        let onAbort = (): void => {}
        try {
          await Promise.race([startup, new Promise<void>((complete) => {
            onAbort = complete
            signal.addEventListener('abort', onAbort, { once: true })
          })])
        } finally { signal.removeEventListener('abort', onAbort) }
      }
      if (signal.aborted) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'ZCode startup wait cancelled' } } }
        return
      }
    }
    yield* next()
  }, { global: true })
  ctx.effect(() => async () => {
    controller.abort()
    await startup
  })
}
