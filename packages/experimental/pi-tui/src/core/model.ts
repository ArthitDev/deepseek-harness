/**
 * Pure transcript model: folds `session/event` records into a renderable
 * item list, independent of any UI. Unit-testable without a terminal.
 *
 * The fold mirrors cc-tui's channel state machine: user bubbles, per-step
 * streaming assistant text, per-step reasoning, and tool cards keyed by
 * `callId`, plus a working flag driven by turn boundaries.
 */
import {
  expandAssistantStream,
  type ContentBlock,
  type ContextFormed,
  type StreamChunk,
  type TimedStreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * The TUI's producer-owned message source (session format v4 retired the
 * shared `plugin` catch-all; each producer declares its own kind). Injected
 * shell output is a one-off account of something that just happened.
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'pi-tui': { kind: 'pi-tui' } & ContextFormed
  }
}

export type ToolCardStatus = 'running' | 'ok' | 'error' | 'rejected'

export interface ToolCardState {
  callId: string
  name: string
  argsPreview: string
  status: ToolCardStatus
  resultPreview?: string
  /** Untruncated result, rendered when the user expands tool output. */
  resultFull?: string
  /** Full plan markdown carried by an exit_plan_mode call, rendered as the card body. */
  planText?: string
  errorText?: string
  /** Result-time file diffs from tool meta (dsh-tool-fs), for /Ctrl+O view. */
  diffs?: FileDiff[]
  /** Durable image-attachment refs from image content blocks (read_image). */
  imageRefs?: ImageAttachmentRef[]
}

/** Serializable image-attachment reference from a tool result's image block. */
export interface ImageAttachmentRef {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: string
}

/** One file change carried by a tool result's `meta.diffs`. */
export interface FileDiff {
  path: string
  oldText: string | null
  newText: string
}

export interface ChatItem {
  readonly id: number
  kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'notice'
  text: string
  /** True while deltas still stream in; sealed items render their final form. */
  streaming: boolean
  seq?: number
  tool?: ToolCardState
  /** Notice flavor: info (slash results), error, compact checkpoint, or the
   * pre-colored startup banner. */
  notice?: 'info' | 'error' | 'compact' | 'banner'
}

export interface ChatModel {
  items: ChatItem[]
  /** Cumulative token accounting from `assistant/message` usage records. */
  tokens: { input: number; output: number }
  /** Live session title (`session/title`), if any. */
  title?: string
  /** True between `turn/start` and `turn/end` — drives the working loader. */
  working: boolean
  /** Reasoning effort the last request actually used (`request/header`). */
  effort?: string
  /** Provider/model route the last request actually used. */
  route?: { provider?: string; model?: string }
  /** Last plain human prompt — the `/retry` target. */
  lastUserText?: string
  /** Open streaming items for O(1) chunk folding (internal, not rendered).
   * Explicitly cleared (hence `| undefined` under exactOptionalPropertyTypes). */
  openAssistant?: ChatItem | undefined
  openReasoning?: ChatItem | undefined
}

const ARGS_PREVIEW_LIMIT = 200
const RESULT_PREVIEW_LIMIT = 400

export function createModel(): ChatModel {
  return { items: [], tokens: { input: 0, output: 0 }, working: false }
}

/** Extract plain text from content blocks (text blocks only; others skipped). */
export function textOf(content: readonly ContentBlock[] | undefined): string {
  return (content ?? [])
    .map(block => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()
}

function isFileDiff(value: unknown): value is FileDiff {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as { path?: unknown; oldText?: unknown; newText?: unknown }
  return (
    typeof record.path === 'string' &&
    (record.oldText === null || typeof record.oldText === 'string') &&
    typeof record.newText === 'string'
  )
}

function preview(text: string, limit: number): string {
  const single = text.replace(/\s+/g, ' ')
  return single.length > limit ? `${single.slice(0, limit)}…` : single
}

/** First `# heading` of a plan, or undefined when it has none. */
function planHeading(plan: string): string | undefined {
  for (const line of plan.split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line)
    if (match) return match[1]
  }
  return undefined
}

/**
 * Compact tool-args preview. Most tools keep the whitespace-collapsed raw
 * JSON, but exit_plan_mode carries the whole plan in its arguments — already
 * shown in the plan-review overlay — so it previews as the plan's title.
 */
function toolArgsPreview(name: string, argumentsJson: string): string {
  if (name === 'exit_plan_mode') {
    try {
      const parsed = JSON.parse(argumentsJson) as { plan?: unknown }
      if (typeof parsed.plan === 'string' && parsed.plan.trim() !== '') {
        return planHeading(parsed.plan) ?? 'plan'
      }
    } catch {
      // Malformed JSON: fall back to the raw preview.
    }
  }
  return preview(argumentsJson, ARGS_PREVIEW_LIMIT)
}

