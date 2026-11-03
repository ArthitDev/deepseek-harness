/** Exact recorded shell-command path translation; execution and reported outcomes remain real. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-shell'

export const name = 'snapshot-shell-path'
export const inject = ['shell']

/** One recorded command and its isolated live filesystem target. */
export interface Config {
  command: string
  recordedPath: string
  livePath: string
}

/** Quote one path for a Bash single-quoted string. */
function shellLiteral(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

/** Use the configured Bash's own path converter for one native Windows path. */
function bashPathExpression(path: string): string {
  if (process.platform !== 'win32') return shellLiteral(path)
  const literal = shellLiteral(path)
  const conversion = [
    'if command -v wslpath >/dev/null 2>&1;',
    `then wslpath -a -- ${literal};`,
    `elif command -v cygpath >/dev/null 2>&1; then cygpath -au -- ${literal};`,
    'else exit 127; fi',
  ].join(' ')
  return `"$(${conversion})"`
}

/**
 * Translate one exact fixture command after tool logging and approval.
 * @param ctx - profile context with its real shell executor.
 * @param config - recorded command/path and allocated live target.
 */
export function apply(ctx: Context, config: Config): void {
  const shell = ctx.shell
  // oxlint-disable-next-line typescript/unbound-method -- preserve method identity for restoration; calls bind the receiver.
  const execute = shell.execute
  ctx.effect(() => {
    shell.execute = (spec) => {
      if (spec.command !== config.command) return execute.call(shell, spec)
      const command = spec.command.replaceAll(config.recordedPath, bashPathExpression(config.livePath))
      if (process.platform !== 'win32') return execute.call(shell, { ...spec, command })
      if (spec.stdin !== undefined) {
        throw new Error('snapshot-shell-path: the translated fixture command must not provide stdin.')
      }
      // WSL's legacy bash.exe argv parser splits nested quotes; feed the unchanged script through managed stdin.
      return execute.call(shell, { ...spec, command: 'bash -s', stdin: `${command}\n` })
    }
    return () => { shell.execute = execute }
  })
}
