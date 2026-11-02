import { describe, expect, it } from "bun:test";
import { anthropicSseToOpenaiSseWithKeepalive } from "./openai-stream-adapter.js";

describe("async OpenAI stream adapter lifecycle", () => {
  it("propagates consumer cancellation while the upstream read is pending", async () => {
    let notifyReading!: () => void;
    const reading = new Promise<void>((resolve) => { notifyReading = resolve; });
    let cancelled = false;
    let upstreamController!: ReadableStreamDefaultController<Uint8Array>;
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) { upstreamController = controller; },
      pull() { notifyReading(); },
      cancel() { cancelled = true; },
    });
    const output = anthropicSseToOpenaiSseWithKeepalive(upstream);
    try {
      await reading;
      await output.cancel();
      expect(cancelled).toBe(true);
    } finally {
      if (!cancelled) upstreamController.close();
    }
  });

  it("cancels the upstream after an in-band terminal error", async () => {
    let cancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}\n\n',
        ));
      },
      cancel() { cancelled = true; },
    });
    const text = await new Response(anthropicSseToOpenaiSseWithKeepalive(upstream)).text();
    expect(text).toContain('"type":"overloaded_error"');
    expect(text).toContain('"message":"busy"');
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(cancelled).toBe(true);
    expect(upstream.locked).toBe(false);
  });

  it("preserves keepalives and translates CR-only events", async () => {
    const input = ': keepalive\r\revent:message_stop\rdata: {"type":"message_stop"}\r\r';
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const char of input) controller.enqueue(new TextEncoder().encode(char));
        controller.close();
      },
    });
    const text = await new Response(anthropicSseToOpenaiSseWithKeepalive(upstream)).text();
    expect(text).toContain(": keepalive\n\n");
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
  });
});