/** Full plan text from an exit_plan_mode call, or undefined for other tools. */
function toolPlanText(name: string, argumentsJson: string): string | undefined {
  if (name !== 'exit_plan_mode') return undefined
  try {
    const parsed = JSON.parse(argumentsJson) as { plan?: unknown }
    return typeof parsed.plan === 'string' && parsed.plan.trim() !== '' ? parsed.plan : undefined
  } catch {
    return undefined
  }
}

/** Strip the "Error: " prefix the tool runtime puts on thrown-error text. */
function stripErrorPrefix(text: string): string {
  return text.replace(/^Error:\s*/, '')
}

/**
 * exit_plan_mode failures that are actually human decisions, not errors.
 * Mirrors dsh-plan-mode's review-outcome messages: "keep planning" and the
 * dismissed-to-speak takeovers both leave the plan unapproved.
 */
function exitPlanNotApproved(text: string): string | undefined {
  const message = stripErrorPrefix(text)
  if (message.startsWith('The user chose to keep planning')) {
    return 'Plan not approved — still in plan mode'
  }
  if (message.startsWith('The user dismissed the plan review to speak instead')) {
    return 'Dismissed — chat instead; still in plan mode'
  }
  return undefined
}

/** Transcript notice for a surface-replace marker. The /rewind and /clear
 * commands write distinguishing marker prose; live folding and replay must
 * render the same wording. */
function replaceMarkerNotice(content: readonly ContentBlock[] | undefined): string {
  if (textOf(content).startsWith('the operator cleared')) {
    return 'session cleared — same session, fresh context'
  }
  return 'rewound — the earlier exchange is shadowed in the log'
}

/**
 * Fold one session event into the model. Stateful in place; returns the
 * model for chaining.
 */
