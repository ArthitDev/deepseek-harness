import { describe, it, expect } from "bun:test";
import {
  chatCompletionsToResponses,
  extractCustomToolInput,
  newResponsesStreamState,
  chatChunkToResponsesEvents,
  finalizeResponsesStream,
} from "./chat-to-responses.js";
import type { OpenAIChatResponse, OpenAIStreamChunk } from "./types.js";

function chunk(overrides: Partial<OpenAIStreamChunk> = {}): OpenAIStreamChunk {
  return { id: "1", object: "chat.completion.chunk", created: 1, model: "glm-5.2", choices: [], ...overrides };
}

function chatResp(overrides: Partial<OpenAIChatResponse> = {}): OpenAIChatResponse {
  return {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "glm-5.2",
    choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
    ...overrides,
  };
}

describe("chatCompletionsToResponses (batch)", () => {
  it("uses Unix seconds and preserves standard Chat reasoning usage in batch and stream", () => {
    const before = Math.floor(Date.now() / 1000);
    const usage = { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9,
      completion_tokens_details: { reasoning_tokens: 3 } };
    const batch = chatCompletionsToResponses(chatResp({ usage }), "glm-5.2");
    const state = newResponsesStreamState("glm-5.2");
    chatChunkToResponsesEvents(chunk({ usage, choices: [] }), state);
    const terminal = finalizeResponsesStream(state).find(e => e.type === "response.completed")!;
    expect(terminal.type).toBe("response.completed");
    if (terminal.type !== "response.completed") throw new Error("missing completion");
    for (const response of [batch, terminal.response]) {
      expect(response.created_at).toBeGreaterThanOrEqual(before);
      expect(response.created_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
      expect(response.usage?.output_tokens_details?.reasoning_tokens).toBe(3);
    }
  });

  it("assigns consecutive sequence numbers to tool argument events", () => {
    const state = newResponsesStreamState("glm-5.2");
    const events = chatChunkToResponsesEvents(chunk({ choices: [{ index: 0, delta: {
      tool_calls: [{ index: 0, id: "call_1", function: { name: "f", arguments: "{}" } }],
    } }] }), state);
    events.push(...finalizeResponsesStream(state));
    expect(events.map(e => e.sequence_number)).toEqual(events.map((_, i) => i));
  });
  it("translates a text-only response", () => {
    const r = chatCompletionsToResponses(chatResp(), "glm-5.2");
    expect(r.status).toBe("completed");
    expect(r.output[0].type).toBe("message");
    expect((r.output[0] as { content: { type: string; text: string }[] }).content[0]).toEqual({ type: "output_text", text: "hello" });
  });

  it("carries cache-inclusive Chat usage into the Responses usage details", () => {
    const r = chatCompletionsToResponses(chatResp({
      usage: {
        prompt_tokens: 1224,
        completion_tokens: 3,
        total_tokens: 1227,
        prompt_tokens_details: { cached_tokens: 1216 },
      },
    }), "glm-5.2");

    expect(r.usage).toEqual({
      input_tokens: 1224,
      output_tokens: 3,
      total_tokens: 1227,
      input_tokens_details: { cached_tokens: 1216 },
    });
  });

  it("emits reasoning output item before message", () => {
    const r = chatCompletionsToResponses(chatResp({
      choices: [{
        index: 0,
        message: { role: "assistant", content: "answer", reasoning_content: "thinking" },
        finish_reason: "stop",
      }],
    }), "glm-5.2");
    expect(r.output[0].type).toBe("reasoning");
    expect(r.output[1].type).toBe("message");
  });

  it("translates tool_calls to function_call items", () => {
    const r = chatCompletionsToResponses(chatResp({
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: '{"x":1}' } }],
        },
        finish_reason: "tool_calls",
      }],
    }), "glm-5.2");
    const fc = r.output.find((o) => o.type === "function_call");
    expect(fc).toBeDefined();
    expect((fc as { call_id: string }).call_id).toBe("call_1");
    expect((fc as { name: string }).name).toBe("f");
    expect((fc as { arguments: string }).arguments).toBe('{"x":1}');
  });

  it("restores custom_tool_call when name in customToolNames", () => {
    const r = chatCompletionsToResponses(chatResp({
      choices: [{
        index: 0,
        message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "c1", type: "function", function: { name: "exec", arguments: '{"input":"ls"}' } }],
        },
        finish_reason: "tool_calls",
      }],
    }), "glm-5.2", { meta: { customToolNames: new Set(["exec"]), namespaceMap: new Map(), hasToolSearch: false } });
    const ct = r.output.find((o) => o.type === "custom_tool_call") as { input: string } | undefined;
    expect(ct).toBeDefined();
    expect(ct!.input).toBe("ls");
  });

  it("restores tool_search_call with execution:client", () => {
    const r = chatCompletionsToResponses(chatResp({
      choices: [{
        index: 0,
        message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "cs", type: "function", function: { name: "tool_search", arguments: '{"query":"gmail"}' } }],
        },
        finish_reason: "tool_calls",
      }],
    }), "glm-5.2", { meta: { customToolNames: new Set(), namespaceMap: new Map(), hasToolSearch: true } });
    const ts = r.output.find((o) => o.type === "tool_search_call") as { execution: string; arguments: Record<string, unknown> } | undefined;
    expect(ts).toBeDefined();
    expect(ts!.execution).toBe("client");
    expect(ts!.arguments).toEqual({ query: "gmail" });
  });

  it("restores namespace on function_call when name in namespaceMap", () => {
    const r = chatCompletionsToResponses(chatResp({
      choices: [{
        index: 0,
        message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "cn", type: "function", function: { name: "gmail__send", arguments: "{}" } }],
        },
        finish_reason: "tool_calls",
      }],
    }), "glm-5.2", {
      meta: {
        customToolNames: new Set(),
        namespaceMap: new Map([["gmail__send", { namespace: "gmail", name: "send" }]]),
        hasToolSearch: false,
      },
    });
    const fc = r.output.find((o) => o.type === "function_call") as { namespace: string; name: string } | undefined;
    expect(fc).toBeDefined();
    expect(fc!.namespace).toBe("gmail");
    expect(fc!.name).toBe("send");
  });

  it("maps finish_reason 'length' to status 'incomplete'", () => {
    const r = chatCompletionsToResponses(chatResp({
      choices: [{ index: 0, message: { role: "assistant", content: "trunc" }, finish_reason: "length" }],
    }), "glm-5.2");
    expect(r.status).toBe("incomplete");
    expect(r.incomplete_details?.reason).toBe("max_output_tokens");
  });
});

