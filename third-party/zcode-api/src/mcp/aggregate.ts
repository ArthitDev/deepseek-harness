/**
 * Aggregated MCP server core: ONE `/mcp` endpoint exposing the tools of every
 * official plugin in the catalogue — clients configure a single MCP server
 * URL instead of one per plugin (scheduling/config sprawl). Replaces the old
 * per-plugin `/mcp/{key}` passthrough relay.
 *
 * Protocol surface (streamable HTTP, stateless aggregate — no client session
 * is issued; upstream sessions are internal and lazily established):
 *
 *   initialize              → serverInfo zcode-proxy-mcp, tools capability
 *   notifications/*         → accepted, no response (HTTP 202 at the route)
 *   ping                    → {}
 *   tools/list              → all plugins' tools, namespaced `{key}__{tool}`;
 *                             unavailable plugins are skipped and reported in
 *                             `result._meta.unavailable` (skipping beats
 *                             failing: one paid-gated plugin must not hide
 *                             the other fourteen)
 *   tools/call              → dispatch `{key}__{tool}` to its plugin session;
 *                             one automatic re-initialize on upstream session
 *                             expiry (HTTP 404), then the result passes
 *                             through verbatim (isError results included)
 *   anything else           → -32601 Method not found
 *
 * Tool namespace: `{catalogueKey}__{upstreamToolName}` (MCP tool names are
 * `[a-zA-Z0-9_-]{1,64}`; catalogue keys are dash-case so the pair fits).
 * Dispatch strips exactly one `{key}__` prefix — an upstream tool that itself
 * contains `__` is preserved.
 *
 * Tools cache: per-plugin tools/list is cached (default 5min,
 * `MCP_AGGREGATE_TOOLS_TTL_MS`) so tool-heavy clients don't hammer the
 * gateway; a failed plugin keeps its reason until the TTL lapses.
 *
 * @see upstream.ts for the per-plugin JSON-RPC client
 * @see ../server/routes-mcp.ts for the HTTP surface
 */
import {
  OfficialMcpUpstream,
  McpSessionExpiredError,
  type UpstreamTool,
} from "./upstream.js";
import { OFFICIAL_MCP_CATALOGUE } from "./catalogue.js";
import type { OfficialMcpAuth } from "./upstream.js";

const KNOWN_PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const NAMESPACE_SEPARATOR = "__";

export interface AggregateTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  [k: string]: unknown;
}

export interface AggregateToolsListResult {
  tools: AggregateTool[];
  _meta?: { unavailable: Array<{ key: string; reason: string }> };
}

export interface AggregateUnavailable {
  key: string;
  reason: string;
}

interface PluginSlot {
  key: string;
  routeId: string;
  path: string;
  upstream?: OfficialMcpUpstream;
  tools?: UpstreamTool[];
  toolsAt?: number;
  unavailableReason?: string;
  /** In-flight ensureTools dedup — concurrent tools/list share one probe. */
  ensuring?: Promise<void>;
}

export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

export type JsonRpcSuccess = { jsonrpc: "2.0"; id: number | string | null; result: unknown };
export type JsonRpcError = { jsonrpc: "2.0"; id: number | string | null; error: { code: number; message: string; data?: unknown } };
export type JsonRpcReply = JsonRpcSuccess | JsonRpcError;

/** One aggregate handler result: a reply for requests, nothing for notifications. */
export type HandleOutcome =
  | { kind: "reply"; message: JsonRpcReply }
  | { kind: "notification" };

export class McpAggregateServer {
  private readonly slots: PluginSlot[];
  private readonly toolsTtlMs: number;

  constructor(
    private readonly origin: string,
    private readonly auth: OfficialMcpAuth,
    private readonly options: { fetchImpl?: typeof fetch; serverVersion?: string; toolsTtlMs?: number } = {},
  ) {
    this.slots = OFFICIAL_MCP_CATALOGUE.servers.map((s) => ({
      key: s.key,
      routeId: s.routeId,
      path: s.path,
    }));
    this.toolsTtlMs = options.toolsTtlMs ?? aggregateToolsTtlMs();
  }

  /**
   * Handle one decoded JSON-RPC message. Batch arrays are the route's job
   * (it maps over entries and drops notification-only bodies per spec).
   */
  async handle(message: JsonRpcMessage): Promise<HandleOutcome> {
    if (message.method === undefined) {
      return { kind: "reply", message: rpcError(message.id ?? null, -32600, "Invalid Request: missing method") };
    }
    // A message without an id is a notification — never answered, whatever
    // the method (JSON-RPC 2.0 §5).
    if (message.id === undefined || message.id === null) {
      return { kind: "notification" };
    }
    switch (message.method) {
      case "initialize":
        return { kind: "reply", message: rpcResult(message.id, this.initializeResult(message.params)) };
      case "ping":
        return { kind: "reply", message: rpcResult(message.id, {}) };
      case "tools/list":
        return { kind: "reply", message: rpcResult(message.id, await this.listTools()) };
      case "tools/call":
        return { kind: "reply", message: await this.callTool(message.id, message.params) };
      default:
        return { kind: "reply", message: rpcError(message.id, -32601, `Method not found: ${message.method}`) };
    }
  }