export function applyEvent(model: ChatModel, event: SessionEvent): ChatModel {
  let nextId = model.items.length

  const push = (item: Omit<ChatItem, 'id'>): ChatItem => {
    const withId: ChatItem = { ...item, id: nextId }
    nextId += 1
    model.items.push(withId)
    return withId
  }

  switch (event.type) {
    case 'developer/message': {
      // The rewind/clear marker: its surfaceOp replace shadows every item in
      // [startSeq, endSeq]. The marker's own prose is log bookkeeping, not a
      // bubble; the notice is what the transcript shows at the shadow point,
      // live and on replay. Ids re-densify after the prune because the fold
      // window reads them as positions.
      const surfaceOp = (event as { surfaceOp?: { op?: string; startSeq?: number; endSeq?: number } }).surfaceOp
      if (surfaceOp?.op === 'replace'
        && typeof surfaceOp.startSeq === 'number'
        && typeof surfaceOp.endSeq === 'number') {
        const start = surfaceOp.startSeq
        const end = surfaceOp.endSeq
        model.items = model.items
          .filter(item => item.seq === undefined || item.seq < start || item.seq > end)
          .map((item, index) => item.id === index ? item : { ...item, id: index })
        // nextId was captured before the prune; rebase it on the densified list.
        nextId = model.items.length
        push({
          kind: 'notice',
          text: replaceMarkerNotice(event.data.message.content),
          streaming: false,
          seq: event.seq,
          notice: 'compact',
        })
      }
      break
    }
    case 'user/message': {
      // Compaction checkpoint: render as a framed notice, not a bubble. The
      // checkpoint source kind is plugin-merged (dsh-compaction), so read it
      // through the merge-extensible fall-through like the web UI does.
      const source = event.data.source as { kind?: unknown }
      if (source.kind === 'compact-checkpoint') {
        push({
          kind: 'notice',
          text: 'Conversation compacted',
          streaming: false,
          seq: event.seq,
          notice: 'compact',
        })
        const summary = compactSummaryText(textOf(event.data.content))
        if (summary) {
          push({
            kind: 'notice',
            text: summary,
            streaming: false,
            seq: event.seq,
            notice: 'compact',
          })
        }
        break
      }
      // Only direct human prompts render as bubbles; other injected context
      // (goal/skill sources) is skipped.
      if (event.data.source.kind !== 'user') break
      const text = textOf(event.data.content)
      if (text) {
        model.lastUserText = text
        push({ kind: 'user', text, streaming: false, seq: event.seq })
      }
      break
    }
    case 'assistant/attempt': {
      // A settled attempt that committed no surface message (failed, retried,
      // or interrupted). Its embedded compact stream replaces the open items'
      // text: live frames already folded the same deltas, and on replay it is
      // the only source. The authoritative `assistant/message` still seals.
      const chunks = expandAssistantStream(event.data.stream)
      replaceStreamText(model, 'reasoning', chunks, event.seq)
      replaceStreamText(model, 'assistant', chunks, event.seq)
      break
    }
    case 'assistant/message': {
      // The assembled message is authoritative (chunks may have been
      // compacted or pruned); replace the streamed text and seal.
      const item = currentStreaming(model, 'assistant', event.seq)
      const text = textOf(event.data.message.content)
      if (text) item.text = text
      item.streaming = false
      model.openAssistant = undefined
      sealReasoning(model)
      const usage = event.data.usage
      if (usage !== undefined) {
        model.tokens.input += usage.inputTokens
        model.tokens.output += usage.outputTokens
      }
      break
    }
    case 'tool/call': {
      // ask_user_question renders through the userQuestions provider (M2),
      // not as a tool card — the model parks waiting for a human answer.
      if (event.data.name === 'ask_user_question') break
      const planText = toolPlanText(event.data.name, event.data.arguments)
      push({
        kind: 'tool',
        text: '',
        streaming: true,
        seq: event.seq,
        tool: {
          callId: event.data.callId,
          name: event.data.name,
          argsPreview: toolArgsPreview(event.data.name, event.data.arguments),
          status: 'running',
          ...(planText !== undefined ? { planText } : {}),
        },
      })
      break
    }
    case 'tool/result': {
      const callId = event.data.message.source.callId
      const card = model.items.find(
        (item): item is ChatItem & { tool: ToolCardState } =>
          item.kind === 'tool' && item.tool !== undefined && item.tool.callId === callId,
      )
      if (card === undefined) break
      card.streaming = false

      const content = event.data.message.content
      const result = textOf(content)
      // A plain `Error` thrown by a tool body carries no `event.data.error`
      // (only HarnessErrors do); its failure is flagged on the result message.
      const failed = event.data.error !== undefined || event.data.message.isError === true

      if (failed) {
        const notApproved =
          card.tool.name === 'exit_plan_mode' ? exitPlanNotApproved(result) : undefined
        if (notApproved !== undefined) {
          card.tool.status = 'rejected'
          card.tool.resultPreview = notApproved
        } else {
          card.tool.status = 'error'
          const failure = event.data.error
          card.tool.errorText =
            failure !== undefined ? `${failure.name}: ${failure.code}` : stripErrorPrefix(result)
        }
        break
      }

      card.tool.status = 'ok'
      if (result) {
        card.tool.resultPreview = preview(result, RESULT_PREVIEW_LIMIT)
        card.tool.resultFull = result
      }
      const imageRefs = content
        .flatMap(block => (block.type === 'image' ? [block.attachment] : []))
      if (imageRefs.length > 0) card.tool.imageRefs = imageRefs
      const meta = event.data.meta as { diffs?: unknown } | undefined
      if (meta !== undefined && Array.isArray(meta.diffs)) {
        const diffs = meta.diffs.filter(isFileDiff)
        if (diffs.length > 0) card.tool.diffs = diffs
      }
      break
    }
    case 'request/header': {
      // The request actually dispatched: read back the resolved route and
      // reasoning effort (status-bar truth, durable on replay).
      const config = event.data.header.config as
        { provider?: string; model?: string; reasoningEffort?: string } | undefined
      if (config !== undefined) {
        model.route = {
          ...(config.provider !== undefined ? { provider: config.provider } : {}),
          ...(config.model !== undefined ? { model: config.model } : {}),
        }
        if (config.reasoningEffort !== undefined) model.effort = config.reasoningEffort
      }
      break
    }
    case 'turn/start': {
      model.working = true
      break
    }
    case 'turn/end': {
      model.working = false
      // A sealed turn folds all its reasoning blocks into collapsed labels.
      for (const item of model.items) {
        if (item.kind === 'reasoning') item.streaming = false
      }
      model.openReasoning = undefined
      model.openAssistant = undefined
      // Surface non-completed endings as notices.
      const reason = event.data.reason
      if (reason.kind === 'error') {
        const failure = reason.error
        push({
          kind: 'notice',
          text: `turn failed: ${failure.code}${failure.message ? ` — ${failure.message}` : ''}`,
          streaming: false,
          seq: event.seq,
          notice: 'error',
        })
      } else if (reason.kind === 'aborted') {
        push({
          kind: 'notice',
          text: 'turn aborted',
          streaming: false,
          seq: event.seq,
          notice: 'info',
        })
      } else if (reason.kind === 'max-tokens') {
        push({
          kind: 'notice',
          text: 'turn hit the output-token ceiling',
          streaming: false,
          seq: event.seq,
          notice: 'info',
        })
      }
      break
    }
    default:
      // Plugin-merged events (e.g. `session/title` from the harness's
      // session-title row) are outside the local SessionEventMap; fold the
      // ones we render without widening the union.
      foldPluginEvent(model, event)
      break
  }
  return model
}

