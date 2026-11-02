/**
 * Unit tests for the aggregated MCP server core (aggregate.ts): namespaced
 * tools/list across the full catalogue, plugin degradation with TTL backoff,
 * tools/call dispatch + session-expiry self-healing, JSON-RPC hygiene.
 */
import { describe, it, expect } from "bun:test";
import { McpAggregateServer } from "./aggregate.js";
import { buildOfficialMcpAuthHeaders } from "./upstream.js";
import { OFFICIAL_MCP_CATALOGUE } from "./catalogue.js";
import type { Credential } from "../auth/types.js";

const AUTH = buildOfficialMcpAuthHeaders({
  apiKey: "sk-id",
  secret: "sec",
  provider: "zai",
  jwt: "jwt-1",
} as Credential);

const PLUGIN_COUNT = OFFICIAL_MCP_CATALOGUE.servers.length;

interface RecordedCall {
  routeId: string;
  method: string;
  params: unknown;
  sessionHeader: string | undefined;
}

interface StubOptions {
  failInit?: Set<string>;
  sseInitialize?: boolean;
  /** tools/call answers HTTP 404 once (session expiry), then succeeds. */
  expireCallOnce?: boolean;
  /** tools/call answers a JSON-RPC error instead of a result. */
  rpcErrorOnCall?: { code: number; message: string };
}

