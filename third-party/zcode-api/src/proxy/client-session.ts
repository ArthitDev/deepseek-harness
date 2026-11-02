/**
 * Local client-session inference for cache-affinity experiments.
 *
 * The resolver stores only hashes and generated IDs. It deliberately avoids
 * prompt markers, response mutation, and full prompt persistence.
 *
 * Lineage keys form a Merkle chain: chain[0] hashes the identity head
 * (format/model/system/developer/tools/tool_choice), chain[i] folds in
 * message i. One O(body) hashing pass per request then yields the exact-node
 * key AND every prefix key, so parent matching at any depth costs a single
 * Map lookup instead of re-stringifying the whole prefix.
 *
 * Both `nodes` and `sessions` are recency-ordered Maps (delete+set on touch):
 * TTL sweeps stop at the first fresh entry and cap eviction pops from the
 * front — O(expired)/O(1) instead of the former full-map scan per request.
 */
import nodeCrypto from "node:crypto";
import type { Format } from "../translator/types.js";
import type { ClientIdentityConfig } from "../config/types.js";

export type ClientSessionSource = "none" | "explicit" | "lineage";
export type ClientSessionAction = "off" | "observe" | "enforce";

export interface ClientSessionResult {
  source: ClientSessionSource;
  action: ClientSessionAction;
  confidence: number;
  sessionId?: string;
  upstreamSessionId?: string;
  /** Explicit x-zcode-session-type override (wins over sessionId-prefix derivation). */
  sessionType?: "main" | "subagent" | "other";
  requestId?: string;
  traceId?: string;
  queryId?: string;
}

interface StoredNode {
  sessionId: string;
  upstreamSessionId: string;
  lastSeenAt: number;
}

interface CanonicalRequest {
  model: string;
  head: Record<string, unknown>;
  messages: unknown[];
}

interface ExplicitTraceContext {
  requestId?: string;
  traceId?: string;
  queryId?: string;
  sessionId?: string;
}

export interface ClientSessionResolver {
  /**
   * @param body canonical body for lineage hashing — the POST-TRANSLATION
   *   Anthropic-shaped upstream body (session identity aligns with the
   *   upstream conversation, not the client dialect).
   * @param traceBody raw client body for explicit trace-metadata detection
   *   (client attribution intent lives in the client's own body; OpenAI→
   *   Anthropic translation drops foreign metadata fields). When omitted,
   *   `body` is parsed once and shared with lineage hashing.
   */
  resolve(req: Request, body: string | undefined, format: Format, model: string, config: ClientIdentityConfig, traceBody?: string): ClientSessionResult;
}

/**
 * Prefix depths tried for parent matching, shallowest first. Depth 2 is the
 * canonical assistant+user turn append; 3–4 catch tool rounds that append a
 * variable number of messages (e.g. parallel tool results split across user
 * messages). A match at any depth requires the truncated prefix to have been
 * an actually-seen request node, so unrelated conversations never fuse.
 * Depth 1 is deliberately excluded: a bare single-message append is a new
 * conversation (fork isolation, see the forked-continuation test).
 */
const PARENT_DEPTHS = [2, 3, 4] as const;

/** Hard cap on lineage nodes independent of the session cap (per-session
 * agentic rounds each store a node; 32× leaves generous headroom before an
 * active session's nodes could be LRU'd out from under it). */
const NODES_PER_SESSION_CAP = 32;

