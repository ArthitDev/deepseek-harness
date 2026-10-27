---
description: "Executed shell commands tab for the right Sidebar: KALI/WIN-classified command history with paired result status."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-exec

English | [中文](README.zh.md)

## Summary

`ui-sidebar-exec` contributes the `exec` tab to the right Sidebar: one page listing the shell commands the visible session's agent executed, newest first. It reads the same Session Controller event window the Conversation assembles from, pairs each shell `tool/call` with its `tool/result` by call id, and classifies every command's execution world — `KALI` when the command routes through `wsl -d kali`, else `WIN`. Pairing and classification live in a presentation-pure module; the React body renders entries with status, command text, and the paired result, and selecting a row focuses the transcript's matching tool card.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders Session events as browser history and registers nothing the model sees.

#### KV Cache effect

None; the exec page reads event windows and never constructs or mutates model context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only model-facing shell tools are listed** — commands the agent sends through the PTY `terminal_send` tools do not appear; the panel pairs `tool/call`/`tool/result` events of the shell tools only.
- **Classification is textual** — the KALI/WIN split reads the command text's `wsl -d kali` route, so a wrapped or aliased route into the distro can be misfiled as `WIN`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