/**
 * Fold plugin-merged session events the local dsh-session types do not
 * declare. Current surface: `session/title` feeds the status bar's title
 * segment (official auto-titles and `/rename` both land here on replay).
 */
function foldPluginEvent(model: ChatModel, event: SessionEvent): void {
  const raw = event as unknown as { type?: string; data?: { title?: unknown } }
  /* v8 ignore start -- structural read of a plugin-merged event: the guards
   * defend the `as` cast above against out-of-repo producers, and the local
   * type graph cannot name the merged kind. */
  if (
    raw.type === 'session/title' &&
    typeof raw.data?.title === 'string' &&
    raw.data.title !== ''
  ) {
    model.title = raw.data.title
  }
  /* v8 ignore stop */
}

/**
 * Inner text of the `<compacted-summary>` block a landed checkpoint frames
 * (dsh-compaction wraps the summary in a model-facing preamble and tags), or
 * the whole text when the framing is absent.
 */
function compactSummaryText(text: string): string {
  const start = text.indexOf('<compacted-summary>')
  const end = text.lastIndexOf('</compacted-summary>')
  if (start === -1 || end === -1 || end < start) return text
  return text.slice(start + '<compacted-summary>'.length, end).trim()
}

/** Joined delta text of one kind within an expanded attempt stream. */
function attemptText(chunks: readonly TimedStreamChunk[], type: 'text-delta' | 'reasoning-delta'): string {
  let text = ''
  for (const { chunk } of chunks) {
    if (chunk.type === type && chunk.text) text += chunk.text
  }
  return text
}

/**
 * Set one open streaming item's text to an attempt stream's delta text,
 * creating the item when absent (replay). Replacement (not append) keeps a
 * live attempt's event from duplicating the deltas its frames already folded.
 */
function replaceStreamText(
  model: ChatModel,
  kind: 'assistant' | 'reasoning',
  chunks: readonly TimedStreamChunk[],
  seq?: number,
): void {
  const text = attemptText(chunks, kind === 'assistant' ? 'text-delta' : 'reasoning-delta')
  if (text === '') return
  const item = currentStreaming(model, kind, seq)
  item.text = text
}

/**
 * Fold one live stream chunk from the agent's `agent/assistant-stream`
 * publication (the process-local successor of the retired durable
 * `assistant/chunk` events) into the open streaming items.
 */
export function applyStreamChunk(model: ChatModel, chunk: StreamChunk): ChatModel {
  if (chunk.type === 'text-delta' && chunk.text) {
    const item = currentStreaming(model, 'assistant')
    item.text += chunk.text
  } else if (chunk.type === 'reasoning-delta' && chunk.text) {
    const item = currentStreaming(model, 'reasoning')
    item.text += chunk.text
  }
  return model
}

/** The open streaming item of a kind for the current step, or a fresh one.
 * The open-item cache keeps chunk folding O(1) instead of re-scanning the
 * transcript on every delta. */
function currentStreaming(
  model: ChatModel,
  kind: 'assistant' | 'reasoning',
  seq?: number,
): ChatItem {
  const existing = kind === 'assistant' ? model.openAssistant : model.openReasoning
  if (existing !== undefined) return existing
  const item: ChatItem = {
    id: model.items.length,
    kind,
    text: '',
    streaming: true,
    ...(seq !== undefined ? { seq } : {}),
  }
  model.items.push(item)
  if (kind === 'assistant') model.openAssistant = item
  else model.openReasoning = item
  return item
}

/** Seal the open reasoning item for the step (collapse to a label). */
function sealReasoning(model: ChatModel): void {
  const item = model.openReasoning
  if (item !== undefined) {
    item.streaming = false
    model.openReasoning = undefined
  }
}

/** Push a UI-side notice (slash-command results, errors) into the transcript. */
export function pushNotice(
  model: ChatModel,
  text: string,
  notice: NonNullable<ChatItem['notice']> = 'info',
): ChatItem {
  const item: ChatItem = {
    id: model.items.length,
    kind: 'notice',
    text,
    streaming: false,
    notice,
  }
  model.items.push(item)
  return item
}
