/**
 * Explicitly configured local Markdown libraries, exposed as paths without reading their contents.
 * @module @deepseek-ai/dsh-tool-fs-search/knowledge
 */

import { appendFile, mkdir, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createDeveloperMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import type { KnowledgeStatus } from './knowledge-types.ts'
import type {} from '@deepseek-ai/dsh-session-projection'
import { defineTool, renderToolsSdk, renderToolsSdkPy, RUN_CODE_NAME, type ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Resolved local library entry points, shared with host UI readers. */
export interface KnowledgeLibrary {
  readonly name: string
  readonly root: string
  readonly index: string
}

const registeredLibraries = new WeakMap<ToolDefinition, readonly KnowledgeLibrary[]>()

/**
 * Read library metadata for the discovery tool visible to an agent, without executing a tool.
 * @param ctx - Host context providing the optional tool registry.
 * @param agent - Agent whose current preset determines tool visibility.
 * @returns configured libraries, or an empty list when discovery is unavailable.
 */
export function knowledgeLibraries(ctx: Context, agent: Agent): readonly KnowledgeLibrary[] {
  const tool = ctx.get('tools')?.get('knowledge_list', agent)
  return tool === undefined ? [] : registeredLibraries.get(tool) ?? []
}

/** A local reference library advertised only when explicitly configured. */
export interface KnowledgeRoot {
  /** Unique lowercase library name, using letters, digits, and hyphens. */
  name: string
  /** Absolute directory path containing an INDEX.md entry point. */
  path: string
  /** Create the standard library skeleton when files are absent; never overwrite existing files. */
  bootstrap?: boolean
}

const DEFAULT_INDEX = '# Knowledge\n\nReusable notes created by agents and people.\n\n## Notes\n'
const DEFAULT_CONTRIBUTING = `# Contributing

- Store only durable, reusable knowledge. Never store credentials, secrets, tokens, or transient logs.
- Create notes as drafts, link them from INDEX.md, and include the sources used.
- Before finishing, verify that the index link resolves and every source is present.
`
const DEFAULT_NOTE_TEMPLATE = `# Title

status: draft

## Summary

## Details

## Sources
`
const NOTE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const NOTE_BODY_MAX_LENGTH = 100_000
const NOTE_SOURCE_MAX_LENGTH = 2_048
const NOTE_SOURCES_MAX = 50

async function writeIfMissing(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
}

async function bootstrapLibrary(path: string): Promise<void> {
  await mkdir(join(path, 'templates'), { recursive: true, mode: 0o700 })
  await Promise.all([
    writeIfMissing(join(path, 'INDEX.md'), DEFAULT_INDEX),
    writeIfMissing(join(path, 'CONTRIBUTING.md'), DEFAULT_CONTRIBUTING),
    writeIfMissing(join(path, 'templates', 'NOTE.md'), DEFAULT_NOTE_TEMPLATE),
  ])
}

async function resolveLibraries(roots: KnowledgeRoot[]) {
  const names = new Set<string>()
  return Promise.all(roots.map(async ({ name, path, bootstrap }) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || names.has(name)) {
      throw new Error('knowledgeRoots: names must be unique lowercase letters, digits, and hyphens')
    }
    names.add(name)
    if (!isAbsolute(path)) throw new Error(`knowledgeRoots: ${name} requires an absolute path`)
    if (bootstrap) await bootstrapLibrary(path)
    const root = await realpath(path)
    const index = await realpath(join(root, 'INDEX.md'))
    const fromRoot = relative(root, index)
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot) || !(await stat(index)).isFile()) {
      throw new Error(`knowledgeRoots: ${name} requires an INDEX.md file inside its root`)
    }
    return { name, root, index }
  }))
}

/**
 * Register path-only discovery when at least one library is configured. Invalid or unavailable
 * roots reject activation; unloading removes the tool. Discovery guidance lives in tool descriptions,
 * including the run_code description when its SDK section is suppressed. A short usage notice is
 * logged once in active model history and restored after compaction removes it.
 * @param ctx - Plugin context owning the tool registration.
 * @param roots - Explicit local library roots; an empty list exposes no discovery or notice.
 * @param timeoutMs - Cooperative tool execution budget in milliseconds.
 */
