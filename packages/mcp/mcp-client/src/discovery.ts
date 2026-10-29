/** Bounded MCP catalog queries and guarded calls without eagerly presenting every schema. */

import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError, ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-system-prompt'

/**
 * Present one server through a searchable catalog and retain native dispatch policies.
 * @param ctx - server registration context, which owns all effects.
 * @param catalog - current generation's native definitions, keyed by their public names.
 * @param name - reserved, server-qualified discovery tool name.
 * @param limit - maximum catalog matches returned per query.
 * @returns the effect disposer for the discovery tool and schema filter.
 */
export function registerMcpDiscovery(
  ctx: Context,
  catalog: ReadonlyMap<string, ToolDefinition>,
  name: string,
  limit: number,
): () => void {
  const projections = new WeakMap<ToolExecution, { value: JsonValue; content: ContentBlock[] }>()
  const visible = (exec: ToolExecution): ToolDefinition[] => [...catalog.values()]
    .filter(tool => ctx.tools.get(tool.name, exec.agent)?.execute === tool.execute)
  // oxlint-disable-next-line typescript/no-misused-promises -- Both contributions withdraw synchronously; Cordis owns completion.
  return ctx.effect(function* () {
    yield ctx.tools.register(defineTool({
      name,
      description: 'Discover MCP tools without loading every schema. List or search tools, read the schema of one tool, then call it with its exact public name and arguments. Calls use the same permission and scope checks as native tools.',
      parameters: {
        action: { type: 'string', required: true, enum: ['list', 'search', 'schema', 'call'] },
        query: { type: 'string', description: 'Search terms, matched against tool names and descriptions.' },
        tool: { type: 'string', description: 'Exact public tool name returned by list or search.' },
        arguments: { type: 'object', additionalProperties: true, description: 'Arguments matching the selected schema, for call only.' },
        offset: { type: 'integer', description: 'Non-negative result offset for list or search.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0)) {
          throw new Error('offset must be a non-negative safe integer')
        }
        const tools = visible(exec)
        if (args.action === 'list' || args.action === 'search') {
          const query = args.query?.trim().toLowerCase() ?? ''
          if (args.action === 'search' && query.length === 0) throw new Error('search requires a non-empty query')
          const terms = query.split(/\s+/).filter(Boolean)
          const ranked = tools.map((tool) => {
            const toolName = tool.name.toLowerCase()
            const description = tool.description.toLowerCase()
            const score = terms.reduce((sum, term) => sum + (toolName === term ? 8
              : toolName.includes(term) ? 4 : description.includes(term) ? 1 : 0), 0)
            return { tool, score }
          }).filter(item => query.length === 0 || item.score > 0)
            .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
          const offset = args.offset ?? 0
          const matches = ranked.slice(offset, offset + limit).map(({ tool }) => ({
            name: tool.name, description: tool.description,
          }))
          return {
            tools: matches, total: ranked.length,
            nextOffset: offset + matches.length < ranked.length ? offset + matches.length : null,
          }
        }
        const tool = tools.find(tool => tool.name === args.tool)
        if (tool === undefined) throw new Error('tool is unavailable in this agent scope; use list or search for an exact public name')
        if (args.action === 'schema') return { name: tool.name, description: tool.description, parameters: tool.parameters as JsonValue }
        const result = await ctx.tools.execute({
          callId: ToolCallId(randomUUID()), rootCallId: exec.rootCallId, parent: exec.token,
          name: tool.name, arguments: args.arguments ?? {}, signal: exec.signal,
          ...exec.agent === undefined ? {} : { agent: exec.agent },
        })
        for (const context of result.additionalContexts ?? []) exec.deferContext(context)
        if (result.isError) {
          if (result.error.info === undefined) throw new Error(result.error.message)
          const error = new HarnessError(result.error.message, result.error.info.code)
          error.name = result.error.info.name
          throw error
        }
        if (result.concludesTurn === true) exec.concludeTurn()
        const value: JsonValue = { tool: tool.name, value: result.value }
        projections.set(exec, { value, content: result.content })
        return value
      },
      projectContent(exec, result) {
        const projection = projections.get(exec)
        projections.delete(exec)
        return projection !== undefined && !result.isError && isDeepStrictEqual(result.value, projection.value)
          && isDeepStrictEqual(result.content, [{ type: 'text', text: JSON.stringify(projection.value) }])
          ? projection.content : undefined
      },
    }))
    yield ctx.on('system-prompt/assemble', async (_assembly, { scope }, next) => {
      const assembly = await next()
      if (ctx.tools.get(name, scope) === undefined) return assembly
      assembly.tools = assembly.tools.filter((tool) => {
        const definition = catalog.get(tool.name)
        return definition === undefined || ctx.tools.get(tool.name, scope)?.execute !== definition.execute
      })
      return assembly
    })
  }, 'mcp-client.discovery')
}
