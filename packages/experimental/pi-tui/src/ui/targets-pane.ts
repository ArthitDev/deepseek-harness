/** Compact, scrollable target tree above the Agent Debug timeline. */
import { isIP } from 'node:net'
import { matchesKey, ScrollView, VStack, truncateToWidth, visibleWidth, type Component, type TuiMouseEvent } from '@earendil-works/pi-tui'
import type { TuiMouseDispatchResult } from '@earendil-works/pi-tui/dist/tui.js'
import type { TargetEntry } from '../core/targets.js'
import { style } from './theme.js'

interface Branch {
  key: string
  label: string
  children: Map<string, Branch>
}

interface TargetRow {
  key: string
  parent: string | undefined
  prefix: string
  label: string
  expandable: boolean
}

function branch(label: string, key = label): Branch {
  return { key, label, children: new Map() }
}

function parentPathLength(rootOrigin: string, basePath: string, childOrigin: string, childPath: string): number {
  return rootOrigin === childOrigin
    && (childPath === basePath || childPath.startsWith(`${basePath}/`))
    ? basePath.length + 1 : 0
}

function addPath(parent: Branch, url: URL, rootOrigin: string, basePath: string): void {
  const origin = url.origin
  const pathname = url.pathname
  const sameOrigin = origin === rootOrigin
  const path = parentPathLength(rootOrigin, basePath, origin, pathname) > 0
    ? pathname.slice(basePath.length) : pathname
  const parts = [...(sameOrigin ? [] : [origin]), ...path.split('/').filter(Boolean)]
  if (parts.length === 0) parts.push('/')
  let node = parent
  for (const part of parts) {
    let child = node.children.get(part)
    if (child === undefined) {
      child = branch(part)
      node.children.set(part, child)
    }
    node = child
  }
}

function rowsOf(nodes: readonly Branch[], collapsed: ReadonlySet<string>, path: readonly string[] = [], prefix = ''): TargetRow[] {
  return nodes.flatMap((node, index) => {
    const last = index === nodes.length - 1
    const parts = [...path, node.key]
    const key = JSON.stringify(parts)
    return [{ key, parent: path.length === 0 ? undefined : JSON.stringify(path), label: node.label,
      prefix: path.length === 0 ? '' : `${prefix}${last ? '└─' : '├─'} `, expandable: node.children.size > 0 },
    ...collapsed.has(key) ? [] : rowsOf([...node.children.values()], collapsed, parts,
      path.length === 0 ? '' : `${prefix}${last ? '   ' : '│  '}`)]
  })
}

function webBranches(urls: readonly TargetEntry[]): Branch[] {
  const roots = urls.filter(entry => entry.primary).map((entry) => {
    const url = new URL(entry.value)
    const hostname = url.hostname
    const pathname = url.pathname
    return {
      url,
      hostname,
      origin: url.origin,
      basePath: pathname.replace(/\/$/, ''),
      isIp: isIP(hostname.replace(/^\[|\]$/g, '')) !== 0,
      node: branch(entry.value),
      children: [] as URL[],
    }
  })
  const others: URL[] = []
  for (const entry of urls) {
    if (entry.primary) continue
    const url = new URL(entry.value)
    const hostname = url.hostname
    const origin = url.origin
    const pathname = url.pathname
    let root: typeof roots[number] | undefined
    let rootHostLength = -1
    let rootPathLength = -1
    for (const candidate of roots) {
      if (hostname !== candidate.hostname
        && (candidate.isIp || !hostname.endsWith(`.${candidate.hostname}`))) continue
      const hostLength = candidate.hostname.length
      if (hostLength < rootHostLength) continue
      const pathLength = parentPathLength(candidate.origin, candidate.basePath, origin, pathname)
      if (hostLength > rootHostLength || pathLength > rootPathLength) {
        root = candidate
        rootHostLength = hostLength
        rootPathLength = pathLength
      }
    }
    if (root === undefined) others.push(url)
    else root.children.push(url)
  }
  for (const root of roots) {
    if (root.children.length === 0) continue
    const sub = branch(`Sub Target · ${root.children.length}`, 'sub')
    for (const url of root.children) addPath(sub, url, root.origin, root.basePath)
    root.node.children.set('sub', sub)
  }
  const targets = branch(`Web · ${roots.length}`, 'web')
  for (const root of roots) targets.children.set(root.url.href, root.node)
  const other = branch(`Other web · ${others.length}`, 'other-web')
  for (const url of others) other.children.set(url.href, branch(url.href))
  return [...roots.length === 0 ? [] : [targets], ...others.length === 0 ? [] : [other]]
}

