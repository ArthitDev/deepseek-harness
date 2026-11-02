/**
 * OpenAI-format route handlers: /v1/chat/completions + /v1/models.
 */
import { proxyRequest, type ProxyHandlerOptions } from "../proxy/handler.js";
import { ADVERTISED_MODELS } from "../provider/models.js";
import type { OpenAIModelList } from "../translator/types.js";

/** Handle POST /v1/chat/completions — forward OpenAI-compatible chat requests upstream. */
export async function handleChatCompletions(
  req: Request,
  opts: ProxyHandlerOptions,
): Promise<Response> {
  return proxyRequest(req, "openai", opts);
}

/** Handle GET /v1/models — return the advertised model list in OpenAI format. */
export function handleListModels(req: Request): Response {
  // CLIProxyAPI-style rich catalog: DSH's better-basicfun synchronizer probes
  // with ?client_version=pi and parses a top-level `models[]` array with
  // slug/context_window/max_tokens/supported_reasoning_levels fields. A plain
  // OpenAI request keeps the original `data[]` shape.
  const clientVersion = new URL(req.url).searchParams.get("client_version");
  if (clientVersion === "pi") {
    const body = {
      object: "list",
      models: ADVERTISED_MODELS.map((m) => ({
        slug: m.id,
        display_name: m.name,
        description: m.name,
        context_window: m.contextWindow,
        max_context_window: m.contextWindow,
        ...(m.maxOutputTokens === undefined ? {} : { max_tokens: m.maxOutputTokens }),
        // Vision capability is an explicit catalog flag (glm-5.3-flash takes
        // images without a "v" in its id; glm-4.6v-style ids also carry it).
        input_modalities: m.vision ? ["text", "image"] : ["text"],
        supported_reasoning_levels: m.reasoning
          ? [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }]
          : [],
        visibility: "list",
      })),
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const list: OpenAIModelList = {
    object: "list",
    data: ADVERTISED_MODELS.map((m) => ({
      id: m.id,
      object: "model" as const,
      owned_by: "zcode-proxy",
    })),
  };
  return new Response(JSON.stringify(list), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
