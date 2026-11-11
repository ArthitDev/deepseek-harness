import { describe, expect, it } from "bun:test";
import { StreamMetrics } from "./stream-metrics.js";

describe("stream generation throughput", () => {
  it("excludes prefill, metadata, usage/close delays for both short and long outputs", () => {
    for (const tokens of [11, 101, 1001]) {
      const m = new StreamMetrics();
      m.observe({ choices: [{ delta: { role: "assistant", content: "" } }] }, 0);
      m.observe({ choices: [{ delta: { content: "first" } }] }, 5000);
      m.observe({ choices: [{ delta: { content: "last" } }] }, 5000 + (tokens - 1) * 10);
      m.observe({ usage: { completion_tokens: tokens } }, 100000);
      expect(m.tokensPerSecond).toBe(100);
    }
  });

  it("includes thinking and tool arguments, but not signatures or terminal metadata", () => {
    const m = new StreamMetrics();
    m.observe({ type: "message_start", message: { usage: { output_tokens: 1 } } }, 0);
    m.observe({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "think" } }, 1000);
    m.observe({ type: "content_block_delta", delta: { type: "text_delta", text: "answer" } }, 1500);
    m.observe({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } }, 2000);
    m.observe({ type: "content_block_delta", delta: { type: "signature_delta", signature: "sig" } }, 4000);
    m.observe({ type: "message_delta", usage: { output_tokens: 101 } }, 5000);
    expect(m.tokensPerSecond).toBe(100);
  });

  it("observes OpenAI reasoning and tool argument deltas including usage on the same event", () => {
    const m = new StreamMetrics();
    m.observe({ choices: [{ delta: { reasoning_content: "think" } }] }, 0);
    m.observe({ choices: [{ delta: { tool_calls: [{ function: { arguments: "{}" } }] } }], usage: { completion_tokens: 51 } }, 1000);
    expect(m.tokensPerSecond).toBe(50);
  });

  it("does not invent counts from chunks or rates from a single delivery", () => {
    const m = new StreamMetrics();
    m.observe({ choices: [{ delta: { content: "many tokens in one chunk" } }] }, 1000);
    expect(m.tokens).toBe(0);
    m.observe({ usage: { completion_tokens: 100 } }, 3000);
    expect(m.tokensPerSecond).toBe(0);
    m.observe({ usage: { completion_tokens: NaN } }, 4000);
    expect(m.tokens).toBe(100);
  });
});
