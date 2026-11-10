---
description: "Settings page for embedded model proxy status and usage preferences."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-proxy-server

English | [中文](README.zh.md)

## Summary

Check embedded proxy endpoints, setup availability, and process status in Settings. Enable a proxy to start it, or disable its use for new matching requests. Disabling stops only children owned by this Host; external processes remain running. Failed starts keep the saved preference and display the error.

## Table of Contents

- [Use this package](#use-this-package)
- [Composition](#composition)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

**Settings > Proxy Server** shows the embedded proxy roster, loopback endpoints, configured routes, setup availability, and process status. Each shared Switch saves an independent usage preference through the [Host service](../../llm/proxy-server/README.md). Turning it on explicitly starts the proxy; turning it off blocks new matching requests and stops only children owned by this Host. External processes keep running.

Reading the page never starts a proxy. Refresh reloads process status. Pending mutations disable competing controls; failures remain visible with the saved preference. A failed start may therefore show an enabled switch beside a stopped process. Unavailable or read-only settings disable switches.

<a id="composition"></a>
## Composition

<details>
<summary>Client integration details</summary>

Mount this plugin with `proxyServers`, configuration forms, locale, resources, and the Settings section slot. The roster uses the shared `proxy-servers` resource protocol and generated Remote methods. English and Simplified Chinese copy are provided; other supported locales use English.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Host service](../../llm/proxy-server/README.md): usage preferences and process ownership.
- [Client integration](src/client/index.ts): Settings registration and Remote calls.
- [Host implementation](../../llm/proxy-server/src/index.ts): route matching and proxy startup.

<a id="model-experience"></a>
## Model Experience

### Proxy preferences

#### What the model sees

The UI adds no tools, prompts, or model-visible context. Explicit operator actions call `proxyServers` to change the Host's proxy usage preferences and process lifecycle.

#### Token effect

Reading status and changing preferences add no model-input tokens. The UI makes no upstream model calls.

#### KV Cache effect

The UI adds no cache content and does not rewrite model-request prefixes. Cache behavior for subsequent model requests belongs to their provider and proxy.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Process status updates after Refresh, a switch action, or reopening the page; the page does not poll.
- Installation, proxy configuration, and authentication remain outside this page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
