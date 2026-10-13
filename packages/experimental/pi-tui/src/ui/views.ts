/**
 * Transcript views: one component per ChatItem kind plus the status bar.
 * Each view holds its ChatItem and refreshes from it on `updateFromItem()`;
 * unchanged message bodies retain pi-tui's Markdown render cache.
 */
import { diffLines } from 'diff'
import chalk from 'chalk'
import {
  Container,
  Image,
  Loader,
  Markdown,
  Text,
  getCapabilities,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type ViewportTUI,
} from '@earendil-works/pi-tui'
import type { ChatItem } from '../core/model.js'
import { BRAND_RED, markdownTheme, reasoningMarkdownTheme, style } from './theme.js'
import {
  highlightMatches,
  renderContextBar,
  sandboxShort,
  shortTokens,
} from '../core/format.js'

/** One identifying glyph per tool family; unknown tools keep the dot. */
const TOOL_GLYPHS: Record<string, string> = {
  bash: '$',
  read: '▤',
  write: '✎',
  edit: '✎',
  multi_edit: '✎',
  apply_patch: '⚒',
  grep: '⌕',
  list: '≡',
  todo_write: '☰',
  write_todos: '☰',
  skill: '✦',
  web_search: '⌕',
  web_fetch: '⇣',
  browser: '⬒',
  computer: '▣',
  task: '⚙',
  exit_plan_mode: '⌘',
}

/** The tool's identifying glyph, or the classic dot for unknown tools. */
function toolGlyph(name: string): string {
  return TOOL_GLYPHS[name] ?? '⏺'
}

/** GitHub-dark diff styling: tinted line backgrounds behind the +/- text. */
const DIFF_ADDED = (text: string) => chalk.bgHex('#12261e').hex('#7ee787')(text)
const DIFF_REMOVED = (text: string) => chalk.bgHex('#3d1b20').hex('#ffa198')(text)

/** Collapsible reasoning with live Markdown; find results use highlighted source text. */
export class ReasoningView extends Container {
  private body: Markdown
  private label: Text
  private plain: Text
  private lastText = ''
  private lastMode: 'label' | 'markdown' | 'plain' | undefined
  private lastQuery = ''
  private item: ChatItem
  private expandAll: boolean | undefined
  private expandedOverride: boolean | undefined

  constructor(item: ChatItem) {
    super()
    this.item = item
    this.body = new Markdown('', 3, 0, reasoningMarkdownTheme, { color: style.muted })
    this.label = new Text('', 1, 0)
    this.plain = new Text('', 3, 0)
  }

  get isExpanded(): boolean {
    return this.expandedOverride ?? this.expandAll ?? this.item.streaming
  }

  setExpanded(expanded: boolean): void {
    this.expandedOverride = expanded
    this.updateFromItem(this.expandAll, this.lastQuery)
  }

  override handleMouse(event: TuiMouseEvent): ReturnType<Container['handleMouse']> {
    if ((event.type === 'press' || event.type === 'click') && event.button === 'left' && event.y === 0 && !event.shift) {
      if (event.type === 'click') this.setExpanded(!this.isExpanded)
      return {
        handled: true,
        target: {
          component: this, originX: event.screenX - event.x, originY: event.screenY - event.y,
          width: event.width, height: event.height,
        },
      }
    }
    return super.handleMouse(event)
  }

  updateFromItem(expanded: boolean | undefined, query?: string): void {
    this.expandAll = expanded
    const activeQuery = query ?? ''
    const mode: 'label' | 'markdown' | 'plain' = !this.isExpanded
      ? 'label'
      : activeQuery !== '' ? 'plain' : 'markdown'
    if (
      this.lastMode !== mode ||
      this.lastText !== this.item.text ||
      this.lastQuery !== activeQuery
    ) {
      this.clear()
      this.label.setText(style.thinkingLabel(
        `${mode === 'label' ? '▸' : '▾'} Thinking · ${this.item.text.length} chars · Ctrl+T`,
      ))
      this.addChild(this.label)
      if (mode === 'plain') {
        this.plain.setText(style.muted(highlightMatches(this.item.text, activeQuery)))
        this.addChild(this.plain)
      } else if (mode === 'markdown') {
        this.body.setText(this.item.text)
        this.addChild(this.body)
      }
      this.lastMode = mode
      this.lastText = this.item.text
      this.lastQuery = activeQuery
    }
  }
}

