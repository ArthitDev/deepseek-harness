---
description: "Per-session always-search control beside the Web composer access selector."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-web-search-mode

English | [中文](README.zh.md)

## Summary

This package places a `Web Search` toggle beside the composer access selector. It reads the host-projected `webSearchMode` state and dispatches `/web-search always` or `/web-search auto`; the host owns persistence and prompt injection.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount it with `ui-conversation`, `dsh-tool-web`, the session projection runtime, and command remotes. The control appears only when the host exposes `webSearchMode`. Its active state is host-confirmed and survives reload, resume, and context compaction because it is folded from the Session log.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The browser plugin occupies the `conversation.input.webSearch` single session seat. It sends the same command a user can type and shows command or transport failures inline. It never changes permission, sandbox, or approval settings.

-----

<a id="dev-note"></a>
## Dev Note

The node half is intentionally empty. Tests cover slot registration, command dispatch, failure display, projection persistence, and conditional system-prompt assembly.

No runtime invariant companion is published because this browser control owns no divergent runtime observations.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `/web-search` command; `dsh-tool-web` owns the model-visible system-prompt policy.

#### KV Cache effect

Changing the mode alters the next assembled system prompt and invalidates reuse from that changed policy section; a stable mode remains prefix-stable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The toggle is available only when `web_search` is composed.
- Provider availability remains independent; a missing provider still produces the normal web-tool error.
