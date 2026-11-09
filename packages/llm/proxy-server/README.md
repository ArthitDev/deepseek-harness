---
description: "Operator controls and lifecycle ownership for embedded model proxies."
kind: "package-reference"
---

# @deepseek-ai/dsh-proxy-server

English | [中文](README.zh.md)

## Use this package

The `proxyServers` service lists ZCode Direct, Antigravity, and SB transport. Reading status probes only their loopback endpoints and never starts a process. `setEnabled` persists one usage preference before starting or stopping that proxy. A failed start retains the saved preference and returns an error; it does not report a running process. Disabling blocks new requests on the configured routes. In-flight requests are not cancelled.

Only children started by this service are stopped, through their live process handles. External listeners remain running, including after disabling usage. Disabling waits for active downstream streams to settle before stopping a child; it saves the preference without waiting for those streams. Operations serialize per proxy; Host disposal stops and awaits its managed children. Opening the settings page does not start proxies. All three usage preferences default to enabled to preserve existing routing; a proxy starts on a matching model request or an explicit switch-on action. Liveshare viewers cannot read or control this Host-wide service.

## Configuration

The volatile `zcodeEnabled`, `antigravityEnabled`, and `sbEnabled` fields hold independent preferences. Ports default to `ZCODE_PORT` or 18080, `ANTIGRAVITY_PORT` or 18877, and `SB_PORT` or 18899. `startupTimeoutMs` defaults to 15000. Provider lists default to `zcode-direct`, `antigravity`, and `sb`/`sb-proxy`, respectively. Matching model prefixes `zcode/`, `antigravity/`, and `sb/` also select the corresponding proxy. Other model routes delegate unchanged.

ZCode requires Bun, its prepared worker bundle, and an existing `config.yaml` under `ZCODE_DIR` or `third-party/zcode-api`. Antigravity and SB use their bundled Node scripts. This service neither creates credentials nor performs login, OAuth setup, or upstream model requests. Settings failures and missing setup are reported to the operator.

## Model Experience

This plugin adds no tools, prompts, tokens, or KV-cache content. Its stream listener starts a matching enabled proxy before dispatch and returns a terminal model-request failure when usage is disabled or startup fails. Status probes make no billed model calls.

## Known Limitations and Deferred Work

- Configured provider ids and model prefixes identify routes; arbitrary provider base URLs are not inspected.
- ZCode readiness uses HTTP 200/401 from `/v1/models` only for a child started by this Host. An unowned ZCode listener is reported as `port-in-use` and is never reused or stopped because this checkout has no unique ZCode health endpoint.
- Proxy configuration and authentication must already exist. A missing ZCode checkout cannot be installed from this page.
- Changes through generic plugin configuration affect subsequent request routing; use `setEnabled` to also stop a managed process immediately.
- Managed launch paths are checkout-relative; packaged installations need their proxy scripts supplied at the installation root.
