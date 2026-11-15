---
kind: upgrade-guide
description: "Model requests with routeAllModels enabled now fail when SB is unavailable instead of falling back to direct transport."
---

# Required SB model routing

English | [中文](guide.zh.md)

## Change

`proxy-servers.routeAllModels: true` requires SB CONNECT for main-agent and local subagent model calls. An unavailable, disabled or unhealthy SB returns `proxy-server/start-failed` before provider dispatch. Earlier versions could dispatch directly after a failed startup or readiness probe. Requests already dispatched are never replayed directly.

## Migration

1. Keep `routeAllModels: true` in the active `proxy-servers` patch to require SB. Verify Bun is on the runtime account's `PATH`, SB usage is enabled and the configured port is available. Existing home patches override profile settings.
2. Set `localAgentPolicy: parent` in the active `subagent` patch to require local children with the main agent's preset and provider/model. Remove a conflicting fixed `localAgentPolicy` object when adopting this mode. See [child presets](../../../../packages/subagent/subagent/README.md#child-presets) for resume and parent-selection semantics.
3. Restart Web/TUI after installing the updated code. Send a short request using the selected model, then delegate a local task and confirm both logged request headers use the expected provider/model and preset.
4. Disable SB usage in Proxy Server settings and send another short request. It must fail without reaching the provider. Re-enable SB before continuing. VPN enforcement remains independent; this policy does not constrain arbitrary programs spawned by tools.
