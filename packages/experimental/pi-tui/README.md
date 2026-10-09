---
description: "Shield Break TUI: pi-tui interactive terminal front door for Shield Break Harness agents, for users who live in the terminal and want light, durable sessions"
kind: "package-bundle"
---

# pi-tui

English | [中文](README.zh.md)

## Summary

`dsh-pi-tui` is the Shield Break Harness terminal front door: a full-screen interactive TUI over the same agent runtime the Web profile drives. Sessions persist in the shared `~/.dsh/sessions` store, so a session started here reopens in the Web GUI and vice versa. The TUI renders streaming Markdown, collapsible thinking, and tool cards, and mounts the deployment's agent presets, pentest control plane (`/runs`, `/recon`), and saved SSH machines (`/machines`) in-process. Boot it with `dsh tui`; flags `--resume`, `--preset`, and `--machine` select the session, preset, and remote execution target. It requires an interactive terminal and exits loudly without one.

## Table of Contents

- [Use this package](#use-this-package)
- [Commands](#commands)
- [Dev Note](#dev-note)

-----



<a id="use-this-package"></a>

## Use this package

The plugin ships as a bundle row for the `tui` profile: install it once with `dsh plugin --profile tui add <this package>`, then boot `dsh tui`. `--machine <id>` opens the session with its working directory inside the machine's remote-execution namespace, so shell and file tools run over SSH on that saved machine.

## Commands

`/new`, `/fork`, `/resume`, `/tree`, `/agents`, `/jobs`, `/model`, `/preset`, `/thinking`, `/skills`, `/runs`, `/recon`, `/machines`, `/key`, `/provider`, `/providers`, `/memory`, `/sessions`, `/rewind`, `/clear`, `/queue`, `/export`, `/rename`, `/copy`, `/retry`, `/expand-all`, `/hotkeys` — plus the official dsh slash commands (`/compact`, `/goal`, `/plan`, `/feedback`).

<a id="connect-antigravity"></a>

## Connect Antigravity

The TUI ships its own Antigravity proxy (zero dependencies, in this repo), so a fresh clone needs no other download. Prerequisite: the Antigravity CLI authenticated once (`agy` — it writes the OAuth token the proxy then refreshes on its own). After that, one command:

```
node packages/experimental/pi-tui/tools/antigravity-proxy/setup.mjs
```

The script verifies the token, installs a silent autostart launcher, starts the endpoint, and health-checks it. The Antigravity provider is already part of the TUI bundle, so `dsh tui` → `/model` lists its models (Gemini, Claude) with no `/provider` step. The proxy refreshes its own OAuth token; Antigravity quota and Google ToS apply.

Deployments preferring the external CLIProxyAPI gateway instead: download it, run `cliproxy --antigravity-login` (opens the browser once), register the provider in `/provider` (`name: antigravity`, `endpoint: http://127.0.0.1:8317/v1`, `protocol: openai-completions`, `key: shield-break`), and keep it up at logon with `node tools/antigravity-proxy/install-autostart.mjs` — a home patch naming the `llm-pi-ai` row replaces this bundle's proxy roster by id.

## Dev Note

Adapted from the community `dsh-pi-tui` plugin (MIT, see NOTICE); ported to the 0.1.7-alpha.2 harness APIs and integrated as a workspace package. The terminal-render layer is excluded from the per-file coverage gate the same way as the other GUI-debt surfaces; the pure logic under `src/core` is gated.

## Model Experience

### Bounded pentest conversation

#### What the model sees

The banner and session facts, the folded transcript, tool cards, and the status bar (model, tokens, context bar, git, todos, queue). Withheld built-in prompt sections leave the operator's preset contributions and the `/preset`-switched policy as the system prompt.

#### Token effect

Only session content: the TUI contributes no standing prompt sections of its own, and rewound exchanges stay shadowed in the durable log via `/rewind` and `/clear` markers.

#### KV Cache effect

Rewinds and /clear append surface-replacement markers, so the provider's prompt prefix stays prefix-stable up to the shadow point instead of invalidating the whole conversation.

## Known Limitations and Deferred Work

- Verified against this fork's dsh 0.1.7-alpha.2 APIs; upstream releases move independently and may drift.
- The pentest dashboards (Runs graph, recon reports) stay web-only; /runs and /recon cover the text-level surface.
- Sandbox note: sessions whose workspace is the home directory refuse shell-sandbox temp roots at boot with a banner warning.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Adapted from the community `dsh-pi-tui` plugin (MIT, see NOTICE); ported to this fork's 0.1.7-alpha.2 harness APIs and integrated as a workspace package. The terminal-render layer carries the GUI-debt coverage exclusion; the pure logic under `src/core` is gated at the per-file 100% standard.

</details>
