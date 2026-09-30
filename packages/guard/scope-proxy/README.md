---
description: "Scope-pinning forward proxy plugin: judges every connection against the operator scope and pins it to the validated address, closing DNS rebinding without a sandbox"
kind: "package-reference"
---

# scope-proxy

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-scope-proxy` closes the enforcement gap a `tools/execute` guard cannot: the DNS rebinding race between judging a target and opening the connection. It runs a loopback forward proxy for `HTTP_PROXY` clients (absolute-form requests and `CONNECT` tunnels), judges every connection with the scope-policy vocabulary, resolves the hostname once, and dials the validated address, so a later DNS answer cannot re-point the connection. TLS stays end-to-end: tunnels are blind pipes; the client validates certificates. Its URL ships as the `DSH_SCOPE_PROXY` shell fact; routing the run's `HTTP_PROXY`/`HTTPS_PROXY` at it enforces and pins proxy-aware tooling. Bind to loopback: it judges by target, not caller.

## Table of Contents

- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="config"></a>
## Config

| Field | Default | Meaning |
|---|---|---|
| `authorizedTargets` | `[]` | Hosts the run may touch; empty means only exclusions bind |
| `excludedTargets` | `[]` | Hosts refused even when authorized |
| `allowedSchemes` | `['http', 'https', 'ws', 'wss']` | Schemes an absolute-form request may use |
| `resolveAddresses` | `true` | Resolve once per hostname; refuse answers touching an excluded IP literal, or that fail |
| `host` | `127.0.0.1` | Listener bind address |
| `port` | `0` | Listener port; `0` picks a free one |

Scope entries that do not parse, or an empty `allowedSchemes`, throw at plugin load. Use `ctx.scopeProxy.whenReady()` before reading `ctx.scopeProxy.url` when mounting programmatically; the Loader path resolves the plugin fiber after `apply` returns, so compose the run's environment from the fact below.

<a id="model-experience"></a>
## Model Experience

### Scoped forward proxy

#### What the model sees

The proxy itself is never model-visible; the model sees only `DSH_SCOPE_PROXY` among the managed facts and whatever denial text its HTTP client prints. Refused connections get `403` with a `denied by scope proxy: '<target>' <rule phrase>` body (the CONNECT client may only see the status); allowed ones are forwarded verbatim over the pinned socket.

#### Token effect

Zero tokens. The proxy filters network connections and changes no model request.

#### KV Cache effect

None. The proxy registers no prompt sections and touches no session history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Covers proxy-aware clients only** — `HTTP_PROXY`-honoring tools (curl, PowerShell web cmdlets, most HTTP libraries) are enforced; a tool that ignores proxy variables and connects directly bypasses this plugin. Closing that needs process-level network confinement (the sandbox seam); until then keep the `scope-policy` guard mounted as the per-call second opinion.
- **First-address pinning** — the connection pins to the first validated answer; multi-address hosts use one of their addresses per connection, which is ordinary client behavior, not a scope weakening (every address was validated).
- **UDP and non-HTTP protocols are out of scope** — the proxy speaks HTTP proxy forms only; DNS exfiltration over the resolver itself is not judged here.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
