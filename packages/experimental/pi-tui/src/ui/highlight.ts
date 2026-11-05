/** Terminal code highlighting with named grammars and one output line per source line. */
import chalk, { type ChalkInstance } from 'chalk'
import hljs from 'highlight.js'

const languages = new Map<string, string>()
for (const name of hljs.listLanguages()) {
  languages.set(name, name)
  for (const alias of hljs.getLanguage(name)?.aliases ?? []) languages.set(alias.toLowerCase(), name)
}
for (const [alias, name] of Object.entries({
  node: 'javascript', py3: 'python', python3: 'python', zsh: 'bash',
  shell: 'bash', jsonc: 'json', json5: 'json', 'c/c++': 'cpp', 'c#': 'csharp',
})) languages.set(alias, name)

/**
 * Resolve a fenced language name or alias; unknown names remain uncolored.
 * @param lang - fence info string, optionally including a filename or other metadata.
 * @returns the registered grammar name, or undefined for absent or unknown names.
 */
export function languageFamily(lang: string | undefined): string | undefined {
  const name = lang?.trim().toLowerCase().split(/\s+/, 1)[0]?.replace(/^language-/, '')
  return name === undefined ? undefined : languages.get(name)
}

/** Token colors; nested scopes inherit the enclosing color when no color is assigned. */
function scopeColor(classes: string): ChalkInstance | undefined {
  const scopes = classes.replaceAll('hljs-', '').split(/\s+/)
  if (scopes.some(scope => ['comment', 'quote'].includes(scope))) return chalk.gray
  if (scopes.some(scope => ['string', 'regexp', 'section'].includes(scope))) return chalk.green
  if (scopes.includes('number')) return chalk.hex('#d19a66')
  if (scopes.some(scope => ['keyword', 'literal', 'doctag'].includes(scope))) return chalk.magenta
  if (scopes.some(scope => ['type', 'built_in', 'attr', 'attribute', 'variable', 'params'].includes(scope))) return chalk.yellow
  if (scopes.some(scope => ['title', 'name', 'tag', 'selector-tag', 'selector-class', 'selector-id'].includes(scope))) return chalk.cyan
  if (scopes.includes('meta')) return chalk.blue
  if (scopes.includes('addition')) return chalk.green
  if (scopes.includes('deletion')) return chalk.red
  return undefined
}

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" }

/** Convert highlight.js's escaped text and nested token spans to terminal colors. */
function terminalCode(html: string): string {
  const colors: (ChalkInstance | undefined)[] = []
  let output = ''
  let offset = 0
  const append = (encoded: string): void => {
    const text = encoded.replace(/&(?:amp|lt|gt|quot|#x27);/g, entity => entities[entity] ?? entity)
    const color = colors.at(-1)
    output += color === undefined ? text : color(text)
  }
  for (const match of html.matchAll(/<span class="([^"]*)">|<\/span>/g)) {
    append(html.slice(offset, match.index))
    offset = match.index + match[0].length
    if (match[1] === undefined) colors.pop()
    else colors.push(scopeColor(match[1]) ?? colors.at(-1))
  }
  append(html.slice(offset))
  return output
}

/**
 * Highlight a complete or still-streaming block, preserving multiline token state and source text.
 * @param text - code block body.
 * @param lang - fenced language name or alias; unknown names render plain without auto-detection.
 * @returns one colored line per source line, including blank and trailing lines.
 */
export function highlightCode(text: string, lang: string | undefined): string[] {
  const language = languageFamily(lang)
  if (language === undefined || text.length === 0) return text.split('\n')
  const html = hljs.highlight(text, { language, ignoreIllegals: true }).value
  return terminalCode(html).split('\n')
}

/**
 * Highlight one standalone line; multiline blocks use highlightCode to retain token state.
 * @param line - source line.
 * @param lang - fenced language name or alias.
 * @returns the colored source line.
 */
export function highlightLine(line: string, lang: string | undefined): string {
  return highlightCode(line, lang).join('\n')
}
