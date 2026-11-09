---
description: "Settings page for embedded model proxy status and usage preferences."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-proxy-server

English | [中文](README.zh.md)

## Use this package

**Settings > Proxy Server** shows the embedded proxy roster, loopback endpoints, configured routes, setup availability, and process status. Each shared Switch saves an independent usage preference through the [Host service](../../llm/proxy-server/README.md). Turning it on explicitly starts the proxy; turning it off blocks new matching requests and stops only children owned by this Host. External processes keep running.

Reading the page never starts a proxy. Refresh reloads process status. Pending mutations disable competing controls; failures remain visible with the saved preference. A failed start may therefore show an enabled switch beside a stopped process. Unavailable or read-only settings disable switches.

## Composition

Mount this plugin with `proxyServers`, configuration forms, locale, resources, and the Settings section slot. The roster uses the shared `proxy-servers` resource protocol and generated Remote methods. English and Simplified Chinese copy are provided; other supported locales use English.

## Model Experience

The UI adds no tools, prompts, tokens, or KV-cache content. Explicit operator actions change the Host's proxy usage preferences and process lifecycle. It makes no upstream model calls.

## Known Limitations and Deferred Work

- Process status updates after Refresh, a switch action, or reopening the page; the page does not poll.
- Installation, proxy configuration, and authentication remain outside this page.