export function createClientSessionResolver(now: () => number = () => Date.now()): ClientSessionResolver {
  const nodes = new Map<string, StoredNode>();
  const sessions = new Map<string, StoredNode>();

  /** Re-insert to refresh recency order (Map.set alone keeps the old slot). */
  function touch<K>(map: Map<K, StoredNode>, key: K, node: StoredNode): void {
    map.delete(key);
    map.set(key, node);
  }

  /** Pop oldest-first until under cap (front of a recency-ordered Map). */
  function evictOverCap<K>(map: Map<K, StoredNode>, cap: number): void {
    while (map.size > cap) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
  }

  /** Drop expired entries; recency order lets us stop at the first fresh one. */
  function sweepExpired<K>(map: Map<K, StoredNode>, cutoff: number): void {
    for (const [key, node] of map) {
      if (node.lastSeenAt >= cutoff) break;
      map.delete(key);
    }
  }

  function remember(nodeHash: string, session: StoredNode, config: ClientIdentityConfig): void {
    // Keep a distinct timestamp per lineage node. Sharing this object across
    // node keys makes their timestamps advance without refreshing each Map
    // position, which breaks the ordered TTL sweep's early-exit invariant.
    const stored = { ...session, lastSeenAt: now() };
    touch(nodes, nodeHash, stored);
    touch(sessions, stored.sessionId, stored);
    evictOverCap(sessions, config.maxSessions);
    evictOverCap(nodes, config.maxSessions * NODES_PER_SESSION_CAP);
  }

  return {
    resolve(req, body, format, model, config, traceBody) {
      if (config.mode === "off") return { source: "none", action: "off", confidence: 0 };

      const cutoff = now() - config.ttlSeconds * 1000;
      sweepExpired(nodes, cutoff);
      sweepExpired(sessions, cutoff);

      const traceParsed = parseJsonObject(traceBody ?? body);
      const explicitTrace = requestTraceContext(req, traceParsed);
      if (explicitTrace.sessionId) return explicitResult(explicitTrace, config);

      const canonical = canonicalize(traceBody === undefined ? traceParsed : parseJsonObject(body), format, model);
      if (!canonical) {
        if (hasTraceContext(explicitTrace)) return explicitResult(explicitTrace, config);
        return { source: "none", action: config.mode, confidence: 0 };
      }

      const chain = chainHashes(canonical.head, canonical.messages);
      const exactKey = chain[chain.length - 1];
      const existing = nodes.get(exactKey);
      if (existing) {
        remember(exactKey, existing, config);
        return withTraceContext(result("lineage", config.mode, existing, 0.95), explicitTrace);
      }

      for (const depth of PARENT_DEPTHS) {
        const k = canonical.messages.length - depth;
        if (k < 1) continue;
        const parent = nodes.get(chain[k]);
        if (parent) {
          remember(exactKey, parent, config);
          return withTraceContext(result("lineage", config.mode, parent, depth === 2 ? 0.9 : 0.85), explicitTrace);
        }
      }

      const fresh = newSession();
      remember(exactKey, fresh, config);
      return withTraceContext(result("lineage", config.mode, fresh, 0.75), explicitTrace);
    },
  };
}

export const defaultClientSessionResolver = createClientSessionResolver();

function result(source: ClientSessionSource, action: ClientSessionAction, node: StoredNode, confidence: number): ClientSessionResult {
  return {
    source,
    action,
    confidence,
    sessionId: node.sessionId,
    upstreamSessionId: node.upstreamSessionId,
  };
}

// Explicit session-id headers, tool-specific before generic (first match wins).
// Evidence (2026-10-11, real-source survey):
// - x-opencode-session            OpenCode harness
// - x-claude-code-session-id      Claude Code 2.1.87+ (gateway protocol; also
//                                 paired with x-app: cli / x-stainless-*)
// - claude-code-session-id        non-x variant some Claude Code SDK clients send
// - x-vscode-sessionid            VSCode family — Google Antigravity sends it
//                                 per app launch (agproxy/Antigravity-Manager 抓包)
// - x-session-id                  generic convention
// - x-parent-session-id           subagent lineage
// - helicone-session-id           Helicone proxy convention
// Not added: x-machine-id (machine-granular — would fuse every conversation of
// a machine into one affinity session); x-claude-code-agent-id/-parent-agent-id
// (agent lineage, not conversation identity). SillyTavern has NO native session
// header (thin-server: its Express backend sends only auth/content-type plus
// user-configured additional headers — users can set x-session-id themselves).
const SESSION_ID_HEADERS = [
  "x-opencode-session",
  "x-claude-code-session-id",
  "claude-code-session-id",
  "x-vscode-sessionid",
  "x-session-id",
  "x-parent-session-id",
  "helicone-session-id",
];

