---
description: "Target-scope policy guard plugin: denies tool calls referencing network targets outside the operator-authorized scope, for users composing autonomous (Dead Mode) sessions"
kind: "package-reference"
---

# scope-policy

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-scope-policy` is the deployment-level enforcement half of the Dead Mode posture. It wraps the tool-call pipeline: every call's arguments are read as candidate network targets with the pentest executor's normalized vocabulary; a call referencing an excluded or unauthorized target, an unparseable URL, or a disallowed scheme is refused before the tool body runs. With resolution enabled, each hostname resolves once and is refused when answers touch an excluded IP literal or fail to resolve. The refusal reaches the model as a failed result carrying `SCOPE_DENIED`, the rule, and the target. Nothing ships enabled: mount it in a scoped composition.

## Table of Contents

- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="config"></a>
## Config

| Field | Default | Meaning |
|---|---|---|
| `authorizedTargets` | `[]` | Hosts the run may touch (`host`, `host:port`, `host/path`); empty means every host is authorized |
| `excludedTargets` | `[]` | Hosts refused even when authorized; exclusions always win |
| `allowedSchemes` | `['http', 'https', 'ws', 'wss']` | URL schemes a tool call may reference |
| `resolveAddresses` | `true` | Resolve each hostname once and refuse answers touching an excluded IP literal, or that fail to resolve |

Scope entries that do not parse, an empty `allowedSchemes` list, or a malformed scheme token throw at plugin load — a misconfigured scope never silently disables enforcement. With no scope entries configured the plugin delegates every call unchanged, so mounting it is inert until the operator states a scope.

<a id="model-experience"></a>
## Model Experience

### Scope policy enforcement

#### What the model sees

A denied call replaces the tool result with an `isError` message of the form `Error: denied by scope policy: '<target>' <rule phrase>`; the structured `error.info` (`code`, plus a `reason` detail naming the rule and normalized target) rides the same result for UI rendering. In-scope calls are untouched.

#### Token effect

Zero tokens while calls stay in scope: the plugin registers one `tools/execute` listener and delegates untouched. DNS answers for in-scope hostnames are resolved once per call and never quoted to the model.

#### KV Cache effect

None. The guard registers no prompt sections; denials rewrite only the tool result already in the log.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Hostname authorization is text-based; resolution is exclusion-only.** The resolved-address check compares DNS answers against excluded IP-literal entries; it does not restate the authorized list as CIDRs or pin the connection to the validated answer set. A DNS rebinding race between this check and the tool's own connection remains possible — closing it needs network confinement in the shell sandbox (the seam that already confines files), at which point the resolver here becomes a second opinion rather than the boundary.
- **No per-call command-effect judgment.** The plugin judges targets, protocols, and resolved addresses; it does not classify what a shell command does to an already in-scope host. That stays with the executor's recovery discipline and the run prompt.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
