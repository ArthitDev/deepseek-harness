/**
 * Lightweight terminal syntax highlighting for assistant code blocks —
 * zero dependencies, one regex pass per line, output line count always
 * matches the input line count so the markdown renderer's line accounting
 * is preserved.
 */
import chalk from 'chalk'

const KEYWORDS: Record<string, readonly string[]> = {
  ts: [
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'import', 'export', 'from', 'class',
    'extends', 'new', 'await', 'async', 'try', 'catch', 'throw', 'typeof', 'interface', 'type', 'enum', 'switch',
    'case', 'break', 'continue', 'default', 'in', 'of', 'this', 'null', 'undefined', 'true', 'false', 'static',
    'readonly', 'public', 'private', 'as',
  ],
  js: [
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'import', 'export', 'from', 'class',
    'extends', 'new', 'await', 'async', 'try', 'catch', 'throw', 'typeof', 'switch', 'case', 'break', 'continue',
    'default', 'in', 'of', 'this', 'null', 'undefined', 'true', 'false',
  ],
  py: [
    'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'class', 'try', 'except', 'finally',
    'raise', 'with', 'as', 'lambda', 'pass', 'break', 'continue', 'in', 'not', 'and', 'or', 'None', 'True', 'False',
    'self', 'async', 'await', 'yield', 'global', 'assert',
  ],
  sh: ['if', 'then', 'else', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'echo', 'export', 'return', 'local', 'cd', 'set'],
  json: ['true', 'false', 'null'],
  sql: ['select', 'from', 'where', 'insert', 'into', 'update', 'delete', 'join', 'left', 'inner', 'group', 'order', 'by', 'limit', 'create', 'table', 'alter', 'drop'],
  go: ['func', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'var', 'const', 'type', 'struct', 'interface', 'go', 'defer', 'chan', 'select', 'switch', 'case', 'map', 'nil'],
  rs: ['fn', 'let', 'mut', 'return', 'if', 'else', 'for', 'while', 'loop', 'match', 'struct', 'enum', 'impl', 'use', 'pub', 'mod', 'crate', 'self', 'Some', 'None', 'Ok', 'Err'],
}

const ALIASES: Record<string, keyof typeof KEYWORDS | undefined> = {
  typescript: 'ts', tsx: 'ts', javascript: 'js', jsx: 'js', node: 'js', mjs: 'js', cjs: 'js',
  python: 'py', py3: 'py', python3: 'py',
  shell: 'sh', bash: 'sh', zsh: 'sh', console: 'sh', powershell: 'sh', ps1: 'sh',
  jsonc: 'json', json5: 'json',
  golang: 'go', rust: 'rs', rs: 'rs',
  yaml: 'sh', yml: 'sh', toml: 'sh', ini: 'sh', dockerfile: 'sh', diff: 'sh',
  sql: 'sql',
}

/** language id → tokenizer family. */
export function languageFamily(lang: string | undefined): string | undefined {
  if (lang === undefined || lang === '') return undefined
  const key = lang.toLowerCase().trim()
  return KEYWORDS[key] !== undefined ? key : ALIASES[key]
}

/** One combined scanner: strings and comments first so keywords inside them stay untouched. */
const TOKEN_PATTERN = new RegExp(
  [
    '(--\\s.*|//\\s.*|#\\s.*|/\\*[\\s\\S]*?\\*/)',
    '("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)',
    '(\\b\\d+(?:\\.\\d+)?\\b)',
    '([A-Za-z_][A-Za-z0-9_]*)(\\s*\\()?',
  ].join('|'),
  'g',
)

/** Color helpers resolved per call so the current chalk level always applies. */
const colors = () => ({
  keyword: chalk.magenta,
  string: chalk.green,
  comment: chalk.gray,
  number: chalk.hex('#d19a66'),
  fn: chalk.cyan,
})

/**
 * Colorize one line of code. Line-based by design: the caller maps a code
 * block's lines through this and renders one output line per input line.
 * @param line - one line of source text.
 * @param lang - fenced language id (`ts`, `python`, `bash`, …); unknown ids render plain.
 * @returns the colored line.
 */
export function highlightLine(line: string, lang: string | undefined): string {
  if (line.trim() === '') return line
  const family = languageFamily(lang)
  if (family === undefined) return line
  const keywords = KEYWORDS[family] ?? []
  const c = colors()
  let out = ''
  let lastIndex = 0
  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const index = match.index
    out += line.slice(lastIndex, index)
    lastIndex = index + match[0].length
    const [comment, str, num, word, callParen] = match.slice(1)
    if (comment !== undefined) {
      out += c.comment(comment)
      continue
    }
    if (str !== undefined) {
      out += c.string(str)
      continue
    }
    if (num !== undefined) {
      out += c.number(num)
      continue
    }
    if (word !== undefined) {
      if (keywords.includes(word) && family !== 'json') {
        out += callParen !== undefined ? c.keyword(word + callParen) : c.keyword(word)
        continue
      }
      if (callParen !== undefined) {
        out += c.fn(word) + callParen
        continue
      }
      out += word
      continue
    }
    out += match[0]
  }
  out += line.slice(lastIndex)
  return out
}

/**
 * Colorize a fenced code block, one output line per input line.
 * @param code - the full code block text (may be multi-line).
 * @param lang - fenced language id; unknown ids render plain.
 * @returns one colored line per source line — the markdown renderer renders
 * each entry as its own line, so the count must not change.
 */
export function highlightCode(text: string, lang: string | undefined): string[] {
  return text.split('\n').map(line => highlightLine(line, lang))
}
