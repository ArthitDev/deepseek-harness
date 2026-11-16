---
kind: upgrade-guide
description: Embedded proxy lifecycle selection now requires an explicit provider id instead of a model prefix.
---

# Embedded proxy provider selection

English | [中文](guide.zh.md)

## Change

Embedded proxy startup and usage switches match only the configured provider lists. A model prefix such as `zcode/` or `sb/` no longer starts or blocks a local proxy for an unrelated router provider. The TUI's legacy ZCode startup helper also matches only `zcode-direct` and defers to the installed proxy manager. SB transport routing with `routeAllModels: true` still covers every model provider.

## Migration

1. Keep providers targeting 9router out of `zcodeProviders` and `sbProviders` in the `proxy-servers` configuration.
2. For custom providers targeting an embedded proxy directly, add their provider id to that proxy's provider list. The built-in `zcode-direct` provider already matches; its endpoint is `http://127.0.0.1:18080/v1`. Keep `zcodePort` aligned with that endpoint rather than 9router's port.
3. Confirm a router model remains usable when the unrelated local proxy is disabled, while a disabled direct provider returns `proxy-server/disabled`.
4. If setup previously imported `ZCODE_PROXY_API_KEY` from the shell, set `auth.proxyApiKey` in the backend's `config.yaml` to the intended key and rerun `pnpm zcode:setup`. Setup now imports that file's key, matching the managed backend's scrubbed environment.
