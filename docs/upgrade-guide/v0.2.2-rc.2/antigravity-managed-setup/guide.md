---
kind: upgrade-guide
description: "Antigravity setup migrates existing routes and leaves normal proxy startup to Harness."
---

# Antigravity managed setup

English | [中文](guide.zh.md)

## Change

Antigravity setup no longer creates a TUI profile, installs a Windows Startup launcher, or leaves its own proxy running after login. It signs in with a temporary child, backs up existing configuration, and migrates installed profiles to the bundled backend on port 18877. The native Google model roster replaces the external Antigravity roster. Other providers and another project's CLIProxyAPI process remain unchanged.

## Migration

1. Install the intended Harness profiles and make Bun available on the runtime account's `PATH`.
2. Run `pnpm antigravity:setup` from the checkout root and complete Google sign-in. For a manual browser handoff, add `--no-browser`; setup waits for login instead of leaving a detached process. If login times out, the previous route remains configured.
3. Restart Web/TUI. Confirm Antigravity points to `http://127.0.0.1:18877/v1` and send a short model request. Token presence and a static model list do not verify upstream access.
4. If an old Startup launcher is installed, remove only that native Antigravity launcher's shortcut after confirming its target. The setup command does not remove or stop external applications.
5. To undo configuration changes, stop Harness and restore patches using the printed backup directory's `manifest.json`. See the [proxy setup reference](../../../../packages/llm/proxy-server/README.md#set-up-and-use-the-bundled-proxies) for account, model, routing, and rollback details.
