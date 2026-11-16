---
kind: upgrade-guide
description: Harness removes its embedded Antigravity provider and proxy configuration.
---

# Antigravity removal

English | [中文](guide.zh.md)

## Change

Harness no longer includes or manages its embedded Antigravity provider and proxy. The `proxy-servers` configuration no longer accepts `antigravityEnabled`, `antigravityPort`, `antigravityProviders`, or `antigravity` in `externalProxies`. The optional OAR provider rejects `runtime: antigravity`; remove any such provider row and its tool mapping. Existing external applications, including CLIProxyAPI, and their processes and credentials remain outside Harness management.

## Migration

1. On each machine that has used the embedded integration, run `pnpm antigravity:remove --dry-run` from the Harness checkout to preview the YAML changes.
2. Run `pnpm antigravity:remove` before restarting Harness. It backs up and atomically updates the Harness home patch and installed profile patches, removing Antigravity provider/model mappings and obsolete manager configuration while preserving other providers. Keep the private backups for recovery.
3. If the selected model used the removed provider, select another installed provider in Web or TUI. Restart Harness and confirm the new selection works.
4. The command does not stop processes or remove startup entries. If an old Harness-native Antigravity launcher exists, verify its target before removing it manually. Do not remove or stop external CLIProxyAPI or other external applications; account tokens are also left in place.
