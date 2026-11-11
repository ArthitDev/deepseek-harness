---
description: "Operator controls and lifecycle ownership for embedded model proxies."
kind: "package-reference"
---

# @deepseek-ai/dsh-proxy-server

English | [中文](README.zh.md)

## Summary

Inspect and control ZCode Direct, Antigravity, and SB transport without starting processes just to read their status. Save independent usage preferences, start enabled proxies on matching requests, and stop only children owned by this Host. Disabling blocks new matching requests while existing streams finish. All three proxies require Bun; the Harness Host stays on Node.js.

## Table of Contents

- [Use this package](#use-this-package)
- [Configuration](#configuration)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The `proxyServers` service lists ZCode Direct, Antigravity, and SB transport. Reading status probes only their loopback endpoints and never starts a process. `setEnabled` persists one usage preference before starting or stopping that proxy. A failed start retains the saved preference and returns an error; it does not report a running process. Disabling blocks new requests on the configured routes. In-flight requests are not cancelled.

Only children started by this service are stopped, through their live process handles. External listeners remain running, including after disabling usage. Disabling waits for active downstream streams to settle before stopping a child; it saves the preference without waiting for those streams. Operations serialize per proxy; Host disposal stops and awaits its managed children. Opening the settings page does not start proxies. All three usage preferences default to enabled to preserve existing routing; a proxy starts on a matching model request or an explicit switch-on action. Liveshare viewers cannot read or control this Host-wide service.

<a id="configuration"></a>
## Configuration

The volatile `zcodeEnabled`, `antigravityEnabled`, and `sbEnabled` fields hold independent preferences. Ports default to `ZCODE_PORT` or 18080, `ANTIGRAVITY_PORT` or 18877, and `SB_PORT` or 18899. `startupTimeoutMs` defaults to 15000. Provider lists default to `zcode-direct`, `antigravity`, and `sb`/`sb-proxy`, respectively. Matching model prefixes `zcode/`, `antigravity/`, and `sb/` also select the corresponding proxy. Other model routes delegate unchanged.

`externalProxies` defaults to an empty list. Add `zcode`, `antigravity`, or `sb` when another service manager, such as Docker Compose, owns that proxy. Harness verifies readiness, reports `external`, and never starts or stops it; usage switches still block new matching model requests. An unavailable external service returns a startup failure instead of falling back to a local process. External ZCode must return `x-dsh-proxy-service: zcode-proxy` from `/v1/models`; a generic HTTP 200/401 is insufficient. External services do not require local proxy source files.

For proxies managed by Harness, ZCode requires Bun, its prepared worker bundle, and an existing `config.yaml` under `ZCODE_DIR` or `third-party/zcode-api`. All three proxies require Bun on `PATH`; Antigravity and SB run their bundled JavaScript with `bun --no-env-file`, preserving the Host-provided environment without loading additional `.env` files. The Harness Host stays on Node.js. This service neither creates credentials nor performs login, OAuth setup, or upstream model requests. Settings failures and missing setup are reported to the operator.

<a id="further-exploration"></a>
## Further Exploration

- [Proxy settings UI](../../client/ui-proxy-server/README.md): operator switches and process status.
- [Service implementation](src/index.ts): request routing and child-process lifecycle.
- [Lifecycle tests](tests/proxy-server.spec.ts): startup failures, stream draining, and process ownership.

<a id="model-experience"></a>
## Model Experience

### Proxy routing

#### What the model sees

The `proxyServers` service adds no tools, prompt text, or model-visible context. Its `llm/stream` listener starts a matching enabled proxy before dispatch and delegates the request unchanged; disabled usage or startup failure returns a terminal model-request error.

#### Token effect

The service adds no prompt, tool-schema, or message tokens. Status probes make no upstream model requests or billed model calls.

#### KV Cache effect

The service does not rewrite model-request prefixes or add cache content. Upstream cache behavior depends on the selected provider and proxy; this service does not guarantee cache retention across proxy restarts.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Configured provider ids and model prefixes identify routes; arbitrary provider base URLs are not inspected.
- Without an explicit `externalProxies` declaration, an unowned ZCode listener remains `port-in-use` and is never reused or stopped. The integration identity header identifies a deployment; it does not authorize model requests or prove upstream account quota.
- Proxy configuration and authentication must already exist. A missing ZCode checkout cannot be installed from this page.
- Changes through generic plugin configuration affect subsequent request routing; use `setEnabled` to also stop a managed process immediately.
- Managed launch paths are checkout-relative; packaged installations need their proxy scripts supplied at the installation root.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
