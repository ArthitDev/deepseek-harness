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
- [Local MCP, skills, and plugins](#local-mcp-skills-and-plugins)
- [Commands](#commands)
- [Dev Note](#dev-note)

-----



<a id="use-this-package"></a>

## Use this package

The plugin ships as a bundle row for the `tui` profile: install it once with `dsh plugin --profile tui add <this package>`, then boot `dsh tui`. `--machine <id>` opens the session with its working directory inside the machine's remote-execution namespace, so shell and file tools run over SSH on that saved machine.

Startup waits for the preset registry and model defaults before creating a session; missing services prevent TUI activation. Sessions use the preset bound to the selected provider and model in the shared Web settings, or the configured default when unbound. `--preset <id>` takes precedence; resumed sessions retain their recorded preset.

<a id="local-mcp-skills-and-plugins"></a>

## Local MCP, skills, and plugins

This deployment is not portable by copying only `dsh-pi-tui`. Its effective composition combines the package bundle, `~/.dsh/cordis.patch.yml`, and `~/.dsh/profiles/tui/cordis.patch.yml`. Move or restore those layers with the referenced local files and rebuild the checkout before starting TUI. The failure labels below distinguish `Blocked` (TUI never activates), `Turn-fatal` (TUI opens but model turns fail), and `Degraded` (TUI opens without that integration).

| Area | Required rows and local assets | Result when missing or invalid |
|---|---|---|
| TUI startup | The base and TUI bundles must supply `agents`, `cmdlineArgs`, `workspaceRegistry`, `loader`, `profileContext`, `pentestModePolicy`, `systemPrompt`, `agentPresets`, and `agentDefaultModel`. | **Blocked.** The `pi-tui` plugin remains pending and never opens the terminal UI. |
| Skills | Base rows `skill`, `skill-filesystem`, and `tool-skill`; TUI row `global-default-skills`; `C:\Users\EPIT-Dev\.dsh\global-skills.mjs`. Discovery reads harness-owned roots only — `~/.dsh/skills`, `<projectRoot>/.dsh/skills`, and `customSkillDirs`; shared cross-harness directories are never scanned. The catalog currently holds 133 skills, including the `losthex-*` family and `apk-reverse`. | Missing base services removes the skill catalog and invocation path. A missing local plugin or individual default skill is **Degraded** because the hook or that skill is skipped. |
| Jev-first policy | Global row `jev-first-action-policy`; `C:\Users\EPIT-Dev\.dsh\jev-first.mjs`; `C:\Users\EPIT-Dev\.agent-rules\JEV-FIRST.md`. `global-skills.mjs` also imports this plugin. | A loaded plugin with a missing policy file is **Turn-fatal** because each pre-step read rejects. A plugin file that cannot load is **Degraded** and removes the policy. |
| Kali execution policy | Global row `kali-exec-policy`; `C:\Users\EPIT-Dev\.dsh\kali-exec.mjs`; the `kali-linux` WSL distro with the Kali package set (nmap, sqlmap, hydra, john, hashcat, impacket) reachable through `wsl -d kali-linux -- bash -lc`. | A missing distro or package fails those commands per call while the policy text still loads; only an unloadable plugin file is **Degraded**. |
| Jev MCP | Global row `mcp-jev`; `C:\Users\EPIT-Dev\.local\bin\jev-mcp-launcher.mjs`; Node 22 or newer; `C:\Users\EPIT-Dev\.config\typesafe\key`; the launcher's pinned `@jkudish/jev-mcp` package. | **Degraded.** `failOnStartupError: false` keeps TUI running, while `/jev status` reports no available tools and the status bar shows `Jev unavailable`. |
| REA MCP | Global row `mcp-rea` (insert); `C:\Users\EPIT-Dev\AppData\Roaming\npm\node_modules\rea-agents\scripts\rea.mjs` through `C:\nvm4w\nodejs\node.exe`. | **Degraded.** `failOnStartupError: false` keeps TUI running without REA; a healthy startup exposes about 170 `mcp__rea__*` tools. |
| IDA MCP | Global row `mcp-ida` (streamable HTTP `http://127.0.0.1:13337/mcp`); IDA running with the `ida-pro-mcp` plugin (the `ida-pro-mcp` dotnet tool). | **Degraded.** The endpoint exists only while IDA runs; the client reconnects on its own when IDA appears. |
| x64dbg MCP | Global row `mcp-x64dbg` (stdio); `C:\Users\EPIT-Dev\.dsh\mcp\x64dbg-mcp.py` on Python 3.13 with `mcp` and `requests`; the x64dbg plugin's HTTP server on `127.0.0.1:8888`. | **Degraded.** The bridge starts without x64dbg and its tools fail per call until the plugin's HTTP server is up. |
| Cyber Wiki | Override the existing host row `tool-fs-search` with the `cyber` knowledge root at `C:\Users\EPIT-Dev\.dsh\cyber-wiki`; keep its `INDEX.md` valid. | **Degraded.** An invalid root rejects that plugin. Never insert a second host `tool-fs-search` row because both instances register `knowledge_list` and one activation fails with `tool "knowledge_list" is already registered`. |
| Orca hooks | Global row `orca-agent-hooks` and `C:\Users\EPIT-Dev\.orca\agent-hooks\dsh-hooks.json`. | **Degraded.** Orca hook integration is unavailable; it is not a TUI startup service. |

`global-skills.mjs`, `jev-first.mjs`, and `kali-exec.mjs` import built modules through absolute `file:///E:/Cybersecure-Pentest/deepseek-harness/.../lib/index.js` URLs. Moving the checkout without updating those URLs, or cleaning `lib` without rebuilding, prevents the local plugins from activating.

After a move or rebuild, inspect the composed profile before opening TUI:

```text
dsh --profile tui --dump-config
```

The output must contain `pi-tui`, `global-default-skills`, `jev-first-action-policy`, `kali-exec-policy`, `mcp-rea`, `mcp-jev`, `mcp-ida`, `mcp-x64dbg`, and the single overridden `tool-fs-search` row. After TUI opens, run the following checks; `/mcp status` must list `rea` and `jev` with positive tool counts while `ida` and `x64dbg` join when their host applications run, and a working Wiki picker confirms that the optional integrations loaded.

```text
/mcp status
/skills status
/jev status
/wiki
```

`/new` keeps the most recently selected provider, model, and mounted preset.

Switching `/preset`, or selecting a model bound to a different preset, opens a new session with conversation history, tool results, and compacted checkpoints. The copied log resets system messages and removes developer and injected user instructions from model history; the original session remains unchanged. The next request assembles the new preset's system prompt and loads current supplemental context. Deployment skill hooks must be installed in the TUI profile as well as Web; unchanged skills are reused from active history. Preset switches are refused while work is running. Prior answers and checkpoint summaries can still influence later responses.

Press Ctrl+X or run `/thinking` to open a numbered reasoning-level list with descriptions. The picker focuses the current effort or configured default and marks both when available. Use ↑/↓ or a number to choose a row, Enter to apply it from the next step, and Esc to cancel. It offers only the selected model's advertised levels; binary controls describe enabling or disabling thinking. `/thinking <level>` remains available for direct selection. Confirmed selections persist through the shared model defaults. Cancelling the picker during a running turn leaves that turn running.

The status bar shows `N agents` for active subagent runs under the visible session, including nested descendants. The count follows start/end events, updates across session switches, and hides at zero.

The status bar shows `📚 Wiki` when `knowledge_list` is available to the current agent and hides it when disabled or explicitly denied. The indicator follows session changes and tool reloads, independently of built-in prompt suppression. The Wiki plugin supplies the same short operational context in Web and TUI without changing preset system text.

The status bar also shows `Jev ON`, `Jev OFF`, or `Jev unavailable`. Successful direct `mcp__jev__*` calls add their provider-reported `usage.cost` to the visible session total. This is observed spend, not the account's remaining credit; the configured Jev MCP exposes no balance tool. The indicator never makes a request by itself.

The model icon remains a static robot while working. Background-job and subagent activity icons animate while their work is active, even without new stream events. The status animation stops when those activities are idle or when the TUI is disposed. Session titles are omitted from the status bar.

The chat's working indicator is a red scanner that sweeps back and forth every 80 ms, with an elapsed-time label that advances while waiting for the LLM. It stops when the turn ends or the TUI is disposed.

Reasoning appears under an arrow-marked Thinking header from the first delta, with muted, indented streaming text. Click its header to fold one section or press Ctrl+T to fold or expand all sections, including during streaming. Sections open while streaming and fold when sealed by default; an explicit expansion choice takes precedence.

Live text and reasoning deltas are retained immediately, with UI updates coalesced over 16 ms to match the renderer's cadence. Stream end and durable events flush pending updates immediately; session switches and disposal cancel them. Non-text chunks do not trigger transcript updates. Display pacing still depends on when the provider delivers chunks.

Answers and expanded reasoning render Markdown during streaming and after completion. The renderer handles incomplete code fences and caches unchanged bodies; the committed assistant message replaces the preview without adding a duplicate. Find highlights use source text and restore Markdown when cleared. Incomplete formatting and growing table columns can still change layout as more text arrives.

Code fences use highlight.js grammars, including C/C++, C#, Java, PowerShell, HTML/CSS, PHP, Ruby, Swift, and Kotlin. The fence's language name or alias selects the grammar; multiline comments and strings retain their token state across the block. Coloring preserves source characters, blank lines, and line counts while streaming. Missing or unknown language names render plain without automatic language detection.

The TUI reads preset overrides from the Web profile's patch when selecting a model or creating a session, so Web binding edits also apply here. The banner and status bar show the mounted preset; a missing preset refuses creation instead of starting without its composition.

The TUI reads its saved Suppress built-in prompt sections setting at startup and before each prompt assembly, falling back to Web when no TUI override exists. When enabled, the provider receives only preset contributions in the system prompt: global guidance and mode policy are withheld, as are workspace instructions, runtime context, Jev-first context, and text-only developer messages. Original messages remain in the durable log. Changes apply to the next request, including resumed sessions.

`/suppress-prompt` (alias `/suppress-promot`) opens a numbered ON/OFF picker, focused on and marking the current state. Use ↑/↓ or a number to select, Enter to save, and Esc to cancel without writing or interrupting a running turn. `on`, `off`, and `toggle` remain available for direct changes; `status` displays the current state without writing. The command saves the TUI profile through Harness settings, preserves other settings, and leaves the Web profile unchanged. The saved TUI override survives restart, new sessions, and preset changes. Failed writes show an error.

`/mcp` opens a searchable MCP server list; selecting a server toggles all of its tools. `/mcp on|off|toggle|status` controls all MCP tools for the current TUI process. A disabled server or global OFF state removes the affected `mcp__*` tools from subsequent model requests and denies stale calls. The selections follow session switches but reset when the TUI restarts. Changing them while a turn is running is refused.

`/jev [on|off|toggle|status]` controls the Jev-first policy context and open-dev-browser MCP tools for the current TUI process. OFF removes both from subsequent model requests and denies stale JEV calls; ON restores them unless the global MCP or skills switch also hides them. Both hyphenated and normalized underscore server namespaces are recognized. The state follows session switches but resets when the TUI restarts. Changing it while a turn is running is refused.

`/skills` opens a searchable skill list; selecting a skill toggles its catalog entry, direct `/name` instruction injection, model tool calls, and autocomplete entry. `/skills on|off|toggle|status` controls all skills for the current TUI process. Global OFF also removes the `skill` tool from subsequent model requests. The selections follow session switches but reset when the TUI restarts. Changing them while a turn is running is refused.

When the switch is off, workspace instructions, runtime context, Jev-first context, and the selected team prompt are available from the first conversation turn, matching Web. Both surfaces use the Harness prompt registry and provider adapter; Pi TUI adds no coding-agent persona. Web's GUI-specific prompt sections remain exclusive to Web. Providers supporting in-history system updates receive the current prompt consolidated at the head, replacing prior preset and team policy while preserving the durable log.

`/team-mode` opens a numbered Blue, Red, Black, or Dead picker with arrow keys, number selection, Enter to save, and Esc to cancel. Direct mode names and `status` are also accepted. The selected icon and name appear in the status bar. TUI saves its mode independently of Web; without a TUI selection it uses the saved Web mode. Team prompt text follows saved Web settings, falling back to the shipped TUI defaults. Changes apply to the next request and survive restart and new sessions. Suppress ON withholds the team prompt without changing the selected mode; the command reports that state. Failed saves preserve the prior selection.

An unspecified TUI default effort uses the saved Web effort when the provider and model match. Explicit TUI model and effort defaults retain precedence. Resuming a session restores explicitly selected effort from its request header; adapter-default effort remains a provider default instead of becoming a user choice.

The `/preset` and `--preset` pickers hide system presets and list healthy user presets. System presets remain available to model bindings and resumed sessions.

## Commands

`/exit`, `/new`, `/fork`, `/resume`, `/tree`, `/agents`, `/jobs`, `/model`, `/preset`, `/thinking`, `/team-mode`, `/suppress-prompt`, `/mcp`, `/jev`, `/skills`, `/wiki`, `/runs`, `/recon`, `/machines`, `/key`, `/provider`, `/providers`, `/memory`, `/sessions`, `/rewind`, `/clear`, `/queue`, `/export`, `/rename`, `/copy`, `/retry`, `/expand-all`, `/hotkeys`, plus the official dsh slash commands (`/compact`, `/goal`, `/plan`, `/feedback`).

`/wiki` opens a numbered picker for libraries exposed by the current preset's `knowledge_list` tool. Select a library to view its `INDEX.md` titles and links in the transcript, open that index in Obsidian, or open its configured folder in the file manager. Arrow keys or numbers select, Enter confirms, and Esc cancels. Obsidian must be installed with its `obsidian://` handler registered, and the Wiki folder must already be an Obsidian vault. Missing libraries and open failures appear as TUI notices. The menu sends no model request, adds no session events, and does not change prompts or Wiki files.

`/exit` closes the TUI. After restoring the terminal screen and disposing the app, it prints the full current session id and `dsh tui --resume <id>` when the session has durable events. Ctrl+D and the Ctrl+C exit gesture show the same hint. Empty sessions do not advertise unsaved history; a session created and abandoned without user content is also discarded from the session store on switch and quit, so boot churn leaves no shells. Resume hints use the visible session after new, fork, resume, or preset switches.

`/providers` lists registered routes, model counts, the current route, and credential configuration state. It describes each credential reference individually without resolving or displaying its value. Failed credential-status reads display `key status unavailable`; command failures appear as notices in the TUI. Local async commands return their promises to the dispatcher so errors cannot escape as detached rejections.

`/model` displays model and provider names from the same LLM catalog Web uses. Each row also shows its provider/model id for search and identification; selection still sends those exact ids. Direct `/model <query>` accepts a catalog display name as well as ids. Both surfaces read their active profile configuration, so profile overrides or a process that has not reloaded a change can still produce different lists.

Switching models retains the previous reasoning effort only when the destination model advertises that level. Otherwise the selection uses the destination provider's default, without forcing thinking off. The resolved effort is validated before the selection is saved; the status bar does not carry the previous model's effort into the new route. A model with no advertised effort metadata can still reason according to its provider default, but TUI cannot offer explicit effort controls for it.

Before each request, TUI also checks effort values restored from saved defaults, resumed history, or session switches. A value no longer advertised by that exact model is removed from the request and the live selection, with a UI notice; the request then uses the provider default. Historical headers and saved configuration remain unchanged. Lookup failures still fail the request instead of guessing capabilities.

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