function targetBranches(entries: readonly TargetEntry[]): Branch[] {
  const web = entries.filter(entry => entry.kind === 'web')
  const groups: Branch[] = web.length === 0 ? [] : webBranches(web)
  const labels = { host: 'Hosts', network: 'Networks', file: 'Files / folders', app: 'Apps / programs', other: 'Targets' } as const
  for (const kind of ['host', 'network', 'file', 'app', 'other'] as const) {
    const entriesOfKind = entries.filter(entry => entry.kind === kind)
    if (entriesOfKind.length === 0) continue
    const group = branch(`${labels[kind]} · ${entriesOfKind.length}`, kind)
    const discoveries = entriesOfKind.filter(entry => !entry.primary)
    for (const entry of entriesOfKind.filter(entry => entry.primary)) {
      group.children.set(entry.value, branch(entry.value))
    }
    if (discoveries.length > 0) {
      const observed = branch(`Observed · ${discoveries.length}`, 'observed')
      for (const entry of discoveries) observed.children.set(entry.value, branch(entry.value))
      group.children.set('observed', observed)
    }
    groups.push(group)
  }
  return groups
}

/**
 * Group targets by kind, separating explicit identifiers from discoveries.
 * Host matches rank by hostname length, then matching same-origin path length.
 * Equal scores keep the first root.
 * @param entries - Normalized session target observations.
 * @returns Display-only lines; host matching never authorizes tool execution.
 */
export function targetTreeLines(entries: readonly TargetEntry[]): string[] {
  return rowsOf(targetBranches(entries), new Set()).map(row => row.prefix + row.label)
}

/** Collapsible Targets tree with independent selection, branch state, and scrolling. */
export class TargetsPane extends VStack {
  private targetEntries: readonly TargetEntry[] = []
  private tree: readonly Branch[] = []
  private rows: readonly TargetRow[] = []
  private collapsed = new Set<string>()
  private paneCollapsed = false
  private selected: string | undefined
  private renderedRows: {
    rows: readonly TargetRow[]
    width: number
    focused: boolean
    selected: string | undefined
    lines: string[]
  } | undefined
  /** Whether the containing Debug pane routes navigation to this tree. */
  focused = false
  /** The tree scrollport, independent of the tool timeline. */
  readonly scroll: ScrollView

  /**
   * @param keyboardOwner - Debug pane that retains keyboard focus after tree clicks.
   * @param onFocus - Clear peer panel selection when a mouse click focuses the tree.
   * @param footer - Optional resize control replacing the passive bottom border; omitted keeps the passive border.
   */
  constructor(private readonly keyboardOwner: Component & { focused: boolean }, private readonly onFocus: () => void, footer?: Component) {
    super()
    const rule = (width: number, top: boolean): string[] => {
      const title = top ? `╭─ Targets ${this.paneCollapsed ? '▸' : '▾'}${this.focused ? ' · Enter toggle · Tab next' : ''} ` : '╰'
      const color = top && this.focused && this.selected === undefined ? style.accent : style.muted
      return [color(truncateToWidth(`${title}${'─'.repeat(Math.max(0, width - visibleWidth(title) - 1))}${top ? '╮' : '╯'}`, width))]
    }
    const header: Component = {
      invalidate: () => {}, render: width => rule(width, true),
      handleMouse: (event) => {
        if (event.type !== 'press' || event.button !== 'left') return undefined
        this.focused = true
        this.selected = undefined
        this.paneCollapsed = !this.paneCollapsed
        return this.focusMouse(header, event)
      },
    }
    this.addChild(header, { basis: 'auto', shrink: 0 })
    const output: Component = {
      invalidate: () => {},
      render: width => this.renderRows(width),
      handleMouse: (event) => {
        if (event.type !== 'press' || event.button !== 'left') return undefined
        const row = this.rows[event.y]
        if (row === undefined) return undefined
        this.focused = true
        this.selected = row.key
        if (row.expandable) this.toggle(row)
        return this.focusMouse(output, event)
      },
    }
    this.scroll = new ScrollView(output, { overscroll: 'contain' })
    this.addChild(this.scroll, { basis: 'auto', grow: 1, shrink: 1, minSize: 1, visible: () => !this.paneCollapsed })
    this.addChild(footer ?? { invalidate: () => {}, render: width => rule(width, false) }, { basis: 'auto', shrink: 0, visible: () => !this.paneCollapsed })
  }

