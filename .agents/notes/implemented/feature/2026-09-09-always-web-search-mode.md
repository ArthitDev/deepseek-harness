# Agent Note: Per-session always web search mode

Status: implemented

English | [中文](2026-09-09-always-web-search-mode.zh.md)

## Problem

The web tools were available, but users could not express a durable preference that every request should search. Repeating the instruction in chat was lost as conversational context changed and provided no visible session state.

## Decision

`dsh-tool-web` owns a `webSearchMode` Session projection folded from `web-search/mode` events. `/web-search always` enables a conditional system-prompt section; `/web-search auto` disables it and leaves tool choice to the model. The standing search guidance recommends `web_search` only for recent or changing information or when context and reliable model knowledge are insufficient; otherwise it preserves direct answers and more relevant tools. Search queries use the user's language by default and add another language only when it improves coverage. The Web bundle mounts `ui-web-search-mode`, which renders a host-confirmed `Web Search` toggle in `conversation.input.webSearch` beside the access selector.

The policy instructs the model to make one external `web_search` call for every user request, place one to four concise queries in that call, use the user's language by default, avoid Chinese unless requested, cite returned sources, use `web_fetch` when needed, treat web content as untrusted data, and stop after a search failure instead of retrying or silently relying on memory. This state is independent of permission, sandbox, approval, and provider configuration.

## Durable and prompt semantics

The event log is authoritative. Projection replay restores the mode after reload or resume, and prompt assembly reads the projection for every request, including requests after compaction. The generated persistence catalog includes `web-search/mode`, so fail-closed stored-log validation recognizes the event before projection replay. The inactive default is `{ always: false }`.

The mode returns provider-neutral `toolChoice: 'required'` through the scoped `agent/tool-choice` waterfall on the first model step of each turn. The DeepSeek and pi-ai adapters map it to their provider protocols, while the system policy selects `web_search`. A model or provider without working structured tool calls still cannot use the mode reliably.

## Alternatives considered

**Store browser-local state.** Rejected because it would drift from the host, disappear across browsers, and not reliably affect prompt assembly.

**Add adapter-specific forced tool choice.** Rejected because the shared generation contract does not support it and coupling this feature to one provider would produce inconsistent behavior.

**Put the preference in every preset.** Rejected because the user requested one session control independent of preset authoring and duplication would make prompt maintenance error-prone.

## Consequences

Users gain a visible, durable per-session control and a matching slash command. A mode change alters the system-prompt prefix and therefore the KV-cache key. The feature adds no permission or network bypass: search still requires a configured, available provider, and model compliance remains policy-based until the adapter contract supports forced tool choice.

Regression tests cover command transitions, log replay, conditional prompt assembly, slot lifecycle, UI locking, and failure display.
