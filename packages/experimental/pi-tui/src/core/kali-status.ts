/** Read-only readiness checks for the configured Kali terminal backend. */
import { win32 } from 'node:path'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import type { TerminalLocalConfig } from '@deepseek-ai/dsh-terminal-bash'

/** A successful probe confirms Kali identity and noninteractive Bash execution. */
export type KaliStatus = 'checking' | 'ready' | 'unavailable'

const PROBE = '. /etc/os-release && [ "$ID" = kali ] && printf "DSH_KALI_READY\\n"'

/**
 * Poll the active backend without opening a PTY or reading operator shell output.
 * Missing services/configuration and failed or timed-out commands report unavailable.
 * @param ctx - TUI owner; disposal cancels the current probe and stops polling.
 * @param config - refresh delay after settlement and per-probe deadline, in milliseconds.
 * @param update - receives checking before each probe and its confirmed result.
 */
export function watchKaliStatus(
  ctx: Context,
  config: { kaliStatusIntervalMs: number; kaliStatusTimeoutMs: number },
  update: (status: KaliStatus) => void,
): void {
  ctx.effect(() => {
    const lifetime = new AbortController()
    const active = (): boolean => !lifetime.signal.aborted
    let timer: NodeJS.Timeout | undefined
    let pending: Promise<void>
    const poll = async (): Promise<void> => {
      if (!active()) return
      const terminals = ctx.get('terminals')
      const entry = [...(ctx.get('loader')?.entries() ?? [])].find((entry) => {
        if (entry.options.name !== '@deepseek-ai/dsh-terminal-bash' || entry.fiber?.state !== FiberState.ACTIVE) return false
        const backend = entry.fiber.config as TerminalLocalConfig
        return backend.backendType === 'kali' && backend.shellDialect !== 'pwsh'
      })
      if (entry?.fiber === undefined || !terminals?.listBackends().includes('kali')) {
        update('unavailable')
      } else {
        const backend = entry.fiber.config as TerminalLocalConfig
        const command = backend.shellPath || '/bin/bash'
        const wsl = /^wsl(?:\.exe)?$/i.test(win32.basename(command))
        const args = wsl
          ? [...(backend.shellArgs ?? []), '--exec', '/bin/bash', '--noprofile', '--norc', '-c', PROBE]
          : [...(backend.shellArgs?.length ? backend.shellArgs : ['--noprofile', '--norc']), '-c', PROBE]
        const deadline = new AbortController()
        const timeout = setTimeout(() => { deadline.abort() }, config.kaliStatusTimeoutMs)
        const signal = AbortSignal.any([lifetime.signal, deadline.signal])
        update('checking')
        let status: KaliStatus = 'unavailable'
        try {
          const result = await runNativeCommand(command, args, signal, 'hidden')
          if (!signal.aborted && result.stdout.trim() === 'DSH_KALI_READY') status = 'ready'
        } catch (error) {
          // Missing WSL/distro and process failures are readiness failures, not TUI failures.
          void error
        } finally {
          clearTimeout(timeout)
        }
        if (active()) update(status)
      }
      if (active()) {
        timer = setTimeout(() => { pending = poll() }, config.kaliStatusIntervalMs)
        timer.unref()
      }
    }
    pending = poll()
    return async () => {
      lifetime.abort()
      clearTimeout(timer)
      await pending
    }
  })
}