export class UserMessageView extends Text {
  private item: ChatItem
  private lastKey = ''

  constructor(item: ChatItem) {
    super('', 1, 0)
    this.item = item
  }

  updateFromItem(query?: string): void {
    const key = `${this.item.text}:${query ?? ''}`
    if (key !== this.lastKey) {
      this.setText(
        `${style.userPrefix('›')}${style.userText(highlightMatches(this.item.text, query ?? ''))}`,
      )
      this.lastKey = key
    }
  }
}

export class AssistantMessageView extends Container {
  private markdown: Markdown
  private plain: Text
  private item: ChatItem
  private lastText: string | undefined
  private lastQuery: string | undefined

  constructor(item: ChatItem) {
    super()
    this.item = item
    this.markdown = new Markdown('', 1, 0, markdownTheme)
    this.plain = new Text('', 1, 0)
  }

  updateFromItem(query?: string): void {
    // pi-tui handles incomplete fences; keep the same renderer through sealing.
    const activeQuery = query ?? ''
    if (this.item.text !== this.lastText || activeQuery !== this.lastQuery) {
      this.clear()
      if (activeQuery !== '') {
        this.plain.setText(highlightMatches(this.item.text, activeQuery))
        this.addChild(this.plain)
      } else {
        this.markdown.setText(this.item.text)
        this.addChild(this.markdown)
      }
      this.lastText = this.item.text
      this.lastQuery = activeQuery
    }
  }
}

export class NoticeView extends Text {
  private item: ChatItem
  private lastKey = ''

  constructor(item: ChatItem) {
    super('', 1, 0)
    this.item = item
  }

  updateFromItem(): void {
    const flavor = this.item.notice ?? 'info'
    const key = `${flavor}:${this.item.text}`
    if (key !== this.lastKey) {
      this.lastKey = key
      if (flavor === 'banner') {
        // Pre-colored block; render verbatim without a marker.
        this.setText(this.item.text)
        return
      }
      const marker =
        flavor === 'error'
          ? style.toolError('✗')
          : flavor === 'compact'
            ? style.accent('»')
            : style.muted('ℹ')
      const text =
        flavor === 'error' ? style.toolError(this.item.text) : style.muted(this.item.text)
      this.setText(`${marker} ${text}`)
    }
  }
}

/** Compact tool card: status line + truncated args, settle line on result. */
export class ToolCardView implements Component {
  private item: ChatItem
  private expand = false
  private query = ''
  /** Browse-mode focus ring marker (Tab with an empty editor). */
  private focused = false
  private images: { base64: string; mediaType: string }[] = []
  /** Cached Image components: a fresh `Image` per render allocates a new
   * kitty image id every frame, churning the graphics protocol and forcing
   * extra full redraws (flicker). Reuse them; only width changes rebuild. */
  private imageViews: Image[] = []
  private imageViewsWidth = -1
  /** Cached markdown view for an exit_plan_mode card's full plan body. */
  private planMarkdown: Markdown | undefined

  constructor(item: ChatItem) {
    this.item = item
  }

  updateFromItem(expand: boolean, query?: string): void {
    this.expand = expand
    this.query = query ?? ''
  }

  /** Browse-mode focus ring: accent border when focused. */
  setFocused(focused: boolean): void {
    this.focused = focused
  }

  /** Resolved inline images (filled by the screen after read_image results). */
  setImages(images: { base64: string; mediaType: string }[]): void {
    this.images = images
    this.imageViews = []
    this.imageViewsWidth = -1
  }

