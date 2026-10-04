import { describe, expect, it } from 'vitest'
import chalk from 'chalk'
import { editorTheme, markdownTheme, reasoningMarkdownTheme, selectListTheme, style } from '../src/ui/theme.ts'

/** Call every theme function so the module's arrow members all execute. */
function callEvery(theme: object): void {
  const fns = Object.values(theme).filter(
    (value): value is (text: string) => string => typeof value === 'function',
  )
  for (const value of fns) value('text')
}

describe('theme tables', () => {
  it('defines markdown styling callbacks', () => {
    callEvery(markdownTheme)
    expect(markdownTheme.heading('h')).toBe(chalk.bold.blue('h'))
    expect(markdownTheme.link('l')).toBe(chalk.underline.blue('l'))
    expect(markdownTheme.code('c')).toBe(chalk.cyan('c'))
    expect(markdownTheme.listBullet('b')).toBe(chalk.blue('b'))
    expect(markdownTheme.bold('b')).toBe(chalk.bold('b'))
    expect(markdownTheme.italic('i')).toBe(chalk.italic('i'))
  })

  it('dims reasoning markdown with italic overrides', () => {
    callEvery(reasoningMarkdownTheme)
    expect(reasoningMarkdownTheme.italic('i')).toBe(chalk.italic.dim('i'))
    expect(reasoningMarkdownTheme.heading('h')).toEqual(markdownTheme.heading('h'))
  })

  it('defines the select-list theme', () => {
    callEvery(selectListTheme)
    expect(selectListTheme.selectedPrefix('❯')).toBe(chalk.hex('#4fc1ff')('❯ '))
    expect(selectListTheme.selectedText('t')).toBe(chalk.bold.blue('t'))
    expect(selectListTheme.description('d')).toBe(chalk.dim('d'))
  })

  it('defines the editor theme over the select-list theme', () => {
    callEvery(editorTheme)
    expect(editorTheme.selectList).toBe(selectListTheme)
    expect(editorTheme.borderColor('b')).toBe(chalk.dim('b'))
  })

  it('defines the transcript style helpers', () => {
    callEvery(style)
    expect(style.accent('a')).toBe(chalk.hex('#4fc1ff')('a'))
    expect(style.userPrefix('❯')).toBe(chalk.hex('#4fc1ff')('❯ '))
    expect(style.userText('u')).toBe(chalk.bold('u'))
    expect(style.toolName('t')).toBe(chalk.cyan.bold('t'))
    expect(style.toolOk('t')).toBe(chalk.green('t'))
    expect(style.toolError('t')).toBe(chalk.red('t'))
    expect(style.toolResult('t')).toBe(chalk.hex('#8899aa')('t'))
    expect(style.spinner('s')).toBe(chalk.blue('s'))
    expect(style.statusBar('s')).toBe(chalk.dim('s'))
  })
})
