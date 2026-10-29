/** Compact, scrollable URL tree above the Agent Debug timeline. */
import { isIP } from 'node:net'
import { ScrollView, VStack, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { TargetUrl } from '../core/targets.js'
import { style } from './theme.js'

interface Branch {
  label: string
  children: Map<string, Branch>
}

function branch(label: string): Branch {
  return { label, children: new Map() }
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

function linesOf(nodes: readonly Branch[], prefix = ''): string[] {
  return nodes.flatMap((node, index) => {
    const last = index === nodes.length - 1
    return [`${prefix}${last ? '└─' : '├─'} ${node.label}`,
      ...linesOf([...node.children.values()], `${prefix}${last ? '   ' : '│  '}`)]
  })
}

/**
 * Group explicit targets, matching hosts/subdomains, and unrelated URLs into folder branches.
 * @param urls - Normalized session URL observations.
 * @returns Display-only lines; host matching never authorizes tool execution.
 */
export function targetTreeLines(urls: readonly TargetUrl[]): string[] {
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
    const sub = branch(`Sub Target · ${root.children.length}`)
    for (const url of root.children) addPath(sub, url, root.url)
    root.node.children.set('sub', sub)
  }
  return [
    `Target · ${roots.length}`, ...linesOf(roots.map(root => root.node)),
    ...(others.length === 0 ? [] : [`Other · ${others.length}`, ...linesOf(others.map(url => branch(url.href)))]),
  ]
}

/** Targets share Debug visibility and retain their own mouse/keyboard scroll position. */
export class TargetsPane extends VStack {
  private urls: readonly TargetUrl[] = []
  private lines: readonly string[] = []
  /** Whether the containing Debug pane routes navigation to this tree. */
  focused = false
  /** The tree scrollport, independent of the tool timeline. */
  readonly scroll: ScrollView

  constructor() {
    super()
    const rule = (width: number, top: boolean): string[] => {
      const title = top ? `╭─ Targets${this.focused ? ' · ↑/↓ scroll · Tab Debug' : ''} ` : '╰'
      return [style.muted(truncateToWidth(`${title}${'─'.repeat(Math.max(0, width - visibleWidth(title) - 1))}${top ? '╮' : '╯'}`, width))]
    }
    this.addChild({ invalidate: () => {}, render: width => rule(width, true) }, { basis: 'auto', shrink: 0 })
    this.scroll = new ScrollView({
      invalidate: () => {},
      render: width => this.lines.map((line) => {
        const text = truncateToWidth(line, Math.max(0, width - 4))
        return truncateToWidth(`${style.muted('│')} ${style.toolName(text)}${' '.repeat(Math.max(0, width - visibleWidth(text) - 3))}${style.muted('│')}`, width)
      }),
    }, { overscroll: 'contain' })
    this.addChild(this.scroll, { basis: 'auto', grow: 1, shrink: 1, minSize: 1 })
    this.addChild({ invalidate: () => {}, render: width => rule(width, false) }, { basis: 'auto', shrink: 0 })
  }

  /**
   * Rebuild the tree only when URL observations change.
   * @param urls - Cached URL snapshot for the visible session.
   */
  update(urls: readonly TargetUrl[]): void {
    if (urls === this.urls) return
    const previous = new Set(this.urls.map(entry => entry.url))
    if (!urls.some(entry => previous.has(entry.url))) this.scroll.scrollToStart()
    this.urls = urls
    this.lines = targetTreeLines(urls)
    if (urls.length === 0) this.focused = false
  }

  /**
   * Whether the tree contains any observed URLs.
   * @returns true when at least one URL row exists.
   */
  get hasUrls(): boolean { return this.urls.length > 0 }
}
