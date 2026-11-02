/** Compact, scrollable URL tree above the Agent Debug timeline. */
import { isIP } from 'node:net'
import { matchesKey, ScrollView, VStack, truncateToWidth, visibleWidth, type Component, type TuiMouseEvent } from '@earendil-works/pi-tui'
import type { TuiMouseDispatchResult } from '@earendil-works/pi-tui/dist/tui.js'
import type { TargetUrl } from '../core/targets.js'
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

function parentPathLength(root: URL, child: URL): number {
  const base = root.pathname.replace(/\/$/, '')
  return root.origin === child.origin && (child.pathname === base || child.pathname.startsWith(`${base}/`)) ? base.length + 1 : 0
}

function addPath(parent: Branch, url: URL, root: URL): void {
  const sameOrigin = url.origin === root.origin
  const base = root.pathname.replace(/\/$/, '')
  const path = parentPathLength(root, url) > 0
    ? url.pathname.slice(base.length) : url.pathname
  const parts = [...(sameOrigin ? [] : [url.origin]), ...path.split('/').filter(Boolean)]
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

function targetBranches(urls: readonly TargetUrl[]): Branch[] {
  const roots = urls.filter(entry => entry.primary)
    .map(entry => ({ url: new URL(entry.url), node: branch(entry.url), children: [] as URL[] }))
  const others: URL[] = []
  for (const entry of urls) {
    if (entry.primary) continue
    const url = new URL(entry.url)
    const root = roots.filter(candidate => url.hostname === candidate.url.hostname
      || (isIP(candidate.url.hostname.replace(/^\[|\]$/g, '')) === 0 && url.hostname.endsWith(`.${candidate.url.hostname}`)))
      .sort((a, b) => b.url.hostname.length - a.url.hostname.length || parentPathLength(b.url, url) - parentPathLength(a.url, url))[0]
    if (root === undefined) others.push(url)
    else root.children.push(url)
  }
  for (const root of roots) {
    if (root.children.length === 0) continue
    const sub = branch(`Sub Target · ${root.children.length}`, 'sub')
    for (const url of root.children) addPath(sub, url, root.url)
    root.node.children.set('sub', sub)
  }
  const targets = branch(`Target · ${roots.length}`, 'target')
  for (const root of roots) targets.children.set(root.url.href, root.node)
  const other = branch(`Other · ${others.length}`, 'other')
  for (const url of others) other.children.set(url.href, branch(url.href))
  return [targets, ...others.length === 0 ? [] : [other]]
}

/**
 * Group explicit targets, matching hosts/subdomains, and unrelated URLs into folder branches.
 * @param urls - Normalized session URL observations.
 * @returns Display-only lines; host matching never authorizes tool execution.
 */
export function targetTreeLines(urls: readonly TargetUrl[]): string[] {
  return rowsOf(targetBranches(urls), new Set()).map(row => row.prefix + row.label)
}

/** Collapsible Targets tree with independent selection, branch state, and scrolling. */
export class TargetsPane extends VStack {
  private urls: readonly TargetUrl[] = []
  private tree: readonly Branch[] = []
  private rows: readonly TargetRow[] = []
  private collapsed = new Set<string>()
  private paneCollapsed = false
  private selected: string | undefined
  /** Whether the containing Debug pane routes navigation to this tree. */
  focused = false
  /** The tree scrollport, independent of the tool timeline. */
  readonly scroll: ScrollView

  /** @param keyboardOwner - Debug pane that retains keyboard focus after tree clicks. */
  constructor(private readonly keyboardOwner: Component & { focused: boolean }) {
    super()
    const rule = (width: number, top: boolean): string[] => {
      const title = top ? `╭─ Targets ${this.paneCollapsed ? '▸' : '▾'}${this.focused ? ' · Enter toggle · Tab Debug' : ''} ` : '╰'
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
      render: width => this.rows.map((row) => {
        const selected = this.focused && this.selected === row.key
        const marker = row.expandable ? this.collapsed.has(row.key) ? '▸' : '▾' : ' '
        const text = truncateToWidth(`${selected ? '›' : ' '} ${row.prefix}${marker} ${row.label}`, Math.max(0, width - 4))
        return truncateToWidth(`${style.muted('│')} ${(selected ? style.accent : style.toolName)(text)}${' '.repeat(Math.max(0, width - visibleWidth(text) - 3))}${style.muted('│')}`, width)
      }),
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
    this.addChild({ invalidate: () => {}, render: width => rule(width, false) }, { basis: 'auto', shrink: 0, visible: () => !this.paneCollapsed })
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
  }

  private focusMouse(component: Component, event: TuiMouseEvent): TuiMouseDispatchResult {
    return { handled: true, focus: !this.keyboardOwner.focused, focusTarget: this.keyboardOwner, target: {
      component, originX: event.screenX - event.x, originY: event.screenY - event.y,
      width: event.width, height: event.height,
    } }
  }

  /**
   * Rebuild the tree only when URL observations change.
   * @param urls - Cached URL snapshot for the visible session.
   */
  update(urls: readonly TargetUrl[]): void {
    if (urls === this.urls) return
    const previous = new Set(this.urls.map(entry => entry.url))
    if (!urls.some(entry => previous.has(entry.url))) {
      this.scroll.scrollToStart()
      this.collapsed.clear()
      this.paneCollapsed = false
      this.selected = undefined
    }
    this.urls = urls
    this.tree = targetBranches(urls)
    this.rows = rowsOf(this.tree, this.collapsed)
    if (!this.rows.some(row => row.key === this.selected)) this.selected = undefined
    if (urls.length === 0) this.focused = false
  }

  /**
   * Whether the tree contains any observed URLs.
   * @returns true when at least one URL row exists.
   */
  get hasUrls(): boolean { return this.urls.length > 0 }
}
