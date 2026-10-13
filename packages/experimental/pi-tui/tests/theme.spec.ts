import { describe, expect, it } from 'vitest'
import chalk from 'chalk'
import {
  editorTheme,
  gradient,
  markdownTheme,
  reasoningMarkdownTheme,
  selectListTheme,
  style,
} from '../src/ui/theme.ts'

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
    expect(markdownTheme.heading('h')).toBe(chalk.bold.hex('#ff6b7a')('h'))
    expect(markdownTheme.link('l')).toBe(chalk.underline.blue('l'))
    expect(markdownTheme.code('c')).toBe(chalk.cyan('c'))
    expect(markdownTheme.listBullet('b')).toBe(chalk.hex('#ff4655')('b'))
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
    expect(selectListTheme.selectedPrefix('❯')).toBe(chalk.hex('#ff4655')('❯ '))
    expect(selectListTheme.selectedText('t')).toBe(chalk.bold.white('t'))
    expect(selectListTheme.description('d')).toBe(chalk.dim('d'))
  })

  it('defines the editor theme over the select-list theme', () => {
    callEvery(editorTheme)
    expect(editorTheme.selectList).toBe(selectListTheme)
    expect(editorTheme.borderColor('b')).toBe(chalk.dim('b'))
  })

  it('defines the transcript style helpers', () => {
    callEvery(style)
    expect(style.accent('a')).toBe(chalk.hex('#ff4655')('a'))
    expect(style.userPrefix('›')).toBe(chalk.hex('#ff4655')('› '))
    expect(style.userText('u')).toBe(chalk.bold('u'))
    expect(style.thinkingLabel('t')).toBe(chalk.dim.italic('t'))
    expect(style.toolName('t')).toBe(chalk.cyan.bold('t'))
    expect(style.toolOk('t')).toBe(chalk.green('t'))
    expect(style.toolError('t')).toBe(chalk.red('t'))
    expect(style.toolResult('t')).toBe(chalk.hex('#8899aa')('t'))
    expect(style.spinner('s')).toBe(chalk.hex('#ff4655')('s'))
    expect(style.statusBar('s')).toBe(chalk.dim('s'))
  })

  it('gradients short brand text in truecolor', () => {
    expect(gradient('AB', '#ff4655', '#ff9a3d')).toBe(
      chalk.rgb(255, 70, 85)('A') + chalk.rgb(255, 154, 61)('B'),
    )
    expect(gradient('A', '#ff4655', '#ff9a3d')).toBe(chalk.rgb(255, 70, 85)('A'))
    expect(gradient('', '#ff4655', '#ff9a3d')).toBe('')
  })

  it('keeps the gradient plain below the truecolor level', () => {
    const previous = chalk.level
    try {
      chalk.level = 2
      expect(gradient('AB', '#ff4655', '#ff9a3d')).toBe('AB')
    } finally {
      chalk.level = previous
    }
  })
})
