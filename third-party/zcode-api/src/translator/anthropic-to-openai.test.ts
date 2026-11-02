/**
 * Tests for the Anthropic → OpenAI request translator's `output_config`
 * handling (start-plan direction: Anthropic client → OpenAI upstream).
 * @see src/translator/anthropic-to-openai.ts
 */
import { describe, it, expect } from "bun:test";
import { translateRequestAnthropicToOpenAI } from "./anthropic-to-openai.js";
import type { AnthropicMessagesRequest } from "./types.js";

describe("translateRequestAnthropicToOpenAI: output_config.effort", () => {
  it("carries output_config.effort into reasoning_effort on the OpenAI-format upstream body", () => {
    const req: AnthropicMessagesRequest = {
      model: "glm-5.3",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
      output_config: { effort: "high" },
    };

    const result = translateRequestAnthropicToOpenAI(req);

    expect(result.reasoning_effort).toBe("high");
  });

  it("omits reasoning_effort when output_config is absent", () => {
    const req: AnthropicMessagesRequest = {
      model: "glm-5.3",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
    };

    const result = translateRequestAnthropicToOpenAI(req);

    expect(result.reasoning_effort).toBeUndefined();
  });

  // `output_config` is a GLM-5.3 family extension. A client that sends it on
  // any other model must not have that model's reasoning silently rerouted
  // through a channel it never opted into.
  it("does not carry output_config.effort over for a non-GLM-5.3 model", () => {
    const req: AnthropicMessagesRequest = {
      model: "glm-4.7",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
      output_config: { effort: "high" },
    };

    const result = translateRequestAnthropicToOpenAI(req);

    expect(result.reasoning_effort).toBeUndefined();
  });

  it("omits reasoning_effort when output_config is present but effort is not set", () => {
    const req: AnthropicMessagesRequest = {
      model: "glm-5.3",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
      output_config: {},
    };

    const result = translateRequestAnthropicToOpenAI(req);

    expect(result.reasoning_effort).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// video / document block mapping (mirror of the openai-to-anthropic direction)
// ─────────────────────────────────────────────

describe("translateRequestAnthropicToOpenAI: video / document blocks", () => {
  it("maps video block with base64 source → video_url part with data URL", () => {
    const req: AnthropicMessagesRequest = {
      model: "glm-4.6v",
      messages: [{
        role: "user",
        content: [
          { type: "video", source: { type: "base64", media_type: "video/mp4", data: "AAAAKGZ0eXBtcDQy" } },
          { type: "text", text: "describe this" },
        ],
      }],
      max_tokens: 100,
    };
    const result = translateRequestAnthropicToOpenAI(req);
    const parts = result.messages[0].content as any[];
    expect(parts[0]).toEqual({
      type: "video_url",
      video_url: { url: "data:video/mp4;base64,AAAAKGZ0eXBtcDQy" },
    });
  });

  it("maps video block with url source → video_url part carrying the URL", () => {
    const req: AnthropicMessagesRequest = {
      model: "glm-4.6v",
      messages: [{
        role: "user",
        content: [{ type: "video", source: { type: "url", url: "https://example.com/clip.mp4" } }],
      }],
      max_tokens: 100,
    };
    const result = translateRequestAnthropicToOpenAI(req);
    const parts = result.messages[0].content as any[];
    expect(parts[0]).toEqual({
      type: "video_url",
      video_url: { url: "https://example.com/clip.mp4" },
    });
  });

  it("maps PDF document block with base64 source → file part with file_data data URL", () => {
    const req: AnthropicMessagesRequest = {
      model: "glm-4.6",
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK" }, title: "report.pdf" },
          { type: "text", text: "summarize" },
        ],
      }],
      max_tokens: 100,
    };
    const result = translateRequestAnthropicToOpenAI(req);
    const parts = result.messages[0].content as any[];
    expect(parts[0]).toEqual({
      type: "file",
      file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQK" },
    });
  });

  it("maps text-source document block → plain text part (no base64 round-trip)", () => {
    const req: AnthropicMessagesRequest = {
      model: "glm-4.6",
      messages: [{
        role: "user",
        content: [{ type: "document", source: { type: "text", media_type: "text/plain", data: "plain notes" }, title: "notes.txt" }],
      }],
      max_tokens: 100,
    };
    const result = translateRequestAnthropicToOpenAI(req);
    // single text part collapses to plain-string content (existing rule)
    expect(result.messages[0].content).toBe("plain notes");
  });

  it("maps url-source document block → file part carrying the URL in file_data", () => {
    const req: AnthropicMessagesRequest = {
      model: "glm-4.6",
      messages: [{
        role: "user",
        content: [{ type: "document", source: { type: "url", url: "https://example.com/doc.pdf" }, title: "doc.pdf" }],
      }],
      max_tokens: 100,
    };
    const result = translateRequestAnthropicToOpenAI(req);
    const parts = result.messages[0].content as any[];
    expect(parts[0]).toEqual({
      type: "file",
      file: { filename: "doc.pdf", file_data: "https://example.com/doc.pdf" },
    });
  });
});

describe("translateRequestAnthropicToOpenAI: disable_parallel_tool_use", () => {
  it("maps tool_choice.disable_parallel_tool_use:true → top-level parallel_tool_calls:false (issue #65 mirror)", () => {
    const req: AnthropicMessagesRequest = {
      model: "glm-4.6",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
      tools: [{ name: "fn", input_schema: { type: "object", properties: {} } }],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    };
    const result = translateRequestAnthropicToOpenAI(req);
    expect(result.tool_choice).toBe("auto");
    expect(result.parallel_tool_calls).toBe(false);
  });

  it("omits parallel_tool_calls when disable_parallel_tool_use is absent or false", () => {
    for (const tool_choice of [{ type: "auto" as const }, { type: "any" as const, disable_parallel_tool_use: false }]) {
      const req: AnthropicMessagesRequest = {
        model: "glm-4.6",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 100,
        tools: [{ name: "fn", input_schema: { type: "object", properties: {} } }],
        tool_choice,
      };
      const result = translateRequestAnthropicToOpenAI(req);
      expect(result.parallel_tool_calls).toBeUndefined();
    }
  });

  it("omits parallel_tool_calls without tools even if disable_parallel_tool_use is set", () => {
    const req: AnthropicMessagesRequest = {
      model: "glm-4.6",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    };
    const result = translateRequestAnthropicToOpenAI(req);
    expect(result.parallel_tool_calls).toBeUndefined();
  });
});