function upstreamStub(opts: StubOptions = {}) {
  const calls: RecordedCall[] = [];
  let expiredOnce = false;
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
  const impl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const routeId = url.pathname.split("/").pop() ?? "";
    if (init?.method === "DELETE") return new Response(null, { status: 202 });
    const body = init?.body ? (JSON.parse(String(init.body)) as { id?: unknown; method?: string; params?: unknown }) : {};
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ routeId, method: body.method ?? "?", params: body.params, sessionHeader: headers["mcp-session-id"] });
    if (body.method === "initialize") {
      if (opts.failInit?.has(routeId)) return new Response("forbidden", { status: 403 });
      const payload = {
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "zcode-official-mcp", version: "1" } },
      };
      if (opts.sseInitialize) {
        return new Response(`data: ${JSON.stringify(payload)}\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream", "mcp-session-id": `sess-${routeId}` },
        });
      }
      return json(payload, { "mcp-session-id": `sess-${routeId}` });
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") {
      return json({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "quote", description: "Get a quote", inputSchema: { type: "object" } }] } });
    }
    if (body.method === "tools/call") {
      if (opts.rpcErrorOnCall) {
        return json({ jsonrpc: "2.0", id: body.id, error: opts.rpcErrorOnCall });
      }
      if (opts.expireCallOnce && !expiredOnce) {
        expiredOnce = true;
        return new Response(null, { status: 404 });
      }
      const name = (body.params as { name?: string })?.name ?? "?";
      return json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: `called:${name}` }] } });
    }
    return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unknown method" } });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

function makeServer(fetchImpl: typeof fetch, toolsTtlMs?: number): McpAggregateServer {
  return new McpAggregateServer("https://gw.test", AUTH, {
    fetchImpl,
    ...(toolsTtlMs !== undefined ? { toolsTtlMs } : {}),
  });
}

const msg = (id: number | string | null, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, params });

async function toolsList(server: McpAggregateServer) {
  const out = await server.handle(msg(1, "tools/list"));
  if (out.kind !== "reply" || "error" in out.message) throw new Error("tools/list failed");
  return out.message.result as { tools: Array<{ name: string }>; _meta?: { unavailable: Array<{ key: string; reason: string }> } };
}

describe("McpAggregateServer — initialize / protocol", () => {
  it("echoes a known protocol version and advertises tools capability", async () => {
    const server = makeServer(upstreamStub().fetch);
    const out = await server.handle(msg(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "c", version: "1" } }));
    expect(out.kind).toBe("reply");
    const result = (out as { message: { result: Record<string, unknown> } }).message.result;
    expect(result.protocolVersion).toBe("2025-03-26");
    expect((result.serverInfo as { name: string }).name).toBe("zcode-proxy-mcp");
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
  });

  it("falls back to the default version for unknown/absent client versions", async () => {
    const server = makeServer(upstreamStub().fetch);
    for (const params of [undefined, { protocolVersion: "1999-01-01" }]) {
      const out = await server.handle(msg(1, "initialize", params));
      expect((out as { message: { result: { protocolVersion: string } } }).message.result.protocolVersion).toBe("2025-06-18");
    }
  });
});

describe("McpAggregateServer — tools/list aggregation", () => {
  it("merges every plugin's tools under {key}__{tool} names", async () => {
    const stub = upstreamStub();
    const { tools, _meta } = await toolsList(makeServer(stub.fetch));
    expect(tools).toHaveLength(PLUGIN_COUNT);
    expect(tools.map((t) => t.name)).toContain("wind-stock__quote");
    expect(tools.map((t) => t.name)).toContain("finance-search__quote");
    expect(_meta).toBeUndefined();
    // one initialize + one tools/list per plugin
    expect(stub.calls.filter((c) => c.method === "initialize")).toHaveLength(PLUGIN_COUNT);
    expect(stub.calls.filter((c) => c.method === "tools/list")).toHaveLength(PLUGIN_COUNT);
  });

  it("TTL-caches the catalogue: a second tools/list hits no upstream", async () => {
    const stub = upstreamStub();
    const server = makeServer(stub.fetch);
    await toolsList(server);
    await toolsList(server);
    expect(stub.calls.filter((c) => c.method === "tools/list")).toHaveLength(PLUGIN_COUNT);
  });

  it("degrades a failing plugin to _meta.unavailable with TTL backoff (no hammering)", async () => {
    const stub = upstreamStub({ failInit: new Set(["finance_tianyancha"]) });
    const server = makeServer(stub.fetch);
    const first = await toolsList(server);
    expect(first.tools).toHaveLength(PLUGIN_COUNT - 1);
    expect(first._meta?.unavailable).toEqual([{ key: "tianyancha", reason: expect.stringContaining("403") }]);
    await toolsList(server); // within TTL — the failing plugin is NOT re-probed
    expect(stub.calls.filter((c) => c.routeId === "finance_tianyancha" && c.method === "initialize")).toHaveLength(1);
  });

  it("re-probes an unavailable plugin once the TTL lapses", async () => {
    const fail = new Set(["finance_tianyancha"]);
    const stub = upstreamStub({ failInit: fail });
    const server = makeServer(stub.fetch, 40);
    const first = await toolsList(server);
    expect(first._meta?.unavailable).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 60));
    fail.clear(); // the plugin recovers
    const second = await toolsList(server);
    expect(second._meta).toBeUndefined();
    expect(second.tools).toHaveLength(PLUGIN_COUNT);
  });

  it("decodes SSE-shaped initialize responses (streamable HTTP POST reply)", async () => {
    const stub = upstreamStub({ sseInitialize: true });
    const { tools } = await toolsList(makeServer(stub.fetch));
    expect(tools).toHaveLength(PLUGIN_COUNT);
  });
});

describe("McpAggregateServer — tools/call dispatch", () => {
  it("routes {key}__{tool} to the plugin with the ORIGINAL tool name and session", async () => {
    const stub = upstreamStub();
    const server = makeServer(stub.fetch);
    await toolsList(server);
    const out = await server.handle(msg(2, "tools/call", { name: "wind-stock__quote", arguments: { symbol: "600519" } }));
    const call = stub.calls.filter((c) => c.method === "tools/call").at(-1)!;
    expect(call.routeId).toBe("finance_wind_stock");
    expect(call.params).toEqual({ name: "quote", arguments: { symbol: "600519" } });
    expect(call.sessionHeader).toBe("sess-finance_wind_stock");
    const result = (out as { message: { result: { content: Array<{ text: string }> } } }).message.result;
    expect(result.content[0]!.text).toBe("called:quote");
  });

  it("re-initializes exactly once on upstream session expiry (HTTP 404) and retries", async () => {
    const stub = upstreamStub({ expireCallOnce: true });
    const server = makeServer(stub.fetch);
    const out = await server.handle(msg(2, "tools/call", { name: "wind-stock__quote", arguments: {} }));
    const result = (out as { message: { result: { content: Array<{ text: string }> } } }).message.result;
    expect(result.content[0]!.text).toBe("called:quote");
    const inits = stub.calls.filter((c) => c.routeId === "finance_wind_stock" && c.method === "initialize");
    expect(inits).toHaveLength(2); // original + one re-init after the 404
  });

  it("preserves upstream JSON-RPC error codes (e.g. 3101 plan errors)", async () => {
    const stub = upstreamStub({ rpcErrorOnCall: { code: 3101, message: "coding plan is required" } });
    const server = makeServer(stub.fetch);
    const out = await server.handle(msg(2, "tools/call", { name: "wind-stock__quote", arguments: {} }));
    const error = (out as { message: { error: { code: number; message: string } } }).message.error;
    expect(error.code).toBe(3101);
    expect(error.message).toContain("wind-stock");
    expect(error.message).toContain("coding plan is required");
  });

  it("rejects malformed / unknown tool names with -32602", async () => {
    const server = makeServer(upstreamStub().fetch);
    for (const name of ["quote", "nope__quote", "wind-stock__", "__quote"]) {
      const out = await server.handle(msg(2, "tools/call", { name, arguments: {} }));
      expect((out as { message: { error: { code: number } } }).message.error.code).toBe(-32602);
    }
  });
});

describe("McpAggregateServer — JSON-RPC hygiene", () => {
  it("answers ping with {}", async () => {
    const out = await makeServer(upstreamStub().fetch).handle(msg(1, "ping"));
    expect((out as { message: { result: unknown } }).message.result).toEqual({});
  });

  it("treats id-less messages as notifications (never answered)", async () => {
    for (const method of ["notifications/initialized", "tools/list", "tools/call"]) {
      const out = await makeServer(upstreamStub().fetch).handle({ jsonrpc: "2.0", method });
      expect(out.kind).toBe("notification");
    }
  });

  it("method not found for non-tool MCP methods", async () => {
    const out = await makeServer(upstreamStub().fetch).handle(msg(1, "prompts/list"));
    expect((out as { message: { error: { code: number } } }).message.error.code).toBe(-32601);
  });
});