function requestTraceContext(req: Request, parsed: Record<string, unknown> | undefined): ExplicitTraceContext {
  const bodyTrace = metadataTrace(parsed);
  return {
    requestId: firstHeader(req.headers, ["x-request-id", "x-client-request-id"]) ?? bodyTrace.requestId,
    traceId: firstHeader(req.headers, ["x-zcode-trace-id"]) ?? bodyTrace.traceId,
    queryId: firstHeader(req.headers, ["x-query-id"]) ?? bodyTrace.queryId,
    sessionId: firstHeader(req.headers, SESSION_ID_HEADERS)
      ?? bodyTrace.sessionId,
  };
}

function explicitResult(trace: ExplicitTraceContext, config: ClientIdentityConfig): ClientSessionResult {
  return {
    source: "explicit",
    action: config.mode,
    confidence: 1,
    ...(trace.requestId ? { requestId: trace.requestId } : {}),
    ...(trace.traceId ? { traceId: trace.traceId } : {}),
    ...(trace.queryId ? { queryId: trace.queryId } : {}),
    ...(trace.sessionId ? { sessionId: trace.sessionId, upstreamSessionId: trace.sessionId } : {}),
  };
}

function withTraceContext(session: ClientSessionResult, trace: ExplicitTraceContext): ClientSessionResult {
  if (!trace.requestId && !trace.traceId && !trace.queryId) return session;
  return {
    ...session,
    ...(trace.requestId ? { requestId: trace.requestId } : {}),
    ...(trace.traceId ? { traceId: trace.traceId } : {}),
    ...(trace.queryId ? { queryId: trace.queryId } : {}),
  };
}

function hasTraceContext(trace: ExplicitTraceContext): boolean {
  return Boolean(trace.requestId || trace.traceId || trace.queryId || trace.sessionId);
}

function firstHeader(headers: Headers, names: string[]): string | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function parseJsonObject(body: string | undefined): Record<string, unknown> | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function metadataTrace(parsed: Record<string, unknown> | undefined): ExplicitTraceContext {
  const metadata = parsed?.metadata;
  if (!metadata || typeof metadata !== "object") return {};
  const meta = metadata as Record<string, unknown>;
  return {
    requestId: stringProperty(meta, ["requestId", "request_id"]),
    traceId: stringProperty(meta, ["traceId", "trace_id"]),
    queryId: stringProperty(meta, ["queryId", "query_id"]),
    sessionId: stringProperty(meta, ["sessionId", "session_id", "conversationId", "conversation_id"]),
  };
}

function stringProperty(obj: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = obj[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function canonicalize(parsed: Record<string, unknown> | undefined, format: Format, fallbackModel: string): CanonicalRequest | null {
  if (!parsed) return null;
  const model = typeof parsed.model === "string" ? parsed.model : fallbackModel;
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  if (messages.length === 0) return null;

  const head = {
    format,
    model,
    system: parsed.system,
    developer: messages.filter((m: unknown) => typeof m === "object" && m !== null && (m as Record<string, unknown>).role === "developer"),
    tools: parsed.tools,
    tool_choice: parsed.tool_choice,
  };
  return { model, head, messages };
}

/**
 * Merkle chain over the conversation: chain[0] covers the identity head,
 * chain[i] folds in message i (index i-1 in `messages`). chain[n] is the
 * exact-request key; chain[k] is the key of "this conversation after k
 * messages" — a prefix that was itself a prior request.
 */
function chainHashes(head: Record<string, unknown>, messages: unknown[]): string[] {
  const chain: string[] = [hashJson(head)];
  for (let i = 0; i < messages.length; i++) {
    chain.push(hashString(`${chain[i]}\n${hashJson(messages[i])}`));
  }
  return chain;
}

function newSession(): StoredNode {
  const upstreamSessionId = nodeCrypto.randomUUID();
  return {
    sessionId: `ses_${upstreamSessionId.replace(/-/g, "").slice(0, 12)}`,
    upstreamSessionId,
    lastSeenAt: 0, // stamped by remember() on the injected clock
  };
}

function hashJson(value: unknown): string {
  return hashString(stableStringify(value));
}

function hashString(value: string): string {
  return nodeCrypto.createHash("sha256").update(value, "utf-8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