  render(width: number): string[] {
    const tool = this.item.tool
    if (tool === undefined) return []
    const inner = Math.max(10, width - 4)
    const border = this.focused ? style.accent('│') : style.toolBorder('│')
    const lines: string[] = []
    const glyph = chalk.cyan(toolGlyph(tool.name))
    const statusLine = (() => {
      if (tool.status === 'running') {
        return `${chalk.hex(BRAND_RED)('◆')} ${glyph} ${style.toolName(tool.name)} ${style.toolArgs(tool.argsPreview)}`
      }
      if (tool.status === 'error') {
        return `${style.toolError('✗')} ${glyph} ${style.toolName(tool.name)} ${style.toolError(tool.errorText ?? 'error')}`
      }
      if (tool.status === 'rejected') {
        return `${style.muted('↩')} ${glyph} ${style.toolName(tool.name)} ${style.toolArgs(tool.argsPreview)} — ${style.muted(tool.resultPreview ?? 'not approved')}`
      }
      return `${style.toolOk('✔')} ${glyph} ${style.toolName(tool.name)} ${style.toolArgs(tool.argsPreview)}`
    })()
    // Display-width-aware truncation: CJK glyphs occupy two columns, so
    // plain string slicing lets lines overflow the terminal and trip
    // pi-tui's width assertion.
    const truncate = (line: string): string => {
      const visible = visibleWidth(line)
      if (visible <= inner) return line
      return `${truncateToWidth(line, Math.max(0, inner - 1))}…`
    }
    lines.push(this.expand
      ? this.frameTop(statusLine, inner)
      : `${border} ${truncate(statusLine)}`)
    // One body line: framed panels use a red rule while focused, dim
    // otherwise; collapsed cards keep the plain left border.
    const pushBody = (text: string): void => {
      lines.push(this.expand ? `${this.frameRule()} ${truncate(text)}` : `${border} ${truncate(text)}`)
    }
    // exit_plan_mode carries the full plan in its arguments; render it as the
    // card body so the scrollable transcript (not the overlay) holds the plan.
    if (tool.planText !== undefined && tool.planText !== '') {
      if (this.planMarkdown === undefined) {
        this.planMarkdown = new Markdown(tool.planText, 0, 0, markdownTheme)
      }
      for (const line of this.planMarkdown.render(inner)) {
        pushBody(line)
      }
    }
    // Only successful results get a body; running/error/rejected cards carry
    // their status in the status line alone.
    if (tool.status === 'ok') {
      // Expanded view with result-time diffs (write/edit tools) renders a
      // colored unified diff instead of the raw result text.
      if (this.expand && tool.diffs !== undefined && tool.diffs.length > 0) {
        lines.push(...this.renderDiffLines(border, truncate))
      } else if (tool.resultPreview !== undefined && tool.resultPreview !== '') {
        const body =
          this.expand && tool.resultFull !== undefined && tool.resultFull !== ''
            ? tool.resultFull
            : tool.resultPreview
        // Full output: keep every line, each truncated to the inner width,
        // capped at a generous height for very large results.
        const fullLines = body.split('\n').slice(0, 50)
        for (const line of fullLines) {
          pushBody(style.toolResult(highlightMatches(line, this.query)))
        }
      }
    }
    // Inline images (read_image results) render in the expanded view when
    // the terminal speaks kitty/iTerm2 graphics; otherwise a text note.
    if (this.expand && this.images.length > 0) {
      const capabilities = getCapabilities()
      if (capabilities.images !== null) {
        if (this.imageViews.length !== this.images.length || this.imageViewsWidth !== width) {
          this.imageViews = this.images.map(
            image =>
              new Image(
                image.base64,
                image.mediaType,
                { fallbackColor: text => chalk.dim(text) },
                { maxWidthCells: Math.max(10, inner - 2) },
              ),
          )
          this.imageViewsWidth = width
        }
        for (const component of this.imageViews) {
          for (const line of component.render(width)) {
            lines.push(`${border} ${line}`)
          }
        }
      } else {
        pushBody(chalk.dim(`(image: ${this.images.map(image => image.mediaType).join(', ')} — run in a kitty/iTerm2 terminal to view inline)`))
      }
    }
    if (this.expand) lines.push(this.frameBottom(inner))
    return lines
  }

  /** The panel's top rule with the status line inlaid. */
  private frameTop(statusLine: string, inner: number): string {
    const rule = this.focused ? style.accent : style.toolBorder
    const pad = Math.max(0, inner - 4 - visibleWidth(statusLine))
    return rule(`╭─ ${statusLine} ─ ${'─'.repeat(pad)}`)
  }

