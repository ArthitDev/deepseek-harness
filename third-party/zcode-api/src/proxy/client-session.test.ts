/**
 * Tests for local client session inference.
 */
import { describe, it, expect } from "bun:test";
import { createClientSessionResolver } from "./client-session.js";

function makeReq(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:8080/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

const CFG = { mode: "enforce" as const, ttlSeconds: 900, maxSessions: 1024 };

describe("client session resolver", () => {
  it("preserves explicit ZCode-style metadata IDs without hashing them", () => {
    const resolver = createClientSessionResolver();
    const body = JSON.stringify({
      model: "glm-4.6",
      metadata: {
        requestId: "req_client_1",
        traceId: "trace_client_1",
        queryId: "query_turn_1",
        sessionId: "sess_thread_1",
      },
      messages: [{ role: "user", content: "Hi" }],
    });

    const result = resolver.resolve(makeReq(body), body, "anthropic", "glm-4.6", CFG);

    expect(result.source).toBe("explicit");
    expect(result.requestId).toBe("req_client_1");
    expect(result.traceId).toBe("trace_client_1");
    expect(result.queryId).toBe("query_turn_1");
    expect(result.sessionId).toBe("sess_thread_1");
    expect(result.upstreamSessionId).toBe("sess_thread_1");
  });

  it("preserves explicit subagent session headers for emission-time prefix stripping", () => {
    const resolver = createClientSessionResolver();
    const body = JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "Hi" }] });
    const result = resolver.resolve(makeReq(body, {
      "x-request-id": "req_header_1",
      "x-zcode-trace-id": "trace_header_1",
      "x-query-id": "query_header_1",
      "x-session-id": "subagent_agent_worker_1",
    }), body, "anthropic", "glm-4.6", CFG);

    expect(result.source).toBe("explicit");
    expect(result.requestId).toBe("req_header_1");
    expect(result.traceId).toBe("trace_header_1");
    expect(result.queryId).toBe("query_header_1");
    expect(result.sessionId).toBe("subagent_agent_worker_1");
    expect(result.upstreamSessionId).toBe("subagent_agent_worker_1");
  });

  it("accepts Claude Code session headers case-insensitively", () => {
    const resolver = createClientSessionResolver();
    const body = JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "Hi" }] });
    const result = resolver.resolve(makeReq(body, {
      "X-Claude-Code-Session-Id": "  claude_session_1  ",
    }), body, "anthropic", "glm-4.6", CFG);

    expect(result.source).toBe("explicit");
    expect(result.confidence).toBe(1);
    expect(result.sessionId).toBe("claude_session_1");
    expect(result.upstreamSessionId).toBe("claude_session_1");
  });

  it("recognizes the expanded explicit-session header set (Claude Code non-x, VSCode family)", () => {
    const resolver = createClientSessionResolver();
    const body = JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "Hi" }] });

    // Claude Code SDK variant without the x- prefix
    expect(resolver.resolve(makeReq(body, { "claude-code-session-id": "cc_nox_1" }), body, "anthropic", "glm-4.6", CFG)
      .sessionId).toBe("cc_nox_1");
    // VSCode family (Google Antigravity sends x-vscode-sessionid per launch)
    expect(resolver.resolve(makeReq(body, { "x-vscode-sessionid": "vs_sess_1" }), body, "anthropic", "glm-4.6", CFG)
      .sessionId).toBe("vs_sess_1");
    // Claude Code per-request id feeds requestId detection
    expect(resolver.resolve(makeReq(body, { "x-client-request-id": "ccr_1" }), body, "anthropic", "glm-4.6", CFG)
      .requestId).toBe("ccr_1");
  });

  it("prefers tool-specific session headers over the generic x-session-id", () => {
    const resolver = createClientSessionResolver();
    const body = JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "Hi" }] });
    const result = resolver.resolve(makeReq(body, {
      "x-vscode-sessionid": "vs_specific_1",
      "x-session-id": "generic_1",
    }), body, "anthropic", "glm-4.6", CFG);
    expect(result.sessionId).toBe("vs_specific_1");
  });

  it("keeps existing snake_case metadata session fallbacks", () => {
    const resolver = createClientSessionResolver();
    const body = JSON.stringify({
      model: "glm-4.6",
      metadata: {
        request_id: "req_legacy_1",
        trace_id: "trace_legacy_1",
        query_id: "query_legacy_1",
        session_id: "sess_legacy_1",
      },
      messages: [{ role: "user", content: "Hi" }],
    });

    const result = resolver.resolve(makeReq(body), body, "anthropic", "glm-4.6", CFG);

    expect(result.requestId).toBe("req_legacy_1");
    expect(result.traceId).toBe("trace_legacy_1");
    expect(result.queryId).toBe("query_legacy_1");
    expect(result.sessionId).toBe("sess_legacy_1");
  });
  it("keeps lineage session inference when metadata only provides trace IDs", () => {
    const resolver = createClientSessionResolver();
    const body1 = JSON.stringify({
      model: "glm-4.6",
      metadata: {
        requestId: "req_turn_1",
        traceId: "trace_turn_1",
        queryId: "query_turn_1",
      },
      messages: [{ role: "user", content: "Hi" }],
    });
    const body2 = JSON.stringify({
      model: "glm-4.6",
      metadata: {
        requestId: "req_turn_2",
        traceId: "trace_turn_2",
        queryId: "query_turn_2",
      },
      messages: [{ role: "user", content: "Hi" }],
    });

    const first = resolver.resolve(makeReq(body1), body1, "anthropic", "glm-4.6", CFG);
    const second = resolver.resolve(makeReq(body2), body2, "anthropic", "glm-4.6", CFG);

    expect(first.source).toBe("lineage");
    expect(first.upstreamSessionId).toBeTruthy();
    expect(first.requestId).toBe("req_turn_1");
    expect(first.traceId).toBe("trace_turn_1");
    expect(first.queryId).toBe("query_turn_1");
    expect(second.source).toBe("lineage");
    expect(second.upstreamSessionId).toBe(first.upstreamSessionId);
    expect(second.requestId).toBe("req_turn_2");
    expect(second.traceId).toBe("trace_turn_2");
    expect(second.queryId).toBe("query_turn_2");
  });
  it("reuses the same session for exact request bodies", () => {
    const resolver = createClientSessionResolver();
    const body = JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "Hi" }] });

    const first = resolver.resolve(makeReq(body), body, "anthropic", "glm-4.6", CFG);
    const second = resolver.resolve(makeReq(body), body, "anthropic", "glm-4.6", CFG);

    expect(first.source).toBe("lineage");
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.upstreamSessionId).toBe(first.upstreamSessionId);
    expect(second.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("reuses the same session for a linear continuation", () => {
    const resolver = createClientSessionResolver();
    const firstBody = JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "Hi" }] });
    const nextBody = JSON.stringify({
      model: "glm-4.6",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Next" },
      ],
    });

    const first = resolver.resolve(makeReq(firstBody), firstBody, "anthropic", "glm-4.6", CFG);
    const next = resolver.resolve(makeReq(nextBody), nextBody, "anthropic", "glm-4.6", CFG);

    expect(next.sessionId).toBe(first.sessionId);
    expect(next.source).toBe("lineage");
  });

  it("creates separate sessions for forked continuations from the same parent", () => {
    const resolver = createClientSessionResolver();
    const parentBody = JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "Hi" }] });
    const forkA = JSON.stringify({
      model: "glm-4.6",
      messages: [{ role: "user", content: "Hi" }, { role: "user", content: "A" }],
    });
    const forkB = JSON.stringify({
      model: "glm-4.6",
      messages: [{ role: "user", content: "Hi" }, { role: "user", content: "B" }],
    });

    resolver.resolve(makeReq(parentBody), parentBody, "anthropic", "glm-4.6", CFG);
    const a = resolver.resolve(makeReq(forkA), forkA, "anthropic", "glm-4.6", CFG);
    const b = resolver.resolve(makeReq(forkB), forkB, "anthropic", "glm-4.6", CFG);

    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.upstreamSessionId).not.toBe(b.upstreamSessionId);
  });

  it("canonicalizes OpenAI requests while ignoring transport and sampling fields", () => {
    const resolver = createClientSessionResolver();
    const firstBody = JSON.stringify({
      model: "glm-4.6",
      stream: true,
      temperature: 0.2,
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "Hi" }],
    });
    const secondBody = JSON.stringify({
      model: "glm-4.6",
      stream: false,
      temperature: 0.9,
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "Hi" }],
    });

    const first = resolver.resolve(makeReq(firstBody), firstBody, "openai", "glm-4.6", CFG);
    const second = resolver.resolve(makeReq(secondBody), secondBody, "openai", "glm-4.6", CFG);

    expect(second.sessionId).toBe(first.sessionId);
  });

  it("does not throw or allocate a session for malformed or empty bodies", () => {
    const resolver = createClientSessionResolver();

    const malformed = resolver.resolve(makeReq("not-json"), "not-json", "anthropic", "glm-4.6", CFG);
    const empty = resolver.resolve(makeReq(""), undefined, "anthropic", "glm-4.6", CFG);

    expect(malformed.source).toBe("none");
    expect(malformed.sessionId).toBeUndefined();
    expect(empty.source).toBe("none");
    expect(empty.sessionId).toBeUndefined();
  });

  it("reuses the same session when a tool round appends three messages", () => {
    const resolver = createClientSessionResolver();
    const firstBody = JSON.stringify({
      model: "glm-4.6",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "search" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
      ],
    });
    // parallel tool results split across two user messages → 3-message append
    const nextBody = JSON.stringify({
      model: "glm-4.6",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "search" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "read" }, { type: "tool_use", id: "t3", name: "grep" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "a" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t3", content: "b" }] },
      ],
    });

    const first = resolver.resolve(makeReq(firstBody), firstBody, "anthropic", "glm-4.6", CFG);
    const next = resolver.resolve(makeReq(nextBody), nextBody, "anthropic", "glm-4.6", CFG);

    expect(next.source).toBe("lineage");
    expect(next.sessionId).toBe(first.sessionId);
    expect(next.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("mints a fresh session after the lineage TTL expires", () => {
    let clock = 1_000_000;
    const resolver = createClientSessionResolver(() => clock);
    const body = JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "Hi" }] });

    const first = resolver.resolve(makeReq(body), body, "anthropic", "glm-4.6", CFG);
    clock += CFG.ttlSeconds * 1000 + 1;
    const second = resolver.resolve(makeReq(body), body, "anthropic", "glm-4.6", CFG);

    expect(second.source).toBe("lineage");
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it("keeps node-level affinity after a session is LRU-evicted within TTL", () => {
    const smallCfg = { ...CFG, maxSessions: 1 };
    const resolver = createClientSessionResolver();
    const bodyA = JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "A" }] });
    const bodyB = JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "B" }] });
    const bodyA2 = JSON.stringify({
      model: "glm-4.6",
      messages: [{ role: "user", content: "A" }, { role: "assistant", content: "hey" }, { role: "user", content: "more" }],
    });

    const a = resolver.resolve(makeReq(bodyA), bodyA, "anthropic", "glm-4.6", smallCfg);
    resolver.resolve(makeReq(bodyB), bodyB, "anthropic", "glm-4.6", smallCfg);
    const aNext = resolver.resolve(makeReq(bodyA2), bodyA2, "anthropic", "glm-4.6", smallCfg);

    expect(aNext.source).toBe("lineage");
    expect(aNext.sessionId).toBe(a.sessionId);
  });

  it("does not reuse an expired lineage node after another node in its session is refreshed", () => {
    let clock = 0;
    const resolver = createClientSessionResolver(() => clock);
    const cfg = { ...CFG, ttlSeconds: 5 };
    const aFirst = JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "A" }] });
    const aNext = JSON.stringify({
      model: "glm-4.6",
      messages: [
        { role: "user", content: "A" },
        { role: "assistant", content: "answer A" },
        { role: "user", content: "continue A" },
      ],
    });
    const bFirst = JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "B" }] });
    const bNext = JSON.stringify({
      model: "glm-4.6",
      messages: [
        { role: "user", content: "B" },
        { role: "assistant", content: "answer B" },
        { role: "user", content: "continue B" },
      ],
    });

    resolver.resolve(makeReq(aFirst), aFirst, "anthropic", "glm-4.6", cfg);
    clock = 1_000;
    const b = resolver.resolve(makeReq(bFirst), bFirst, "anthropic", "glm-4.6", cfg);
    clock = 2_000;
    resolver.resolve(makeReq(aNext), aNext, "anthropic", "glm-4.6", cfg);
    // Refresh A's newer node. Its earlier node stays at the front of the node
    // map, ahead of B's node, so it must not make B's timestamp look fresh.
    clock = 6_000;
    resolver.resolve(makeReq(aNext), aNext, "anthropic", "glm-4.6", cfg);

    clock = 7_000;
    const afterExpiry = resolver.resolve(makeReq(bNext), bNext, "anthropic", "glm-4.6", cfg);

    expect(afterExpiry.sessionId).not.toBe(b.sessionId);
  });
});
