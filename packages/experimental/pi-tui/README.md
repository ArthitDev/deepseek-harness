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

Startup waits for the preset registry and model defaults before creating a session; missing services prevent TUI activation. Sessions use the preset bound to the selected provider and model in the shared Web settings, or the configured default when unbound. `--preset <id>` takes precedence; resumed sessions retain their recorded preset.

`/new` keeps the most recently selected provider, model, and mounted preset.

Switching `/preset`, or selecting a model bound to a different preset, opens a new session with conversation history, tool results, and compacted checkpoints. The copied log resets system messages and removes developer and injected user instructions from model history; the original session remains unchanged. The next request assembles the new preset's system prompt and loads current supplemental context. Deployment skill hooks must be installed in the TUI profile as well as Web; unchanged skills are reused from active history. Preset switches are refused while work is running. Prior answers and checkpoint summaries can still influence later responses.

Press Ctrl+X or run `/thinking` to open a numbered reasoning-level list with descriptions. The picker focuses the current effort or configured default and marks both when available. Use ↑/↓ or a number to choose a row, Enter to apply it from the next step, and Esc to cancel. It offers only the selected model's advertised levels; binary controls describe enabling or disabling thinking. `/thinking <level>` remains available for direct selection. Confirmed selections persist through the shared model defaults. Cancelling the picker during a running turn leaves that turn running.

The status bar shows `N agents` for active subagent runs under the visible session, including nested descendants. The count follows start/end events, updates across session switches, and hides at zero.

The model icon remains a static robot while working. Background-job and subagent activity icons animate while their work is active, even without new stream events. The status animation stops when those activities are idle or when the TUI is disposed. Session titles are omitted from the status bar.

The chat's working indicator is a red scanner that sweeps back and forth every 80 ms, with an elapsed-time label that advances while waiting for the LLM. It stops when the turn ends or the TUI is disposed.

Reasoning appears under an arrow-marked Thinking header from the first delta, with muted, indented streaming text. Click its header to fold one section or press Ctrl+T to fold or expand all sections, including during streaming. Sections open while streaming and fold when sealed by default; an explicit expansion choice takes precedence.

Live text and reasoning deltas are retained immediately, with UI updates coalesced over 16 ms to match the renderer's cadence. Stream end and durable events flush pending updates immediately; session switches and disposal cancel them. Non-text chunks do not trigger transcript updates. Display pacing still depends on when the provider delivers chunks.

Answers and expanded reasoning render Markdown during streaming and after completion. The renderer handles incomplete code fences and caches unchanged bodies; the committed assistant message replaces the preview without adding a duplicate. Find highlights use source text and restore Markdown when cleared. Incomplete formatting and growing table columns can still change layout as more text arrives.

Code fences use highlight.js grammars, including C/C++, C#, Java, PowerShell, HTML/CSS, PHP, Ruby, Swift, and Kotlin. The fence's language name or alias selects the grammar; multiline comments and strings retain their token state across the block. Coloring preserves source characters, blank lines, and line counts while streaming. Missing or unknown language names render plain without automatic language detection.

The TUI reads preset overrides from the Web profile's patch when selecting a model or creating a session, so Web binding edits also apply here. The banner and status bar show the mounted preset; a missing preset refuses creation instead of starting without its composition.

The TUI reads its saved Suppress built-in prompt sections setting at startup and before each prompt assembly, falling back to Web when no TUI override exists. When enabled, the provider receives only preset contributions in the system prompt: global guidance and mode policy are withheld, as are workspace instructions, runtime context, Jev-first context, and text-only developer messages. Original messages remain in the durable log. Changes apply to the next request, including resumed sessions.

`/suppress-prompt` (alias `/suppress-promot`) opens a numbered ON/OFF picker, focused on and marking the current state. Use ↑/↓ or a number to select, Enter to save, and Esc to cancel without writing or interrupting a running turn. `on`, `off`, and `toggle` remain available for direct changes; `status` displays the current state without writing. The command saves the TUI profile through Harness settings, preserves other settings, and leaves the Web profile unchanged. The saved TUI override survives restart, new sessions, and preset changes. Failed writes show an error.

When the switch is off, workspace instructions, runtime context, Jev-first context, and the selected team prompt are available from the first conversation turn, matching Web. Both surfaces use the Harness prompt registry and provider adapter; Pi TUI adds no coding-agent persona. Web's GUI-specific prompt sections remain exclusive to Web. Providers supporting in-history system updates receive the current prompt consolidated at the head, replacing prior preset and team policy while preserving the durable log.

`/team-mode` opens a numbered Blue, Red, Black, or Dead picker with arrow keys, number selection, Enter to save, and Esc to cancel. Direct mode names and `status` are also accepted. The selected icon and name appear in the status bar. TUI saves its mode independently of Web; without a TUI selection it uses the saved Web mode. Team prompt text follows saved Web settings, falling back to the shipped TUI defaults. Changes apply to the next request and survive restart and new sessions. Suppress ON withholds the team prompt without changing the selected mode; the command reports that state. Failed saves preserve the prior selection.

An unspecified TUI default effort uses the saved Web effort when the provider and model match. Explicit TUI model and effort defaults retain precedence. Resuming a session restores explicitly selected effort from its request header; adapter-default effort remains a provider default instead of becoming a user choice.

The `/preset` and `--preset` pickers hide system presets and list healthy user presets. System presets remain available to model bindings and resumed sessions.

## Commands

`/exit`, `/new`, `/fork`, `/resume`, `/tree`, `/agents`, `/jobs`, `/model`, `/preset`, `/thinking`, `/team-mode`, `/suppress-prompt`, `/skills`, `/runs`, `/recon`, `/machines`, `/key`, `/provider`, `/providers`, `/memory`, `/sessions`, `/rewind`, `/clear`, `/queue`, `/export`, `/rename`, `/copy`, `/retry`, `/expand-all`, `/hotkeys`, plus the official dsh slash commands (`/compact`, `/goal`, `/plan`, `/feedback`).

`/exit` closes the TUI. After restoring the terminal screen and disposing the app, it prints the full current session id and `dsh tui --resume <id>` when the session has durable events. Ctrl+D and the Ctrl+C exit gesture show the same hint. Empty sessions do not advertise unsaved history. Resume hints use the visible session after new, fork, resume, or preset switches.

`/providers` lists registered routes, model counts, the current route, and credential configuration state. It describes each credential reference individually without resolving or displaying its value. Failed credential-status reads display `key status unavailable`; command failures appear as notices in the TUI. Local async commands return their promises to the dispatcher so errors cannot escape as detached rejections.

`/clear` removes conversation text, thinking, tool cards, and old UI notices immediately, retaining the welcome banner and one cleared notice. The session id and durable history remain available for resume. `/clear` and `/rewind` markers remain in the log for UI replay but never become model input, regardless of the Suppress switch; this also applies to markers in restored sessions and compaction input.

UI-only command output and failed-attempt previews clear even when there are no conversation messages in the model context. The clear range comes from active session surface nodes, including injected user context that has no transcript bubble. A UI-only clear keeps system messages and appends no session-edit marker. Clear-marker replay also removes attempt text and turn notices between the replaced range and the marker.

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