  private frameRule(): string {
    return (this.focused ? style.accent : style.toolBorder)('│')
  }

  private frameBottom(inner: number): string {
    return (this.focused ? style.accent : style.toolBorder)(`╰${'─'.repeat(inner)}╯`)
  }

  /** Colored unified diff per changed file (adapts pi's diff rendering). */
  private renderDiffLines(border: string, truncate: (line: string) => string): string[] {
    const lines: string[] = []
    for (const file of this.item.tool?.diffs ?? []) {
      lines.push(`${border} ${style.toolName(file.path)}`)
      const MAX = 80
      if (file.oldText === null) {
        // New file: every line added.
        for (const line of file.newText.split('\n').slice(0, MAX)) {
          lines.push(`${border} ${truncate(DIFF_ADDED(`+ ${line}`))}`)
        }
        continue
      }
      const parts = diffLines(file.oldText, file.newText)
      let count = 0
      for (const part of parts) {
        for (const line of part.value.replace(/\n$/, '').split('\n')) {
          if (count++ >= MAX) break
          const prefix = part.added ? '+ ' : part.removed ? '- ' : '  '
          const styled = part.added
            ? DIFF_ADDED(prefix + line)
            : part.removed
              ? DIFF_REMOVED(prefix + line)
              : chalk.dim(prefix + line)
          lines.push(`${border} ${truncate(styled)}`)
        }
        if (count >= MAX) break
      }
    }
    return lines
  }

  handleInput(): void {
    // M2: Enter expands the full result.
  }

  invalidate(): void {
    this.planMarkdown?.invalidate()
  }
}

export interface StatusBarData {
  model?: string
  /** The visible agent or operator shell is currently working. */
  working?: boolean
  /** Reasoning effort for the live route; colored by level. */
  effort?: string
  sessionId?: string
  cwd?: string
  git?: { branch: string; dirty: boolean }
  tokens?: { input: number; output: number }
  todos?: { done: number; total: number }
  preset?: string
  planActive?: boolean
  goalPhase?: string
  contextPct?: number
  contextUsed?: number
  contextTotal?: number
  sandboxMode?: string
  jobsRunning?: number
  /** Delegation runs currently active under the visible agent. */
  subagentsRunning?: number
  /** Pending inbox items (queued turns + steering) awaiting the agent. */
  queuePending?: number
}

/** Status bar that wraps segments to the terminal width. */
export class StatusBar extends Loader {
  private data: StatusBarData = {}
  private animating = false

  constructor(tui: ViewportTUI) {
    super(tui, style.spinner, style.workingLabel, '', {
      frames: ['◐', '◓', '◑', '◒'], intervalMs: 120,
    })
    this.stop()
  }

  update(data: StatusBarData): void {
    this.data = data
    const active = (data.jobsRunning ?? 0) > 0 || (data.subagentsRunning ?? 0) > 0
    if (active === this.animating) return
    this.animating = active
    if (active) this.start()
    else this.stop()
  }