  private initializeResult(params: unknown): unknown {
    const requested = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
    const protocolVersion = requested && KNOWN_PROTOCOL_VERSIONS.has(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "zcode-proxy-mcp", version: this.options.serverVersion ?? "1.0.0" },
      instructions: `All ${OFFICIAL_MCP_CATALOGUE.servers.length} official plugin tools behind one endpoint; tool names are {plugin}__{tool}.`,
    };
  }

  /** All plugins probed in parallel; failures degrade to _meta.unavailable. */
  private async ensureAllTools(): Promise<{ tools: AggregateTool[]; unavailable: AggregateUnavailable[] }> {
    await Promise.all(this.slots.map((slot) => this.ensureSlotTools(slot)));
    const tools: AggregateTool[] = [];
    const unavailable: AggregateUnavailable[] = [];
    for (const slot of this.slots) {
      if (slot.unavailableReason) {
        unavailable.push({ key: slot.key, reason: slot.unavailableReason });
      } else if (slot.tools !== undefined) {
        for (const t of slot.tools) {
          if (typeof t?.name !== "string" || t.name.length === 0) continue;
          tools.push({ ...t, name: `${slot.key}${NAMESPACE_SEPARATOR}${t.name}` });
        }
      }
    }
    return { tools, unavailable };
  }

  private async ensureSlotTools(slot: PluginSlot): Promise<void> {
    if (this.fresh(slot)) return;
    slot.ensuring ??= (async () => {
      slot.unavailableReason = undefined;
      try {
        const upstream = (slot.upstream ??= new OfficialMcpUpstream(this.origin, { routeId: slot.routeId, path: slot.path }, this.auth, this.options.fetchImpl));
        await upstream.initialize("zcode-proxy-mcp");
        slot.tools = await upstream.listTools();
        slot.toolsAt = Date.now();
      } catch (err) {
        slot.tools = undefined;
        // toolsAt doubles as the probe timestamp: an unavailable plugin is NOT
        // re-probed until the TTL lapses — otherwise a paid-gated plugin would
        // be hammered on every tools/list.
        slot.toolsAt = Date.now();
        slot.unavailableReason = (err as Error).message;
      } finally {
        slot.ensuring = undefined;
      }
    })();
    await slot.ensuring;
  }

  private fresh(slot: PluginSlot): boolean {
    return slot.toolsAt !== undefined && Date.now() - slot.toolsAt < this.toolsTtlMs;
  }

  private async listTools(): Promise<AggregateToolsListResult> {
    const { tools, unavailable } = await this.ensureAllTools();
    return unavailable.length > 0 ? { tools, _meta: { unavailable } } : { tools };
  }

  private async callTool(id: number | string, params: unknown): Promise<JsonRpcReply> {
    const p = params as { name?: unknown; arguments?: unknown } | undefined;
    const namespaced = typeof p?.name === "string" ? p.name : "";
    const sep = namespaced.indexOf(NAMESPACE_SEPARATOR);
    if (sep <= 0) {
      return rpcError(id, -32602, `Invalid tool name "${namespaced}" — aggregate tools are named {plugin}${NAMESPACE_SEPARATOR}{tool}`);
    }
    const key = namespaced.slice(0, sep);
    const original = namespaced.slice(sep + NAMESPACE_SEPARATOR.length);
    const slot = this.slots.find((s) => s.key === key);
    if (!slot) {
      return rpcError(id, -32602, `Unknown plugin "${key}" in tool name "${namespaced}" — see tools/list`);
    }
    if (!original) {
      return rpcError(id, -32602, `Tool name "${namespaced}" is missing the tool part after "${key}${NAMESPACE_SEPARATOR}"`);
    }
    const upstream = (slot.upstream ??= new OfficialMcpUpstream(this.origin, { routeId: slot.routeId, path: slot.path }, this.auth, this.options.fetchImpl));
    try {
      await upstream.initialize("zcode-proxy-mcp");
      const result = await upstream.callTool(original, p?.arguments);
      return rpcResult(id, result ?? { content: [] });
    } catch (err) {
      if (err instanceof McpSessionExpiredError) {
        // One re-initialize + retry (upstream 404 = session gone).
        try {
          await upstream.close();
          await upstream.initialize("zcode-proxy-mcp");
          const result = await upstream.callTool(original, p?.arguments);
          return rpcResult(id, result ?? { content: [] });
        } catch (retryErr) {
          return upstreamErrorToRpc(id, slot.key, retryErr);
        }
      }
      return upstreamErrorToRpc(id, slot.key, err);
    }
  }

  /** Best-effort close of every established upstream session. */
  async closeAll(): Promise<void> {
    await Promise.allSettled(this.slots.map((s) => s.upstream?.close()));
    for (const s of this.slots) {
      s.tools = undefined;
      s.toolsAt = undefined;
      s.unavailableReason = undefined;
    }
  }
}

function rpcResult(id: number | string, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: number | string | null, code: number, message: string, data?: unknown): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/** Upstream failure → JSON-RPC error that carries the original rpc error data. */
function upstreamErrorToRpc(id: number | string, key: string, err: unknown): JsonRpcError {
  const rpcLike = (err as { rpcError?: { code: number; message: string; data?: unknown } })?.rpcError;
  if (rpcLike) {
    return rpcError(id, rpcLike.code, `plugin "${key}": ${rpcLike.message}`, rpcLike.data);
  }
  return rpcError(id, -32002, `plugin "${key}" call failed: ${(err as Error).message}`);
}

function aggregateToolsTtlMs(): number {
  const raw = Number(process.env.MCP_AGGREGATE_TOOLS_TTL_MS || 300_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 300_000;
}
