import { formatWithOptions, stripVTControlCharacters } from 'node:util'

/**
 * Send DeepSeek console diagnostics through the TUI renderer while it owns the terminal.
 * @param report - renders a notice in the transcript.
 * @param target - console methods to route.
 * @returns a disposer that restores normal console output.
 */
export function routeDeepSeekDiagnostics(
  report: (text: string) => void,
  target: Pick<Console, 'warn' | 'error'> = console,
): () => void {
  const { warn, error } = target
  const route = (original: typeof warn) => (...args: unknown[]): void => {
    const [message] = args
    if (typeof message === 'string' && message.startsWith('[deepseek-account] ')) {
      const diagnostic = formatWithOptions({ colors: false, compact: true, breakLength: Infinity, customInspect: false }, ...args)
      report(stripVTControlCharacters(diagnostic).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '))
    } else if (typeof message === 'string' && /^\[llm-deepseek(?:-api-key|-account)?\]$/.test(message)) {
      report(`${message} Model listing failed. Check the provider settings.`)
    } else {
      original.apply(target, args)
    }
  }
  const routedWarn = target.warn = route(warn)
  const routedError = target.error = route(error)
  return () => {
    if (target.warn === routedWarn) target.warn = warn
    if (target.error === routedError) target.error = error
  }
}