  override render(width: number): string[] {
    if (width <= 1) return ['']
    const data = this.data
    const spinner = this.getRenderedIndicator()
    // Each segment owns a hue keyed to its meaning: model cyan, preset
    // violet, location blue, VCS green, cost grey, and genuine warnings
    // (plan, danger, pressure, dirty tree) in amber/red. The icon rides the
    // same color as its value so each reads as one chip.
    const text = chalk.hex('#c7d0da')
    const parts: string[] = [chalk.hex(BRAND_RED).bold('⧉ Shield Break')]
    if (data.model !== undefined) parts.push(`🤖 ${chalk.cyan(data.model)}`)
    if (data.effort !== undefined) {
      const hot = data.effort === 'max' || data.effort === 'xhigh'
      parts.push((hot ? chalk.red : chalk.hex('#ff9a3d'))(`⚡ ${data.effort}`))
    }
    if (data.preset !== undefined) parts.push(chalk.hex('#b588f7')(`❖ ${data.preset}`))
    // Explicit mode indicator: plan when active (warn hue), normal otherwise.
    parts.push(data.planActive === true ? chalk.yellow('⌘ plan') : chalk.dim('◌ normal'))
    const modeShort = sandboxShort(data.sandboxMode)
    if (modeShort !== undefined) {
      // danger posture must stand out; a confined mode reads calm green.
      parts.push((modeShort === 'danger' ? chalk.red.bold : chalk.green)(`⛉ ${modeShort}`))
    }
    if (data.goalPhase !== undefined) parts.push(chalk.hex('#b588f7')(`◈ ${data.goalPhase}`))
    if (data.sessionId !== undefined) parts.push(chalk.dim(`◌ ${data.sessionId.slice(0, 8)}`))
    if (data.cwd !== undefined) parts.push(chalk.blue(`▾ ${data.cwd}`))
    if (data.git !== undefined) {
      parts.push(data.git.dirty
        ? chalk.yellow(`⑂ ${data.git.branch}*`)
        : chalk.green(`⑂ ${data.git.branch}`))
    }
    if (data.tokens !== undefined) {
      parts.push(chalk.dim(`Σ ${shortTokens(data.tokens.input + data.tokens.output)} tok`))
    }
    if (data.contextPct !== undefined) {
      const bar = renderContextBar(data.contextUsed, data.contextTotal)
      const totals =
        data.contextUsed !== undefined && data.contextTotal !== undefined
          ? ` ${shortTokens(data.contextUsed)}/${shortTokens(data.contextTotal)}`
          : ''
      const pressure = data.contextPct >= 85 ? chalk.red : data.contextPct >= 70 ? chalk.yellow : text
      parts.push(`${bar !== undefined ? `${bar} ` : ''}${pressure(`◔ ${data.contextPct}%${totals}`)}`)
    }
    if (data.todos !== undefined && data.todos.total > 0) {
      const done = data.todos.done === data.todos.total
      parts.push((done ? chalk.green : chalk.hex('#ffb340'))(`☑ ${data.todos.done}/${data.todos.total}`))
    }
    if (data.jobsRunning !== undefined && data.jobsRunning > 0) parts.push(chalk.cyan(`${spinner} ${data.jobsRunning} jobs`))
    if (data.subagentsRunning !== undefined && data.subagentsRunning > 0) {
      parts.push(chalk.cyan(`${spinner} ${data.subagentsRunning} agents`))
    }
    if (data.queuePending !== undefined && data.queuePending > 0) parts.push(chalk.yellow(`⏳ ${data.queuePending}`))
    // Greedy-pack segments across lines on the thin ` · ` separator; wrap
    // instead of truncating so a long status bar stays fully readable.
    const sep = chalk.dim(' · ')
    const sepWidth = 3 // visibleWidth(' · ')
    const lines: string[] = []
    let current = ''
    let currentWidth = 0
    for (const part of parts) {
      const partWidth = visibleWidth(part)
      if (current === '') {
        current = part
        currentWidth = partWidth
      } else if (currentWidth + sepWidth + partWidth <= width) {
        current += sep + part
        currentWidth += sepWidth + partWidth
      } else {
        lines.push(current)
        current = part
        currentWidth = partWidth
      }
    }
    if (current !== '') lines.push(current)
    // A single segment wider than the terminal still needs a hard cut.
    return lines.map(line => truncateToWidth(line, width))
  }

  override invalidate(): void {
    // Stateless.
  }
}

export function createView(item: ChatItem): Component {
  switch (item.kind) {
    case 'user':
      return new UserMessageView(item)
    case 'assistant':
      return new AssistantMessageView(item)
    case 'reasoning':
      return new ReasoningView(item)
    case 'tool':
      return new ToolCardView(item)
    case 'notice':
      return new NoticeView(item)
  }
}

export function updateView(
  view: Component,
  expandReasoning: boolean | undefined,
  expandTools: boolean,
  query?: string,
): void {
  if (view instanceof UserMessageView) view.updateFromItem(query)
  else if (view instanceof AssistantMessageView) view.updateFromItem(query)
  else if (view instanceof ReasoningView) view.updateFromItem(expandReasoning, query)
  else if (view instanceof NoticeView) view.updateFromItem()
  else if (view instanceof ToolCardView) view.updateFromItem(expandTools, query)
}
