/**
 * WorkspaceBrowser spacing contract, asserted against the CSS text on disk:
 * row fills share the shell's trailing inset, the stable scrollbar counts
 * inside it, and flat, grouped, and search views keep their intended rhythm.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/rows/WorkspaceBrowser.module.css', import.meta.url)), 'utf8')
const rowsCss = readFileSync(fileURLToPath(new URL('../src/client/rows/Rows.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one selector rule, keyed by property with whitespace collapsed.
 * Declaration order and trailing semicolons are normalized away.
 * @param selector - one exact selector, including a leading dot for local classes.
 * @returns the rule's declarations, or undefined when no such rule exists.
 */
function declarationsFrom(source: string, selector: string): Map<string, string> | undefined {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found = new Map<string, string>()
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

const declarations = (selector: string): Map<string, string> | undefined => declarationsFrom(css, selector)
const rowDeclarations = (selector: string): Map<string, string> | undefined => declarationsFrom(rowsCss, selector)

describe('WorkspaceBrowser.module.css list', () => {
  const root = declarations('.root')
  const listArea = declarations('.listArea')
  const list = declarations('.list')

  it('is the scrolling region', () => {
    expect(list).toBeDefined()
    expect(list!.get('overflow-y')).toBe('auto')
  })

  it('counts the themed scrollbar inside the shell trailing inset', () => {
    expect(root?.get('--dsh-session-list-edge-inset')).toBe('var(--dsh-sidebar-inline-padding)')
    expect(root?.get('--dsh-session-list-scrollbar-width')).toBe('5px')
    expect(root?.get('--dsh-session-list-scrollbar-offset')).toBe('2px')
    expect(root?.get('padding-right')).toBe('var(--dsh-session-list-edge-inset)')
    expect(listArea?.get('margin-left')).toBe('-4px')
    expect(listArea?.get('padding-left')).toBe('4px')
    expect(listArea?.get('margin-right')).toBe('calc(-1 * var(--dsh-session-list-edge-inset))')
    expect(declarations('.fade')?.get('right')).toBe('var(--dsh-session-list-edge-inset)')
    expect(list?.get('margin-right')).toBe('var(--dsh-session-list-scrollbar-offset)')
    expect(list?.get('margin-left')).toBe('-4px')
    expect(list?.get('padding-left')).toBe('4px')
    expect(list?.get('padding-right')).toBe([
      'calc(',
      'var(--dsh-session-list-edge-inset)',
      '- var(--dsh-session-list-scrollbar-width)',
      '- var(--dsh-session-list-scrollbar-offset)',
      ')',
    ].join(' '))
    expect(declarations('.list::-webkit-scrollbar')).toBeUndefined()
  })

  it('reserves the scrollbar whether or not the list overflows', () => {
    expect(list!.get('scrollbar-gutter')).toBe('stable')
  })

  it('keeps 2px between rows and 4px between workspace groups', () => {
    expect(declarations('.flatList > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations(".searchTree > [role='treeitem'] + [role='treeitem']")?.get('margin-top')).toBe('2px')
    expect(declarations('.groupSection > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations('.groupSection + .groupSection')?.get('margin-top')).toBe('4px')
  })

  it('draws drag targets as a leading chevron joined to the insertion line', () => {
    const listTopMarker = declarations('.listTopDropIndicator')
    const workspaceMarker = declarations('.workspaceDropBefore::before')
    const sessionMarker = rowDeclarations('.sessionRow.dropBefore::before')
    expect(listTopMarker?.get('top')).toBe('-8px')
    expect(listTopMarker?.get('left')).toBe('0')
    expect(workspaceMarker?.get('left')).toBe('0')
    expect(sessionMarker?.get('left')).toBe('0')
    for (const marker of [listTopMarker, workspaceMarker, sessionMarker]) {
      expect(marker?.get('height')).toBe('12px')
      expect(marker?.get('background')).not.toContain('radial-gradient')
      expect(marker?.get('background')).toContain('55deg')
      expect(marker?.get('background')).toContain('125deg')
      expect(marker?.get('background')).toContain('calc(50% - 1px) calc(50% + 1px)')
      expect(marker?.get('background')).toContain('0 0 / 5px 7px')
      expect(marker?.get('background')).toContain('0 5px / 5px 7px')
      expect(marker?.get('background')).toContain('4px 5px / calc(100% - 4px) 2px')
    }
  })

  it('keeps the compact fade, overflow control, search field, and row heights', () => {
    expect(declarations('.fade')?.get('height')).toBe('24px')
    expect(declarations('.sessionOverflowButton')?.get('height')).toBe('32px')
    expect(declarations('.searchExpanded')?.get('height')).toBe('30px')
    expect(rowDeclarations('.projectRow')?.get('height')).toBe('34px')
    expect(rowDeclarations('.sessionRow')?.get('height')).toBe('32px')
    expect(rowDeclarations('.flatSessionRowWithoutStatus .title')?.get('margin-left')).toBe('0')
    expect(rowDeclarations('.searchResultRow')?.get('min-height')).toBe('48px')
    expect(rowDeclarations('.sessionRow.selected')?.get('background'))
      .toBe('var(--dsw-alias-interactive-bg-hover)')
  })

  it('chains the session guide through per-row segments with no overlap', () => {
    // The status slot sits 6px into the 32px row, so the elbow's span-relative
    // box [-8px, 10px] lands on row-relative [-2px, 16px]: its tick crosses
    // the row midline, and the box starts above the 2px row margin where the
    // previous row's drop segment ends. The drop segment then covers the
    // row's lower half, so consecutive rows chain one single-painted guide —
    // a section-level spine under the elbows would double-brighten.
    const connector = declarations(".groupSection > * > [data-row-key^='session:'] > [data-tree-connector]")
    expect(connector?.get('top')).toBe('-2px')
    expect(connector?.get('height')).toBe('34px')
    expect(connector?.get('width')).toBe('8px')
    expect(connector?.get('background')).toContain('1px 100%')
    const terminal = declarations(
      ".groupSection > :last-child > [data-row-key^='session:'] > [data-tree-connector]",
    )
    expect(terminal?.get('background-size')).toBe('1px 19px, 7px 1px')
    const overflowElbow = declarations('.sessionOverflowButton::before')
    expect(overflowElbow?.get('top')).toBe('-2px')
    expect(overflowElbow?.get('height')).toBe('18px')
    expect(overflowElbow?.get('width')).toBe('8px')
    expect(overflowElbow?.get('box-shadow')).toBe('inset 1px -1px 0 var(--dsh-tree-line)')
    expect(declarations('.sessionOverflowButton')?.get('padding')).toBe('0 12px 0 28px')
    expect(declarations('.sessionOverflowButton')?.get('height')).toBe('32px')
  })

  it('continues the last nested group down to the section rows that follow', () => {
    // The last child's through-rule carries :has() with its own argument
    // list, which the comma-splitting declarations() helper cannot match, so
    // its geometry is asserted textually.
    expect(css).toContain('.groupSection:has(> * > [data-row-key^=\'session:\'], > .sessionOverflowButton)')
    expect(css).toContain('> [role=\'group\'] > .groupSection:last-child:not(.workspaceDropAfter)::after')
  })

  it('bridges the section margins so sibling guides read as one line', () => {
    const machineElbow = declarations(".groupSection[data-tree-depth='0']:not(.workspaceDropBefore)::before")
    expect(machineElbow?.get('border-bottom-left-radius')).toBe('8px')
    expect(machineElbow?.get('width')).toBe('8px')
    const machineGuide = declarations(
      ".groupSection[data-tree-depth='0']:not([data-tree-last='true']):not(.workspaceDropAfter)::after",
    )
    expect(machineGuide?.get('top')).toBe('18px')
    expect(machineGuide?.get('bottom')).toBe('-4px')
    const riser = declarations(".groupSection:not([data-tree-depth='0']):not(.workspaceDropBefore)::before")
    expect(riser?.get('top')).toBe('-4px')
    expect(riser?.get('height')).toBe('21px')
    const through = declarations(".groupSection:not([data-tree-depth='0']):not([data-tree-last='true']):not(.workspaceDropAfter)::after")
    expect(through?.get('top')).toBe('17px')
    expect(through?.get('bottom')).toBe('0')
  })

  it('marquees a clipped session title on row hover', () => {
    // The crawl itself is scripted in Rows.tsx frame by frame, so the title
    // declares no scroll-behavior; the stylesheet keeps the hovered cell
    // unclipped and fades whichever edges cut text mid-travel, on the title
    // span itself so the status slot beside it keeps its full color.
    expect(rowDeclarations('.sessionRow .title')?.get('flex')).toBe('1')
    expect(rowDeclarations('.sessionRow .title')?.get('scroll-behavior')).toBeUndefined()
    expect(rowDeclarations('.sessionRow:hover .title')?.get('text-overflow')).toBe('clip')
    expect(rowDeclarations('.sessionRow .title[data-scrolled]')?.get('mask-image'))
      .toBe('linear-gradient(to right, transparent, #000 12px)')
    expect(rowDeclarations('.sessionRow .title[data-clipped]')?.get('mask-image'))
      .toBe('linear-gradient(to left, transparent, #000 12px)')
    expect(rowDeclarations('.sessionRow .title[data-scrolled][data-clipped]')?.get('mask-image'))
      .toBe('linear-gradient(to right, transparent, #000 12px, #000 calc(100% - 12px), transparent)')
  })

  it('pins both rail controls to the shared left anchor during the column slide', () => {
    expect(declarations('.rail .sectionHeader')?.get('justify-content')).toBe('flex-start')
    expect(declarations('.rail .iconButton')?.get('width')).toBe('36px')
    expect(declarations('.rail .search')?.get('width')).toBe('36px')
  })
})
