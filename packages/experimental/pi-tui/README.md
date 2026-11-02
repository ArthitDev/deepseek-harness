---
description: "Shield Break TUI: pi-tui interactive terminal front door for Shield Break Harness agents, for users who live in the terminal and want light, durable sessions"
kind: "package-bundle"
---

# pi-tui

English | [中文](README.zh.md)

## Summary

`dsh-pi-tui` opens a full-screen terminal interface over the Web profile's agent runtime. Sessions persist in `~/.dsh/sessions` and reopen across TUI and Web. It renders streaming Markdown, thinking and tool cards, with agent presets, pentest controls (`/runs`, `/recon`) and saved SSH machines (`/machines`). After installing the `tui` profile, run `dsh tui` in an interactive terminal. Flags `--resume`, `--preset` and `--machine` select the session, preset and execution target. Antigravity requires the separate [setup step](#connect-antigravity).

## Table of Contents

- [Use this package](#use-this-package)
- [Local MCP, skills, and plugins](#local-mcp-skills-and-plugins)
- [Commands](#commands)
- [Dev Note](#dev-note)

-----



<a id="use-this-package"></a>

## Use this package

The plugin ships as a bundle row for the `tui` profile: install it once with `dsh plugin --profile tui add <this package>`, then boot `dsh tui`. A leading positional directory sets the session working directory (`dsh tui .`), overriding the row config, and must exist. `--machine <id>` opens the session with its working directory inside the machine's remote-execution namespace, so shell and file tools run over SSH on that saved machine.

Startup waits for the preset registry and model defaults before creating a session; missing services prevent TUI activation. Sessions use the preset bound to the selected provider and model in the shared Web settings, or the configured default when unbound. `--preset <id>` takes precedence; resumed sessions retain their recorded preset.

The checkout starts transparent SB transport in the background on every interactive launch. The [bundled ZCode proxy](../../../third-party/zcode-api/INTEGRATION.md) starts on the first actual `zcode-direct` or `zcode/glm-5.3[-flash]` request; selecting other providers starts no ZCode helper. Concurrent requests share one startup attempt per TUI process, and a cancelled request stops waiting independently. Startup failures display a notice; `/model` can still select another provider. Healthy services are reused and remain running after TUI closes. Closing TUI cancels pending helpers; help and non-interactive invocations skip startup.

`pnpm zcode:setup` also configures the local `ZCODE_DIRECT_API_KEY` credential without printing it. After ZCode login, select `/model zcode-direct/glm-5.3-flash` or `/model zcode-direct/glm-5.3` to use `ZCode Direct` without 9router or SB. The direct preset defaults to `reasoning: low`; see the [ZCode integration](../../../third-party/zcode-api/INTEGRATION.md) for overrides. The shipped TUI and Web routes advertise 1M context and use port 18080. `ZCODE_PORT` changes both the launcher and direct route when set before harness startup. The bundled Antigravity proxy uses 18877, controlled by `ANTIGRAVITY_PORT`; a generic `PORT` variable does not change it. SB remains on 18899 with `SB_PORT`. System 9router and an external CLIProxyAPI keep their separately configured ports.

For another machine, copy the complete checkout, including `scripts/` and `third-party/`, install Node `^22.19 || >=24`, pnpm and Bun, then run `pnpm install`, `pnpm zcode:setup` and `pnpm build`. Install and configure system 9router separately, register the destination's ZCode endpoint and key, and sign in to ZCode there. The provider path is Harness → 9router → ZCode → provider; optional SB forwarding inserts SB between Harness and 9router. Restore the required local integrations described below separately; copying the npm TUI package alone does not include these checkout-level launchers.

`pnpm sb:start` starts a dependency-free, loopback-only OpenAI transport on `18899`; `sb:status`, `sb:stop` and `sb:restart` manage only its verified identity and recorded process. `sb:install` aliases start and creates no OS startup task. `SB_PORT`, `SB_BACKEND` (default `http://127.0.0.1:20128/v1`), `SB_TIMEOUT_MS` (upstream idle timeout, default 120000), and `DSH_HOME` override deployment settings. `GET /health` identifies the service and configured backend, without checking upstream credentials. Logs are in `<DSH_HOME>/logs/sb-transport-<port>.log`, defaulting to `~/.dsh`. A port occupied by another service produces a startup notice and leaves that listener untouched.

SB forwards `/v1/*`, request bodies, credentials, tools and streaming responses without prompt rewriting, recon, or command execution. It forwards the caller's router credential unless `SB_BACKEND_KEY` explicitly overrides it. Configure the provider's base URL as `http://127.0.0.1:18899/v1` to use this hop; existing direct 9router routes remain direct. Requests are limited to 32 MiB, upstream failures return 502 or 504, and disconnects cancel forwarding. No retry replays a model request. The `Server-Timing` response header measures upstream time until headers arrive, not total model latency. `pnpm sb:test` verifies relocation and transport behavior against a local mock; it does not test a real provider. The legacy `sb-proxy-v6.cjs` pipeline is not started by TUI or the `sb:*` commands. Skills, Wiki and Kali are not required by this transport and remain local integrations.

`/resume` and `--resume` replay the selected session's complete snapshot, including its inherited fork seed, exactly once. Parent session ids record lineage and are not opened to render the transcript. A missing ancestor does not prevent a saved child session from displaying its inherited messages. Replay does not modify session artifacts. Tool results update the first transcript card with a matching call ID; activity state uses the last matching card.

The TUI creates and retains views for only the newest 20 transcript items by default, counting messages, thinking, tools, and notices. Streaming refreshes only retained views and reuses the last session cost total. Agent Debug caches one wrapped row per retained activity while its rendered text and width match; removed activities release their cache. The Targets tree keeps one rendered row set for its current URL snapshot, width, focus, and selection, and releases it when URLs or tree state change. Older items remain in the transcript data for search and export; their views and images load only when revealed. `/expand-all` shows all items, and repeating it restores the limit. Set the `pi-tui` row's `historyLimit` to a positive integer to change the window. The limit does not truncate the session log or the Agent's model context; replay still reads the complete log.

Opening saved conversation history adds a one-line recap; `/recap` displays it again on demand. It quotes the latest human request, assistant reply, and the active checkpoint's current work and next step when available, capped at 400 Unicode code points. Checkpoint information is labeled separately because later messages may have changed it. Recaps read active derived history, so cleared, rewound, and compacted-away messages are excluded. They make no model call, write no session events, and add no model context; no background idle recap is generated.

`/context` opens a read-only view of the latest main-loop request observed in this process, the retained session surface, and queued next-step and next-turn input. Fixed-density estimates, token-meter pressure, provider usage, unknown values, and output reserve are labeled separately; flattened system-section sources and sizes remain unknown. Configured `requiredSections` appear only as registration requirements, not as evidence that a section was sent. The view retains numeric metadata per live Session and never displays prompt text, message content, tool arguments, or credentials. A resumed Session has no last-request capture until a request reaches the model in the current process.

The inherited [automatic compaction backend](../../compaction/compaction-basic/README.md#tuning-when-condensation-starts) controls context independently of the 20-item display window. It is enabled by default, checks token pressure between steps, summarizes older history into a structured checkpoint, and keeps a recent tail verbatim. `/compact` invokes it manually when idle. Its summary records intent, files, fixes, pending work, next steps, and critical context; summarization can still omit details, while the original events remain in the durable log.

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

Click `N agents`, press Ctrl+Alt+G, or run `/agents` to search session-backed descendants, including finished children. Enter opens a read-only transcript while the main agent keeps running; Esc returns without switching or cancelling either agent. The viewer shows the latest `historyLimit` items, initially 20; A reveals older items, arrows and PgUp/PgDn scroll, and Home/End jump. Ctrl+O expands tools and Ctrl+T toggles thinking. Local child messages stream live; saved history is marked `Saved snapshot`, with R to refresh. Providers without readable session history report an error rather than resuming a child.

The status bar shows `📚 Wiki` when `knowledge_list` is available to the current agent and hides it when disabled or explicitly denied. The indicator follows session changes and tool reloads, independently of built-in prompt suppression. The Wiki plugin supplies the same short operational context in Web and TUI without changing preset system text.

The status bar also shows `Jev ON`, `Jev OFF`, or `Jev unavailable`. Successful direct `mcp__jev__*` calls add their provider-reported `usage.cost` to the visible session total. This is observed spend, not the account's remaining credit; the configured Jev MCP exposes no balance tool. The indicator never makes a request by itself.

The model icon remains a static robot while working. Background-job and subagent activity icons animate while their work is active, even without new stream events. The status animation stops when those activities are idle or when the TUI is disposed. Session titles are omitted from the status bar.

The chat's working indicator is a red scanner that sweeps back and forth every 80 ms, with an elapsed-time label that advances while waiting for the LLM. It stops when the turn ends or the TUI is disposed.

Reasoning appears under an arrow-marked Thinking header from the first delta, with muted, indented streaming text. Click its header to fold one section or press Ctrl+T to fold or expand all sections, including during streaming. Sections open while streaming and fold when sealed by default; an explicit expansion choice takes precedence.

Live text and reasoning deltas are retained immediately, with UI updates coalesced over 16 ms to match the renderer's cadence. Stream end and durable events flush pending updates immediately; session switches and disposal cancel them. Non-text chunks do not trigger transcript updates. Display pacing still depends on when the provider delivers chunks.

Answers and expanded reasoning render Markdown during streaming and after completion. The renderer handles incomplete code fences and caches unchanged bodies; the committed assistant message replaces the preview without adding a duplicate. Find highlights use source text and restore Markdown when cleared. Incomplete formatting and growing table columns can still change layout as more text arrives.

Code fences use highlight.js grammars, including C/C++, C#, Java, PowerShell, HTML/CSS, PHP, Ruby, Swift, and Kotlin. The fence's language name or alias selects the grammar; multiline comments and strings retain their token state across the block. Coloring preserves source characters, blank lines, and line counts while streaming. Missing or unknown language names render plain without automatic language detection.

The TUI reads preset overrides from the Web profile's patch when selecting a model or creating a session, so Web binding edits also apply here. The banner and status bar show the mounted preset; a missing preset refuses creation instead of starting without its composition.

The TUI forces prompt suppression OFF at startup and in the scope-filtered `system-prompt/prepare` event before each assembly reads providers; saved TUI or Web files remain unchanged. Assembly listeners cannot remove, edit, or reorder registered system sections. An explicitly authored complete persona remains the complete prompt. Before agent-loop and compaction requests reach the adapter, the TUI requires a nonempty leading system message and every system message to match active session history exactly. Missing, truncated, reordered, or substituted system messages fail the request instead of falling back. These checks also apply after resume, compaction, and preset or model changes. They verify prompt delivery through the Harness, not model obedience or a provider's internal processing; auxiliary title requests use their own prompts.

`/suppress-prompt` (alias `/suppress-promot`) and `status` display OFF, locked by strict system prompt protection. `on` and `toggle` are rejected without writing settings or interrupting a running turn. `off` saves a disabled TUI override through Harness settings; failed saves show an error. Other settings and the Web profile remain unchanged.

The native split-pane shell mounts a live PTY session in the right column beside the chat (`shared-win` on the Windows pwsh backend, `shared-kali` inside the kali WSL distro). `/shell` opens a styled picker for Windows, Kali, and Close shell when a pane is open. Use ↑/↓ or a number, then Enter to select; Esc cancels without interrupting a running turn. The picker initially selects the current backend, or Windows when no shell is open. `Ctrl+P` opens this picker when the shell is closed and cycles keyboard focus between chat and an open shell; `Esc` returns focus to chat. The pane polls the shared session, so agent-run `terminal_*` commands appear live alongside commands submitted by the operator. `/shell win|kali` and `/shell close` remain available for direct control. The status bar shows `⌨ shell:<variant>` while mounted. Opening needs a terminal at least 100 columns wide and is allowed while work runs. Closing the pane retains its session; closing the TUI disposes the sessions with the agent.

Drag the vertical divider or its centered `↔` handle to resize the chat and activity columns, including while the shell is closed. `Ctrl+Alt+Left` and `Ctrl+Alt+Right` move the divider two columns from either editor; overlays keep their own keyboard input. Each pane retains at least 30 columns when space permits, and smaller terminal windows share the available width. The selected activity width survives closing and reopening the shell during the current TUI process and is restored after enlarging the terminal.

The shell input stays at the bottom, with its lower border aligned above the chat's wrapped status bar. Output scrolls above it. Kali's latest native two-line prompt, including its user, hostname, directory, and `#` or `$` marker, stays above the input even when output is cleared. The display updates when the shell emits a new prompt; until one is observed it shows `kali ❯`. Switching backends resets the retained prompt.

Output chunks and command completion request a redraw immediately; they do not wait for the next scrollback poll or keystroke. Scrollback polling also displays commands run by the agent in the shared session.

The single `Agent Debug` panel is visible by default, including when no shell is open. `/agent-debug` toggles it for the current TUI process without clearing history or shell input. It fills the right column with the shell closed and shares it with an open shell below; hiding both restores full-width chat. The timeline keeps the newest 20 operations in start order, labeled Agent, Tool, Shell, MCP, File, Approval, or Retry, with status and elapsed time from session timestamps. Tool rows show command or argument previews and a result or error summary. Approval rows observe waiting and recorded decisions; retry rows show provider, attempt count, delay, failure, and settlement. File rows appear only for confirmed diffs in successful tool results. These rows observe events and never execute commands or grant approval.

Live MCP calls show only server-reported progress; the TUI never invents percentages. A live tool row moves through `queued` → `preparing` → `executing` → `settled`; replay restores only recorded `queued`, `preparing`, and settled states without progress. Background jobs keep separate registry rows. Sub Agent rows show the latest confirmed operation; click or press Enter to open the existing child inspector. The `N agents` badge or `Ctrl+Alt+G` opens searchable child histories.

When HTTP(S) URLs are observed, a scrollable `Targets` box appears above Debug, sharing `/agent-debug` visibility even without a shell. `Target` contains URLs from direct human messages; `Sub Target` groups discovered URLs on the same hostname or its subdomains into path branches; `Other` contains unrelated URLs. Committed assistant text and tool arguments/results supply discoveries; injected context and streaming deltas do not. Duplicate URLs merge after credentials, query, and fragment are removed from the displayed values; session events remain unchanged. Replay restores observations independently of the 20-item chat window and compaction, while clear/rewind remove shadowed sources and session switches reset the tree. The box shows at most 10 rows with its own mouse-wheel scrolling. Click the `Targets` header to collapse the box to one row, or click a group or path branch to toggle its children. After `Ctrl+Alt+D`, Tab switches between Debug and Targets, initially selecting its header. Up/Down select visible rows, Enter/Space toggle the selection, Left collapses or selects the parent, and Right expands or selects the first child. PageUp/PageDown and Home/End scroll the tree. Collapsed branches stay closed as URLs arrive; clearing or replacing the target set with unrelated URLs resets collapse state. These observed links do not trigger scans or authorize execution.

Background jobs appear as separate compact status rows in that same panel, for example `[RUNNING] Job · pwsh-102 · 4.0s`; the existing command preview stays unchanged. Tool success and turn completion do not finish these rows. Registry events update RUNNING, STOPPING, COMPLETED, FAILED, and KILLED immediately, even while Debug or the shell is hidden; the status bar counts running and stopping jobs. All active jobs and the latest 20 settled jobs are shown for the visible session, including unowned jobs. Session switches rebind the subscription and `/jobs` uses the same session id. Every registered kind and backend is supported without parsing command text; detached processes absent from the registry cannot be observed. Job rows use process-local registry snapshots, not replayed history, and never read output, consume the Agent's cursor, or control execution.

Click a row to expand or collapse its details. For keyboard navigation, press `Ctrl+Alt+D`, use ↑/↓ to select, Enter to toggle details, and PageUp/PageDown to scroll. Esc returns to the previous editor without interrupting the agent; hiding a focused panel also restores that editor. Details include arguments, tool output, errors, and file before/after text, capped at 16,000 characters per row; tool cards remain available in chat. Mouse-wheel scrolling reviews earlier rows. Hidden panels continue updating; replay restores event-derived history, session switches reset the list, and rewind/clear remove shadowed rows. Shell backend changes preserve the current session's activity. The panel reports only available events; file changes without tool diff metadata are not inferred.

Agent Debug also shows Main Agent and session-backed Sub Agent summaries from accepted events: task, latest tool, call counts, elapsed time, measured usage, and todo progress when available.

Timing values use session event timestamps and display milliseconds. `pre-step` measures `turn/start` to the first `step/start`; it excludes inbox wait before `turn/start`. `request sum` adds matched `step/start` to `assistant/message` intervals, including request preparation after `step/start`, retries, and provider or transport wait. It is not provider-only time. `TTFT avg` measures `step/start` to the first stream token for steps with an `assistant/message`, retaining the first token across retries. `tool sum` adds matched root `tool/call` to `tool/result` intervals, including approval and preparation time; PTC sub-dispatches are not timed separately. Tool intervals can overlap, so their sum can exceed elapsed time. Parenthesized counts show completed timing samples. `pre-step` displays `unknown` without both timestamps; the other figures display `unknown` when no timing samples match. Negative intervals contribute zero. The summary does not estimate local time by subtracting tool time from elapsed time.

For registered background jobs, TUI observes a bounded output suffix through the non-consuming `readAt` cursor. A recognized password, passphrase, confirmation, or continue prompt must remain quiet for `jobInputWarningDelayMs` (default 15,000 ms) before TUI shows an observe-only warning beside the job row. The warning contains no prompt or output text and never sends input.

While a shell is open, its agent can call `shell_draft` with `shell` (`win` or `kali`) and `command` to fill an empty shell input for human review. For example, choose Windows from `/shell`, return to chat with `Esc`, and ask the agent to draft `Get-Date` using `shell_draft`. The tool does not execute the command, send PTY input, or change focus. Review the input, focus the shell with `Ctrl+P`, and press Enter to submit it yourself. The tool rejects a different backend, existing input, empty commands, and terminal control characters; tabs and newlines remain available for command text. Backend switching also requires empty input. Closing the shell unregisters the tool, and other agents cannot access it. Existing tool guards still apply. Drafting is not an automatic fallback for safety refusals or denied approvals; the model must still follow its safety and execution policies and may refuse to provide a command.

`/exec` lists the shell commands the agent executed in this session, newest first, classified `KALI` (routed through `wsl -d kali-linux`) or `WIN`, with paired result status. Selecting a row focuses its transcript tool card for the full output and arguments.

`/mcp` opens a searchable MCP server list; selecting a server toggles all of its tools. `/mcp on|off|toggle|status` controls all MCP tools for the current TUI process. A disabled server or global OFF state removes the affected `mcp__*` tools from subsequent model requests and denies stale calls. The selections follow session switches but reset when the TUI restarts. Changing them while a turn is running is refused.

`/jev [on|off|toggle|status]` controls the Jev-first policy context and open-dev-browser MCP tools for the current TUI process. OFF removes both from subsequent model requests and denies stale JEV calls; ON restores them unless the global MCP or skills switch also hides them. Both hyphenated and normalized underscore server namespaces are recognized. The state follows session switches but resets when the TUI restarts. Changing it while a turn is running is refused.

`/skills` opens a searchable skill list; selecting a skill toggles its catalog entry, direct `/name` instruction injection, model tool calls, and autocomplete entry. `/skills on|off|toggle|status` controls all skills for the current TUI process. Global OFF also removes the `skill` tool from subsequent model requests. The selections follow session switches but reset when the TUI restarts. Changing them while a turn is running is refused.

When the switch is off, workspace instructions, runtime context, Jev-first context, and the selected team prompt are available from the first conversation turn, matching Web. Both surfaces use the Harness prompt registry and provider adapter; Pi TUI adds no coding-agent persona. Web's GUI-specific prompt sections remain exclusive to Web. Providers supporting in-history system updates receive the current prompt consolidated at the head, replacing prior preset and team policy while preserving the durable log.

`/team-mode` opens a numbered Blue, Red, Black, or Dead picker with arrow keys, number selection, Enter to save, and Esc to cancel. Direct mode names and `status` are also accepted. The selected icon and name appear in the status bar. TUI saves its mode independently of Web; without a TUI selection it uses the saved Web mode. Team prompt text follows saved Web settings, falling back to the shipped TUI defaults. Changes apply to the next request and survive restart and new sessions. Failed saves preserve the prior selection.

An unspecified TUI default effort uses the saved Web effort when the provider and model match. Explicit TUI model and effort defaults retain precedence. Resuming a session restores explicitly selected effort from its request header; adapter-default effort remains a provider default instead of becoming a user choice.

The `/preset` and `--preset` pickers hide system presets and list healthy user presets. System presets remain available to model bindings and resumed sessions.

## Commands

`/exit`, `/new`, `/fork`, `/resume`, `/recap`, `/context`, `/tree`, `/agents`, `/jobs`, `/model`, `/preset`, `/thinking`, `/team-mode`, `/suppress-prompt`, `/mcp`, `/jev`, `/skills`, `/shell [win|kali|close]`, `/agent-debug`, `/exec`, `/wiki`, `/runs`, `/recon`, `/machines`, `/key`, `/provider`, `/providers`, `/memory`, `/sessions`, `/rewind`, `/clear`, `/queue`, `/export`, `/rename`, `/copy`, `/retry`, `/expand-all`, `/hotkeys`, plus the official dsh slash commands (`/compact`, `/goal`, `/plan`, `/feedback`).

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

The checkout includes a separate Antigravity proxy with no additional dependencies or Antigravity CLI requirement. After installing and building the harness, run this setup command from the harness root on each new machine. The account owner must complete Google sign-in; starting `dsh tui` does not run this setup or open a login page:

```
node packages/experimental/pi-tui/tools/antigravity-proxy/setup.mjs
```

Setup creates the `tui` profile when absent, reuses a healthy proxy or starts one on `127.0.0.1:18877`, and opens Google sign-in. Windows also receives a silent Startup-folder launcher; Linux and macOS require their own service-manager configuration for startup at login. Use `--no-browser` to print the local sign-in URL without opening a browser, or `--dry-run` to inspect setup without changes. Initial launch output is appended to `~/.dsh/logs/antigravity-proxy.log` (`DSH_HOME` overrides the harness home).

Google tokens belong to this proxy in `~/.gemini/antigravity-proxy-token.json`, or `ANTIGRAVITY_TOKEN_FILE` when set. They refresh on demand; moving the checkout does not move account credentials or user profile patches. Sign in separately on the destination machine. The TUI bundle provides the `18877/v1` route and a local placeholder header for the client; Google authentication stays inside the proxy. Existing home or profile overrides take precedence, so a route already pointing to `8317/v1` continues using CLIProxyAPI. A stopped or unauthenticated Antigravity proxy fails its model requests while other TUI providers remain usable. Antigravity quota and Google terms apply.

The proxy relays text and function calls as OpenAI SSE, preserves function results and signature replay, and supports non-streaming JSON. It discovers the account's Cloud Code project before generation. `pnpm antigravity:test` checks relocation and these exchanges against a local upstream fixture, including the installed pi-ai client's tool round trip. Live Google sign-in and model availability require verification by the account owner.

For an external CLIProxyAPI deployment on Windows, download its binary and run `cli-proxy-api.exe --antigravity-login`. Register its own endpoint and configured API key through `/provider`; the bundled proxy's local placeholder is not a CLIProxyAPI credential. Install startup with `node packages/experimental/pi-tui/tools/antigravity-proxy/install-autostart.mjs <cliproxy-directory>`. A home patch targeting `llm-pi-ai` replaces the bundle's provider configuration by id.

## Dev Note

Adapted from the community `dsh-pi-tui` plugin (MIT, see NOTICE); ported to the 0.1.7-alpha.2 harness APIs and integrated as a workspace package. The terminal-render layer is excluded from the per-file coverage gate the same way as the other GUI-debt surfaces; the pure logic under `src/core` is gated.

## Model Experience

### Bounded pentest conversation

#### What the model sees

The banner and session facts, the folded transcript, tool cards, and the status bar (model, tokens, context bar, git, todos, queue). Withheld built-in prompt sections leave the operator's preset contributions and the `/preset`-switched policy as the system prompt.

#### Token effect

The TUI contributes no standing prompt sections of its own. Its spill policy retains at most 4,096 estimated tokens per eligible tool result, including recovery notices, while the complete result remains readable from spill storage. Small results and direct `read` results retain the existing policy behavior. Compaction defaults and advertised model context windows are unchanged; rewound exchanges stay shadowed in the durable log via `/rewind` and `/clear` markers.

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