  private renderRows(width: number): string[] {
    const cached = this.renderedRows
    if (cached?.rows === this.rows && cached.width === width && cached.focused === this.focused
      && cached.selected === this.selected) return cached.lines
    const lines = this.rows.map((row) => {
      const selected = this.focused && this.selected === row.key
      const marker = row.expandable ? this.collapsed.has(row.key) ? '▸' : '▾' : ' '
      const text = truncateToWidth(`${selected ? '›' : ' '} ${row.prefix}${marker} ${row.label}`, Math.max(0, width - 4))
      const line = `${style.muted('│')} ${(selected ? style.accent : style.toolName)(text)}${' '.repeat(Math.max(0, width - visibleWidth(text) - 3))}${style.muted('│')}`
      return width < 3 ? truncateToWidth(line, width) : line
    })
    this.renderedRows = { rows: this.rows, width, focused: this.focused, selected: this.selected, lines }
    return lines
  }

  /**
   * Navigate visible branches, toggle them, or collapse the whole box from its header.
   * @param data - Raw terminal key input routed from the Debug pane.
   */
  handleInput(data: string): void {
    const index = this.rows.findIndex(row => row.key === this.selected)
    const row = this.rows[index]
    if (matchesKey(data, 'enter') || matchesKey(data, 'space')) {
      if (row === undefined) this.paneCollapsed = !this.paneCollapsed
      else if (row.expandable) this.toggle(row)
    } else if (matchesKey(data, 'left')) {
      if (row === undefined) this.paneCollapsed = true
      else if (row.expandable && !this.collapsed.has(row.key)) this.toggle(row)
      else this.selected = row.parent
    } else if (matchesKey(data, 'right')) {
      if (row === undefined) this.paneCollapsed = false
      else if (row.expandable) {
        if (this.collapsed.has(row.key)) this.toggle(row)
        else this.selected = this.rows[index + 1]?.key
      }
    } else if (matchesKey(data, 'home')) {
      this.selected = undefined
      this.scroll.scrollToStart()
    } else if (!this.paneCollapsed) {
      if (matchesKey(data, 'end')) {
        this.selected = this.rows.at(-1)?.key
        this.scroll.scrollToEnd()
      } else if (matchesKey(data, 'up') || matchesKey(data, 'down')) {
        this.selected = this.rows[Math.max(-1, Math.min(this.rows.length - 1, index + (matchesKey(data, 'up') ? -1 : 1)))]?.key
      } else if (matchesKey(data, 'pageUp') || matchesKey(data, 'pageDown')) {
        this.scroll.scrollBy(Math.max(1, this.scroll.viewportHeight - 1) * (matchesKey(data, 'pageUp') ? -1 : 1))
        this.selected = this.rows[this.scroll.scrollTop]?.key
      }
    }
    const selected = this.rows.findIndex(row => row.key === this.selected)
    if (selected >= 0 && selected < this.scroll.scrollTop) this.scroll.scrollTo(selected)
    else if (selected >= this.scroll.scrollTop + this.scroll.viewportHeight) {
      this.scroll.scrollTo(selected - this.scroll.viewportHeight + 1)
    }
  }

  private toggle(row: TargetRow): void {
    if (this.collapsed.has(row.key)) this.collapsed.delete(row.key)
    else this.collapsed.add(row.key)
    this.rows = rowsOf(this.tree, this.collapsed)
    this.renderedRows = undefined
  }

  private focusMouse(component: Component, event: TuiMouseEvent): TuiMouseDispatchResult {
    this.onFocus()
    return { handled: true, focus: !this.keyboardOwner.focused, focusTarget: this.keyboardOwner, target: {
      component, originX: event.screenX - event.x, originY: event.screenY - event.y,
      width: event.width, height: event.height,
    } }
  }

  /**
   * Rebuild the tree only when target observations change.
   * @param entries - Cached target snapshot for the visible session.
   */
  update(entries: readonly TargetEntry[]): void {
    if (entries === this.targetEntries) return
    const previous = new Set(this.targetEntries.map(entry => `${entry.kind}:${entry.value}`))
    if (!entries.some(entry => previous.has(`${entry.kind}:${entry.value}`))) {
      this.scroll.scrollToStart()
      this.collapsed.clear()
      this.paneCollapsed = false
      this.selected = undefined
    }
    this.targetEntries = entries
    this.tree = targetBranches(entries)
    this.rows = rowsOf(this.tree, this.collapsed)
    this.renderedRows = undefined
    if (!this.rows.some(row => row.key === this.selected)) this.selected = undefined
    if (entries.length === 0) this.focused = false
  }

  /**
   * Whether the tree contains any observed targets.
   * @returns true when at least one identifier exists.
   */
  get hasTargets(): boolean { return this.targetEntries.length > 0 }

  /** Whether only the box header is visible; its expanded height is retained by the owner. */
  get isCollapsed(): boolean { return this.paneCollapsed }

  /** Expanded row count, including the header and footer. */
  get contentHeight(): number { return this.rows.length + 2 }
}
