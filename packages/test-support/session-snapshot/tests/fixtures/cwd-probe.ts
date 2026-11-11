/** Recorded-session probe of an ordinary process start with an absent working directory. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'snapshot-cwd-probe'
export const inject = ['tools', 'subprocess'] as const

/**
 * Register the probe in the scenario's selected child preset.
 * @param ctx - scenario child context with tools and local subprocess services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'probe_invalid_workdir',
    description: 'Start a harmless Node process in an absent directory to inspect the working-directory error.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => {
      const handle = ctx.subprocess.spawn({
        argv: [process.execPath, '-e', ''], cwd: `${process.cwd()}/missing-role-workdir`,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 100 }, stderr: { maxBytes: 100 } }, graceMs: 100,
      })
      try {
        await handle.done
        return 'Unexpectedly started in the absent directory.'
      } finally { await handle.waitForExit() }
    },
  })))
}
