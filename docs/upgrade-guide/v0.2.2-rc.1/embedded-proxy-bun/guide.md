---
kind: upgrade-guide
description: "Embedded Antigravity and SB proxies require Bun instead of the Host Node.js executable."
---

# Embedded proxies require Bun

English | [中文](guide.zh.md)

## Change

Antigravity and SB transport previously ran with Node.js. Their managed processes, shared startup helpers, and newly generated Antigravity autostart launchers now use Bun. ZCode already uses Bun; the Harness Host continues to use Node.js. New Bun launches use `--no-env-file`, so proxy environment values still come from the Host rather than additional `.env` files.

## Migration

1. Install Bun on the machine running the Harness and make `bun --version` succeed for its service account.
2. Restart the Harness after its build. Existing external proxy processes are reused until their owners stop them; the Harness never terminates an external listener.
3. If you previously installed Antigravity autostart, rerun `node packages/experimental/pi-tui/tools/antigravity-proxy/setup.mjs --no-browser` to regenerate the launcher. This command starts the proxy; when authentication is needed, it prints the sign-in URL without opening a browser. Preserve the existing token file.
4. Verify the proxy in **Settings → Proxy Server** and confirm that a newly started Antigravity or SB process uses Bun. Existing ports, provider ids, and credentials do not change.
