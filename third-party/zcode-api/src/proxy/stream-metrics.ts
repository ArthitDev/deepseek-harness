/** Client-observed decode speed, separate from request latency/TTFB.
 * Like GenAI-Perf's per-user throughput, exclude the first token and TTFT.
 * SSE chunks are not tokens; only authoritative usage supplies the count.
 * Buffered/batched delivery still makes this an approximation of model speed.
 */
export class StreamMetrics {
  tokens = 0;
  firstOutputAt: number | undefined;
  lastOutputAt: number | undefined;

  observe(value: unknown, now: number): void {
    if (!value || typeof value !== "object") return;
    const j = value as Record<string, any>;
    const count = j.usage?.completion_tokens ?? j.usage?.output_tokens;
    if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
      this.tokens = count;
    }
    const nonempty = (v: unknown) => typeof v === "string" && v.length > 0;
    const delta = j.choices?.[0]?.delta;
    const anthropic = j.type === "content_block_delta" && (
      (j.delta?.type === "text_delta" && nonempty(j.delta.text)) ||
      (j.delta?.type === "thinking_delta" && nonempty(j.delta.thinking)) ||
      (j.delta?.type === "input_json_delta" && nonempty(j.delta.partial_json))
    );
    const openai = delta && (nonempty(delta.content) || nonempty(delta.reasoning_content) ||
      nonempty(delta.function_call?.arguments) ||
      (Array.isArray(delta.tool_calls) && delta.tool_calls.some((t: any) => nonempty(t.function?.arguments))));
    if (anthropic || openai) {
      this.firstOutputAt ??= now;
      this.lastOutputAt = now;
    }
  }

  get generationMs(): number {
    return this.firstOutputAt === undefined || this.lastOutputAt === undefined
      ? 0 : this.lastOutputAt - this.firstOutputAt;
  }

  get tokensPerSecond(): number {
    return this.tokens > 1 && this.generationMs > 0
      ? (this.tokens - 1) * 1000 / this.generationMs : 0;
  }
}
