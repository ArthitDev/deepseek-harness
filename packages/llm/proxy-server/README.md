---
description: "Operator controls and lifecycle ownership for embedded model proxies."
kind: "package-reference"
---

# @deepseek-ai/dsh-proxy-server

English | [中文](README.zh.md)

## Summary

Inspect and control ZCode Direct and SB transport without starting processes just to read their status. Save independent usage preferences, start enabled proxies on matching requests, and stop only children owned by this Host. Disabling blocks new matching requests while existing streams finish. ZCode Direct and SB require Bun; the Harness Host stays on Node.js.

## Table of Contents

- [Use this package](#use-this-package)
- [Configuration](#configuration)
- [Set up and use the bundled proxies](#set-up-and-use-the-bundled-proxies)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The `proxyServers` service lists ZCode Direct and SB transport. Reading status probes only their loopback endpoints and never starts a process. `setEnabled` persists one usage preference before starting or stopping that proxy. A failed start retains the saved preference and returns an error; it does not report a running process. Disabling blocks new requests on the configured routes. In-flight requests are not cancelled.

Only children started by this service are stopped, through their live process handles. External listeners remain running, including after disabling usage. Disabling waits for active downstream streams to settle before stopping a child; it saves the preference without waiting for those streams. Operations serialize per proxy; Host disposal stops and awaits its managed children. Opening the settings page does not start proxies. Both usage preferences default to enabled to preserve existing routing; a proxy starts on a matching model request or an explicit switch-on action. Liveshare viewers cannot read or control this Host-wide service.

<a id="configuration"></a>
## Configuration

The volatile `zcodeEnabled` and `sbEnabled` fields hold independent preferences. Ports default to `ZCODE_PORT` or 18080 and `SB_PORT` or 18899. `startupTimeoutMs` defaults to 15000. Provider lists default to `zcode-direct`/`zcode-glm` and `sb`/`sb-proxy`, respectively. The ZCode routes start the local backend before dispatch, including Starter through 9router. Only configured provider ids select a proxy; model prefixes such as `zcode/` on other router providers do not select a local sidecar. Other model routes delegate unchanged.

`externalProxies` defaults to an empty list. Add `zcode` or `sb` when another service manager, such as Docker Compose, owns that proxy. Harness waits for verified readiness within `startupTimeoutMs`, reports `external`, and never starts or stops it; usage switches still block new matching model requests. An unavailable external service returns a startup failure instead of falling back to a local process. External ZCode must return `x-dsh-proxy-service: zcode-proxy` from `/v1/models`; a generic HTTP 200/401 is insufficient. External services do not require local proxy source files.

For proxies managed by Harness, ZCode requires Bun, its prepared worker bundle, and an existing `config.yaml` under `ZCODE_DIR` or `third-party/zcode-api`. ZCode Direct and SB require Bun on `PATH`; SB runs its bundled JavaScript with `bun --no-env-file`, preserving the Host-provided environment without loading additional `.env` files. The Harness Host stays on Node.js. This service neither creates credentials nor performs login or upstream model requests. Settings failures and missing setup are reported to the operator.

<a id="set-up-and-use-the-bundled-proxies"></a>
## Set up and use the bundled proxies

These steps apply to an installed checkout on Windows and Linux. Use the same OS account and Harness home for setup and for Web/TUI. A server service account has its own login state; signing in on Windows does not sign in on Linux. Install the repository dependencies and build the Harness before running setup. Node.js must meet the root `package.json` engine requirement, and Bun must be on the runtime account's `PATH`.

| Backend | Default local endpoint | Authentication | Source |
|---|---|---|---|
| SB transport | `http://127.0.0.1:18899` | Harness runtime CONNECT key | Maintained in this repository |
| ZCode Direct | `http://127.0.0.1:18080/v1` | ZCode account plus local proxy API key | [TriDefender/zcode-api](https://github.com/TriDefender/zcode-api) |

ZCode Proxy is vendored under [`third-party/zcode-api`](../../../third-party/zcode-api). Its [upstream record](../../../third-party/zcode-api/UPSTREAM.json) identifies the source version and Harness changes; its [CC-BY-NC-SA-4.0 license](../../../third-party/zcode-api/LICENSE) remains applicable. Harness adds provider registration, credential import, lifecycle management, and SB routing. Native ZCode Direct does not require 9router or a separately installed CLIProxyAPI. Existing router providers remain separate selections.

### Prepare ZCode Direct

1. From the Harness checkout root, run `pnpm zcode:setup`. This installs the vendored backend's declared dependencies when missing, builds its worker, creates a local `third-party/zcode-api/config.yaml` if absent, and imports its local proxy key as `ZCODE_DIRECT_API_KEY`. Repeat setup after a relevant backend or Bun update; existing account configuration is preserved.
2. Complete ZCode authentication on this machine as the runtime account. From `third-party/zcode-api`, run `bun run src/index.ts auth login zai` for Z.ai, or use `bigmodel` for that account type. The account owner completes the upstream login flow. `bun run src/index.ts --help` lists the login commands. An existing official ZCode login can be imported with the upstream `auth login <provider> --import` flow; do not paste tokens into a chat or README.
3. Keep `provider`, `plan`, and `models` in the backend's `config.yaml` consistent with the account. The shipped Harness template uses `provider: zai`, `plan: start-plan`, and the `glm-5.3` / `glm-5.3-flash` model ids. An advertised model still requires quota and access from the upstream account.
4. Restart Harness after changing setup. In TUI, select `/model zcode-direct/glm-5.3-flash` or `/model zcode-direct/glm-5.3`. In Web, select **zcode(starter-direct)** in the model picker. Send a short message to verify real generation. The `zcode-glm` provider displays **zcode(starter-9router)** and reaches the same backend through 9router; both start it on first use. Coding Plan and Pay-G remain separate upstream API routes.

### Enable routing and inspect status

Open **Settings → Proxy Server** in Web to inspect endpoints, routed provider ids, usage preferences, and process ownership. Enable the proxies you intend to use. Reading this page does not start them or authenticate an account. Refresh or reopen it after an external change. A stopped sidecar before the first matching request is normal; a running process alone does not prove account access.

Set `routeAllModels: true` on the active `proxy-servers` configuration to use SB for main and local child model calls. The native path is `Harness → SB CONNECT → ZCode Proxy → ZCode`; other selected providers keep their destination through SB. Keep provider URLs aligned with the manager's configured ports. An existing home patch overrides profile values; inspect `dsh --profile web --dump-config` or `dsh --profile tui --dump-config` locally when diagnosing precedence. The dump can contain private configuration; do not publish it.

| Observation | Check or recovery |
|---|---|
| Native port is stopped before use | Send a matching model request or enable it in Proxy Server settings. |
| ZCode returns 401 | Check that its `config.yaml` key matches the stored `ZCODE_DIRECT_API_KEY`; repeat `pnpm zcode:setup` after changing the local key. |
| Proxy startup reports port in use | Identify the listener and its owner; do not stop another project's process. Declare an intended external backend explicitly or select a free, aligned port. |
| SB is unavailable | With `routeAllModels: true`, the model request is blocked before dispatch. Restore SB and retry; no direct fallback or replay occurs. VPN enforcement remains independent. |
| Migration must be undone | Stop Harness, read the printed backup's `manifest.json`, restore each saved patch to its listed `file`, and restart. Entries with `existed: false` represent files created by migration. Backups contain private configuration and must remain private. |

### Proxy-first routing for every model

CONNECT requires a 256-bit runtime credential stored in `$DSH_HOME/run/sb-connect.key`, created exclusively with owner-only file permissions. Main and child calls share it; managed SB receives the same Harness home. It never enters provider authorization or prompt text. An external SB service must use that home too. Keep the key private and restart Harness and SB together after rotating it.

Set `routeAllModels: true` to tunnel main-agent and local subagent model streams through SB on `sbPort`, preserving the selected provider, model, URL, authorization, and payload. The default is `false`. Before each request, including after a model switch, the lifecycle manager waits for SB's `/health` to identify itself and return `supportsConnect: true`. This applies to managed children and external services on Windows and Linux. `startupTimeoutMs` bounds each startup/readiness operation, including its probes; `routingProbeTimeoutMs` bounds each SB probe and defaults to 1000. Cancellation stops waiting without dispatching a model request.

When SB cannot start, is disabled, or fails its local probe, that call returns `proxy-server/start-failed` before dispatch. There is no direct fallback. VPN enforcement remains independent and must still permit egress. A provider HTTP error or a stream that fails after dispatch never triggers a direct replay. If SB disappears after its successful probe, the current attempt fails; the next attempt probes again. Bedrock receives a per-call proxy environment, and Codex Responses uses SSE while routing is active. Other fetches retain their ambient dispatcher. External agent processes are outside this process's model transport; set [`subagent.localAgentPolicy: parent`](../../subagent/subagent/README.md#child-presets) to require local children with their parent's preset and model route.

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

- With `routeAllModels: false`, configured provider ids and model prefixes identify routes; arbitrary provider base URLs are not inspected.
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
