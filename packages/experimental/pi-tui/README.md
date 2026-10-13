---
description: "Shield Break TUI: pi-tui interactive terminal front door for Shield Break Harness agents, for users who live in the terminal and want light, durable sessions"
kind: "package-bundle"
---

# pi-tui

English | [中文](README.zh.md)

## Summary

`dsh-pi-tui` is the Shield Break Harness terminal front door: a full-screen TUI over the Web profile's agent runtime. Sessions persist in the shared `~/.dsh/sessions` store, so a session started here reopens in the Web GUI and vice versa. The TUI renders streaming Markdown, collapsible thinking, and tool cards, and mounts agent presets, the pentest control plane (`/runs`, `/recon`), and saved SSH machines (`/machines`) in-process. Boot it with `dsh tui` — a source checkout runs `tools/antigravity-proxy/setup.mjs` first, which creates the `tui` profile. Flags `--resume`, `--preset`, `--machine` select session, preset, and execution target. Requires an interactive terminal.

## Table of Contents

- [Use this package](#use-this-package)
- [Commands](#commands)
- [Dev Note](#dev-note)

-----



<a id="use-this-package"></a>

## Use this package

The plugin ships as a bundle row for the `tui` profile: install it once with `dsh plugin --profile tui add <this package>`, then boot `dsh tui`. `--machine <id>` opens the session with its working directory inside the machine's remote-execution namespace, so shell and file tools run over SSH on that saved machine.

New sessions, including `/new`, use the preset bound to the selected provider and model in the shared Web settings, or the configured default when unbound. `--preset <id>` takes precedence; resumed sessions retain their recorded preset.

`/new` keeps the most recently selected provider and model.

The status bar shows `N agents` for active subagent runs under the visible session, including nested descendants. The count follows start/end events, updates across session switches, and hides at zero.

The model icon remains a static robot while working. Background-job and subagent activity icons animate while their work is active, even without new stream events. The status animation stops when those activities are idle or when the TUI is disposed. Session titles are omitted from the status bar.

The chat's working indicator is a red scanner that sweeps back and forth every 80 ms, with an elapsed-time label that advances while waiting for the LLM. It stops when the turn ends or the TUI is disposed.

Reasoning appears under an arrow-marked Thinking header from the first delta, with muted, indented streaming text. Click its header to fold one section or press Ctrl+T to fold or expand all sections, including during streaming. Sections open while streaming and fold when sealed by default; an explicit expansion choice takes precedence.

Live text and reasoning deltas are retained immediately, with UI updates coalesced over 16 ms to match the renderer's cadence. Stream end and durable events flush pending updates immediately; session switches and disposal cancel them. Non-text chunks do not trigger transcript updates. Display pacing still depends on when the provider delivers chunks.

Answers and expanded reasoning render Markdown during streaming and after completion. The renderer handles incomplete code fences and caches unchanged bodies; the committed assistant message replaces the preview without adding a duplicate. Find highlights use source text and restore Markdown when cleared. Incomplete formatting and growing table columns can still change layout as more text arrives.

The TUI reads preset overrides from the Web profile's patch when selecting a model or creating a session, so Web binding edits also apply here. The banner and status bar show the mounted preset; a missing preset refuses creation instead of starting without its composition.

The Web's Suppress built-in prompt sections switch also applies to the TUI. The TUI reads the saved switch at startup and before each prompt assembly. When enabled, the provider receives only preset contributions in the system prompt: global guidance and mode policy are withheld, as are workspace instructions, runtime context, Jev-first context, and text-only developer messages such as `/clear` and `/rewind` markers. Original messages remain in the durable log. Changes apply to the next request, including resumed sessions. When the Web has no saved switch, the TUI uses its own setting; this synchronization does not edit either profile file.

When the switch is off, workspace instructions, runtime context, and Jev-first context begin on the second conversation turn. The entire first turn, including subsequent steps, retains the preset prompt and user input without these contexts. Resuming an existing conversation retains its turn count. Deferral changes when the context arrives; it does not prevent the context from influencing later answers.

The `/preset` and `--preset` pickers hide system presets and list healthy user presets. System presets remain available to model bindings and resumed sessions.

## Commands

`/new`, `/fork`, `/resume`, `/tree`, `/agents`, `/jobs`, `/model`, `/preset`, `/thinking`, `/skills`, `/runs`, `/recon`, `/machines`, `/key`, `/provider`, `/providers`, `/memory`, `/sessions`, `/rewind`, `/clear`, `/queue`, `/export`, `/rename`, `/copy`, `/retry`, `/expand-all`, `/hotkeys` — plus the official dsh slash commands (`/compact`, `/goal`, `/plan`, `/feedback`).

`/clear` removes conversation text, thinking, tool cards, and old UI notices immediately, retaining the welcome banner and one cleared notice. The session id and durable history remain available for resume.

<a id="connect-antigravity"></a>

## Connect Antigravity

The TUI ships its own Antigravity proxy (zero dependencies, in this repo), so a fresh clone needs no other download and no Antigravity CLI — just a Google account. One command:

```
node packages/experimental/pi-tui/tools/antigravity-proxy/setup.mjs
```

The script creates the `tui` profile when absent, installs a silent autostart launcher, starts the endpoint, and opens the Google sign-in in the browser once; rotated tokens persist in the proxy's own state file and refresh on their own afterwards. The Antigravity provider is already part of the TUI bundle, so `dsh tui` → `/model` lists its Gemini models with no `/provider` step (from a source checkout, boot with `node --import tsx/esm apps/cli/src/bin.ts tui`). Antigravity quota and Google ToS apply. Re-run the script (or open `http://127.0.0.1:8877/auth/login`) if sign-in ever expires.

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