describe("extractCustomToolInput", () => {
  it("extracts input from {input:'dir'}", () => {
    expect(extractCustomToolInput('{"input":"dir"}')).toBe("dir");
  });
  it("falls back to raw on non-JSON", () => {
    expect(extractCustomToolInput("console.log(1)")).toBe("console.log(1)");
  });
  it("falls back to raw on missing input field", () => {
    expect(extractCustomToolInput('{"other":"x"}')).toBe('{"other":"x"}');
  });
});

describe("streaming", () => {

  it("emits full text lifecycle in order with monotonic sequence numbers", () => {
    const state = newResponsesStreamState("glm-5.2");
    const events = [
      ...chatChunkToResponsesEvents(chunk({ choices: [{ index: 0, delta: { role: "assistant" } }] }), state),
      ...chatChunkToResponsesEvents(chunk({ choices: [{ index: 0, delta: { content: "hi" } }] }), state),
      ...chatChunkToResponsesEvents(chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }), state),
      ...finalizeResponsesStream(state),
    ];
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("response.created");
    expect(types).toContain("response.output_item.added");
    expect(types).toContain("response.content_part.added");
    expect(types).toContain("response.output_text.delta");
    expect(types).toContain("response.output_text.done");
    expect(types).toContain("response.content_part.done");
    expect(types).toContain("response.output_item.done");
    expect(types[types.length - 1]).toBe("response.completed");
    // sequence numbers strictly increasing
    const seqs = events.map((e) => (e as { sequence_number: number }).sequence_number);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("keeps the Responses ID stable when upstream chunks have a Chat Completions ID", () => {
    const state = newResponsesStreamState("glm-5.2");
    const events = [
      ...chatChunkToResponsesEvents(chunk({ id: "chatcmpl-upstream", choices: [{ index: 0, delta: { content: "hi" } }] }), state),
      ...chatChunkToResponsesEvents(chunk({ id: "chatcmpl-upstream", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }), state),
      ...finalizeResponsesStream(state),
    ];
    const serializedIds = events
      .filter((event) => event.type === "response.created" || event.type === "response.completed")
      .map((event) => JSON.stringify(event).match(/"id":"([^"]+)"/)?.[1]);
    expect(serializedIds).toHaveLength(2);
    expect(serializedIds[0]).toBeDefined();
    expect(serializedIds[1]).toBe(serializedIds[0]);
    expect(serializedIds[0]).toStartWith("resp_");
  });

  it("opens reasoning item before message on reasoning_content delta", () => {
    const state = newResponsesStreamState("glm-5.2");
    const events = [
      ...chatChunkToResponsesEvents(chunk({ choices: [{ index: 0, delta: { reasoning_content: "think" } }] }), state),
      ...chatChunkToResponsesEvents(chunk({ choices: [{ index: 0, delta: { content: "ans" } }] }), state),
      ...chatChunkToResponsesEvents(chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }), state),
      ...finalizeResponsesStream(state),
    ];
    const types = events.map((e) => e.type);
    const reasoningAddedIdx = types.indexOf("response.output_item.added");
    const reasoningSummaryIdx = types.indexOf("response.reasoning_summary_part.added");
    const reasoningDeltaIdx = types.indexOf("response.reasoning_summary_text.delta");
    expect(reasoningAddedIdx).toBeGreaterThanOrEqual(0);
    expect(reasoningSummaryIdx).toBeGreaterThan(reasoningAddedIdx);
    expect(reasoningDeltaIdx).toBeGreaterThan(reasoningSummaryIdx);
    // reasoning item closed before message opens
    const reasoningDoneIdx = types.indexOf("response.output_item.done");
    expect(reasoningDoneIdx).toBeGreaterThan(reasoningDeltaIdx);
  });

  it("emits function_call lifecycle on tool_calls delta + finalize", () => {
    const state = newResponsesStreamState("glm-5.2");
    const events = [
      ...chatChunkToResponsesEvents(chunk({
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0, id: "call_1", type: "function",
              function: { name: "f", arguments: '{"x":' },
            }],
          },
        }],
      }), state),
      ...chatChunkToResponsesEvents(chunk({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }],
      }), state),
      ...chatChunkToResponsesEvents(chunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }), state),
      ...finalizeResponsesStream(state),
    ];
    const types = events.map((e) => e.type);
    expect(types).toContain("response.function_call_arguments.delta");
    expect(types).toContain("response.function_call_arguments.done");
    // The completed response carries the tool call in output[]
    const completed = events.find((e) => e.type === "response.completed");
    expect(completed).toBeDefined();
    const output = (completed as { response: { output: { type: string }[] } }).response.output;
    expect(output.some((o) => o.type === "function_call")).toBe(true);
  });

  it("uses custom_tool_call_input events for custom tools", () => {
    const state = newResponsesStreamState("glm-5.2", {
      meta: { customToolNames: new Set(["exec"]), namespaceMap: new Map(), hasToolSearch: false },
    });
    const events = [
      ...chatChunkToResponsesEvents(chunk({
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0, id: "c1", type: "function",
              function: { name: "exec", arguments: '{"input":"ls' },
            }],
          },
        }],
      }), state),
      ...chatChunkToResponsesEvents(chunk({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"}' } }] } }],
      }), state),
      ...finalizeResponsesStream(state),
    ];
    const types = events.map((e) => e.type);
    expect(types).toContain("response.custom_tool_call_input.delta");
    expect(types).toContain("response.custom_tool_call_input.done");
    expect(types).not.toContain("response.function_call_arguments.delta");
    expect(events.filter(e => e.type === "response.custom_tool_call_input.delta").map(e => e.delta).join("")).toBe("ls");
  });

  it.each(['echo "hi"\n你好 😀', 'raw non-JSON input', '{"other":"value"}'])("keeps custom deltas equal to final input: %s", (input) => {
    const state = newResponsesStreamState("glm-5.2", {
      meta: { customToolNames: new Set(["exec"]), namespaceMap: new Map(), hasToolSearch: false },
    });
    const raw = input.startsWith("echo") ? JSON.stringify({ input }) : input;
    const events = [...raw].flatMap((part, index) => chatChunkToResponsesEvents(chunk({ choices: [{ index: 0, delta: {
      tool_calls: [{ index: 0, ...(index === 0 ? { id: "c1" } : {}), function: { ...(index === 0 ? { name: "exec" } : {}), arguments: part } }],
    } }] }), state));
    events.push(...finalizeResponsesStream(state));
    expect(events.filter(e => e.type === "response.custom_tool_call_input.delta").map(e => e.delta).join("")).toBe(input);
    expect(events.find(e => e.type === "response.custom_tool_call_input.done")?.input).toBe(input);
  });

  it("preserves allocated output indices when tools precede text and arrive out of index order", () => {
    const state = newResponsesStreamState("glm-5.2");
    const events = [
      ...chatChunkToResponsesEvents(chunk({ choices: [{ index: 0, delta: { tool_calls: [
        { index: 2, id: "c2", function: { name: "second", arguments: "{}" } },
        { index: 0, id: "c0", function: { name: "first", arguments: "{}" } },
      ] } }] }), state),
      ...chatChunkToResponsesEvents(chunk({ choices: [{ index: 0, delta: { content: "after tools" }, finish_reason: "tool_calls" }] }), state),
      ...finalizeResponsesStream(state),
    ];
    const terminal = events.find(e => e.type === "response.completed");
    if (terminal?.type !== "response.completed") throw new Error("missing completed event");
    for (const e of events) {
      if (e.type === "response.output_item.added" || e.type === "response.output_item.done") {
        expect(terminal.response.output[e.output_index].id).toBe(e.item.id);
      }
    }
  });
});