export async function applyKnowledgeListTool(ctx: Context, roots: KnowledgeRoot[], timeoutMs: number): Promise<void> {
  if (roots.length === 0) {
    ctx.inject(['agents'], (runtime) => {
      runtime.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
        signal.throwIfAborted()
        if (ctx.tools.get('knowledge_list', agent) === undefined) clearKnowledgeContexts(agent.session, turn, step)
        return next()
      })
    })
    return
  }
  const libraries = await resolveLibraries(roots)
  const tool = defineTool({
    name: 'knowledge_list',
    description: `Local Markdown knowledge libraries available: ${libraries.map(library => library.name).join(', ')}. `
      + 'For tasks needing reference knowledge, list the libraries, read the relevant INDEX.md, '
      + 'and use available read/glob/grep tools to retrieve only the notes needed. '
      + 'Cite the note path and source URLs when using their facts. '
      + 'Returns paths only; note contents are retrieved on demand.',
    parameters: {},
    timeoutMs,
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          libraries: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                root: { type: 'string', required: true },
                index: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: () => Promise.resolve({ libraries }),
    presentCall: () => ({ card: 'generic', title: 'Knowledge libraries', kind: 'search', rawInput: '' }),
  })
  registeredLibraries.set(tool, libraries)
  const unregister = ctx.tools.register(tool)
  const createNote = defineTool({
    name: 'knowledge_create_note',
    description: 'Create one sourced draft Markdown note in a configured knowledge library and add it to that library\'s INDEX.md. This is create-only and never overwrites an existing note. Use it for durable reusable knowledge, never credentials, secrets, tokens, or transient logs.',
    parameters: {
      library: { type: 'string', required: true, description: 'Exact library name returned by knowledge_list.' },
      slug: { type: 'string', required: true, description: 'Lowercase kebab-case filename without .md.' },
      title: { type: 'string', required: true, description: 'Single-line note title, at most 200 characters.' },
      body: { type: 'string', required: true, description: `Markdown body, at most ${NOTE_BODY_MAX_LENGTH} characters.` },
      sources: { type: 'array', required: true, items: { type: 'string' }, description: 'One or more source URLs or precise source references.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          library: { type: 'string', required: true },
          path: { type: 'string', required: true },
          index: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const library = libraries.find(candidate => candidate.name === args.library)
      if (library === undefined) throw new Error(`knowledge library "${args.library}" is unavailable`)
      if (args.slug.length > 100 || !NOTE_SLUG.test(args.slug)) {
        throw new Error('knowledge note slug must be lowercase kebab-case and at most 100 characters')
      }
      const title = args.title.trim()
      if (title.length === 0 || title.length > 200 || /[\r\n[\]]/.test(title)) {
        throw new Error('knowledge note title must be one line without brackets and at most 200 characters')
      }
      const body = args.body.trim()
      if (body.length === 0 || body.length > NOTE_BODY_MAX_LENGTH) {
        throw new Error(`knowledge note body must contain 1-${NOTE_BODY_MAX_LENGTH} characters`)
      }
      if (args.sources.length === 0 || args.sources.length > NOTE_SOURCES_MAX) {
        throw new Error(`knowledge note requires 1-${NOTE_SOURCES_MAX} sources`)
      }
      const sources = args.sources.map(source => source.trim())
      if (sources.some(source => source.length === 0 || source.length > NOTE_SOURCE_MAX_LENGTH || /[\r\n]/.test(source))) {
        throw new Error(`knowledge note sources must be single-line values of at most ${NOTE_SOURCE_MAX_LENGTH} characters`)
      }
      exec.signal.throwIfAborted()
      const path = join(library.root, `${args.slug}.md`)
      const content = `# ${title}\n\nstatus: draft\n\n${body}\n\n## Sources\n\n${sources.map(source => `- ${source}`).join('\n')}\n`
      await writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600, signal: exec.signal })
      try {
        exec.signal.throwIfAborted()
        const index = await realpath(join(library.root, 'INDEX.md'))
        if (index !== library.index) throw new Error(`knowledge library "${library.name}" INDEX.md changed after activation`)
        await appendFile(index, `\n- [${title}](${args.slug}.md)\n`, { encoding: 'utf8' })
      } catch (error: unknown) {
        try {
          await unlink(path)
        } catch (rollbackError: unknown) {
          throw new AggregateError([error, rollbackError], `knowledge note creation failed and rollback could not remove "${path}"`)
        }
        throw error
      }
      return { library: library.name, path, index: library.index }
    },
    presentCall: args => ({ card: 'generic', title: `Create knowledge note ${args.slug}`, kind: 'edit', rawInput: args.library }),
  })
  const unregisterCreateNote = ctx.tools.register(createNote)
  const guidance = `Local Wiki libraries available: ${libraries.map(library => library.name).join(', ')}. `
    + 'For reference knowledge, call knowledge_list, read the relevant INDEX.md, then read or search only the notes needed. '
    + 'Cite note paths and source URLs when using their facts. '
    + 'When work produces durable reusable knowledge, or the user asks to add Wiki knowledge, read that library\'s CONTRIBUTING.md and relevant templates, '
    + 'then use knowledge_create_note when available to create a sourced draft and index it. Never store credentials, secrets, tokens, or transient logs. '
    + 'Use available file tools for user-requested edits and run the library\'s documented validation checks. Wiki reads and edits use current file permissions.'
  const digest = createHash('sha256').update(JSON.stringify({ libraries, guidance })).digest('hex')
  ctx.inject(['agents', 'sessionProjections'], (runtime) => {
    const schema = z.object({ libraries: z.array(z.string()).readonly() })
    runtime.sessionProjections.register<'knowledgeStatus', KnowledgeStatus>({
      key: 'knowledgeStatus', stateSchema: schema, stateVersion: 1,
      init: () => ({ libraries: [] }),
      apply: (state, event) => event.type === 'knowledge/status' ? event.data : state,
      wire: { viewSchema: schema, view: state => state },
    })
    const tracked = new Set<Agent>()
    const pending = new WeakSet<Agent>()
    const enabled: KnowledgeStatus = { libraries: libraries.map(library => library.name) }
    const disabled: KnowledgeStatus = { libraries: [] }
    let active = true
    const visible = (agent: Agent): boolean => active && ctx.tools.get(tool.name, agent) === tool
    const publish = (agent: Agent): void => {
      const currentTool = ctx.tools.get(tool.name, agent)
      if (currentTool !== undefined && currentTool !== tool) return
      const status = visible(agent) ? enabled : disabled
      const previous = runtime.sessionProjections.stateOf(agent.session, 'knowledgeStatus')
      if (previous?.libraries.join('\0') === status.libraries.join('\0')) return
      agent.session.append('knowledge/status', status)
    }
    runtime.on('agent/created', ({ agent }) => { tracked.add(agent); publish(agent) })
    runtime.on('agent/disposed', ({ agent }) => { tracked.delete(agent) })
    runtime.on('tools/change', () => {
      if (active) for (const agent of tracked) publish(agent)
    })
    runtime.on('agent/pre-step', async ({ agent, turn, step, signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      signal.throwIfAborted()
      tracked.add(agent)
      publish(agent)
      if (!visible(agent)) {
        pending.delete(agent)
        if (ctx.tools.get(tool.name, agent) === undefined) clearKnowledgeContexts(agent.session, turn, step)
        return decision
      }
      clearKnowledgeContexts(agent.session, turn, step, digest)
      const messages = decision.messages.filter(message => message.source.kind !== 'knowledge-context')
      if (hasKnowledgeContext(agent.session, digest)) {
        pending.delete(agent)
        return messages.length === decision.messages.length ? decision : { ...decision, messages }
      }
      const notice = decision.messages.find(message => message.source.kind === 'knowledge-context' && message.source.digest === digest)
        ?? knowledgeNotice(guidance, digest)
      pending.add(agent)
      return { ...decision, messages: [...messages, notice] }
    })
    // Context-overflow retries do not pass pre-step again. Restore the logged notice before retrying.
    runtime.on('agent/request', async ({ agent, signal }, next) => {
      const config = await next()
      signal.throwIfAborted()
      if (!pending.delete(agent) && visible(agent) && !hasKnowledgeContext(agent.session, digest)) {
        agent.session.append('user/message', knowledgeNotice(guidance, digest), { surfaceOp: 'append' })
      }
      return config
    })
    runtime.effect(() => () => {
      active = false
      unregisterCreateNote()
      unregister()
      for (const agent of tracked) {
        publish(agent)
        if (ctx.tools.get(tool.name, agent) === undefined) {
          const boundary = runtime.sessionProjections.stateOf(agent.session, 'turnBoundary')
          if (boundary === undefined) throw new Error('withdrawing Wiki context on unload requires the turnBoundary projection')
          clearKnowledgeContexts(agent.session, boundary.lastTurn + 1, 1)
        }
      }
    })
    for (const agent of runtime.agents.list()) {
      if (visible(agent)) { tracked.add(agent); publish(agent) }
    }
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    if (ctx.tools.get(tool.name, context.scope) !== tool
      || assembly.tools.some(schema => schema.name === tool.name)
      || !assembly.tools.some(schema => schema.name === RUN_CODE_NAME)) return assembly
    // A complete persona can remove SDK sections after this waterfall. Keep the retrieval API on the callable schema.
    const retrievalNames = new Set([tool.name, createNote.name, 'read', 'glob', 'grep'])
    const schemas = ctx.tools.schemas(context.scope).flatMap((schema) => {
      if (!retrievalNames.has(schema.name)) return []
      const output = ctx.tools.get(schema.name, context.scope)?.output.schema
      return output === undefined ? [] : [{ ...schema, output }]
    })
    const sdk = ctx.get('ptcRuntime')?.language === 'python' ? renderToolsSdkPy(schemas) : renderToolsSdk(schemas)
    return {
      ...assembly,
      tools: assembly.tools.map(schema => schema.name === RUN_CODE_NAME
        ? { ...schema, description: `${schema.description}\n\n${sdk}` }
        : schema),
    }
  })
}

function knowledgeNotice(guidance: string, digest: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: guidance }],
    source: { kind: 'knowledge-context', form: 'instructions', digest },
  })
}

function hasKnowledgeContext(session: Session, digest: string): boolean {
  return session.deriveMessages().some(message => message.role === 'user'
    && message.source.kind === 'knowledge-context' && message.source.digest === digest)
}

function clearKnowledgeContexts(session: Session, turn: number, step: number, keepDigest?: string): void {
  for (const seq of [...session.surface.nodes]) {
    // oxlint-disable-next-line typescript/no-deprecated -- Replacements require the original surface-node sequence.
    const event = session.eventAt(seq)
    if (event?.type !== 'user/message' || event.data.source.kind !== 'knowledge-context'
      || event.data.source.digest === keepDigest) continue
    session.append('developer/message', {
      turn, step, message: createDeveloperMessage({ content: [], source: { kind: 'session-edit' } }),
    }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
  }
}
