---
description: "Global always-search toggle in General Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-web-search-mode

English | [中文](README.zh.md)

## Summary

This package places an `Always use web search` toggle in General Settings. It writes the host-owned `web-search-policy` setting; `dsh-tool-web` reads that setting before each request and owns prompt injection.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount it with `ui-settings`, `dsh-tool-web`, settings remotes, and a host `@deepseek-ai/dsh-tool-web/settings` entry. The row appears only when the host exposes the `web-search-policy` namespace. The setting defaults off and persists in the user settings document.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The browser plugin contributes one `settings.general.item` row and uses the shared `Switch` control. It disables the switch while loading or saving, hides the row when the host does not expose the namespace, and shows write failures inline. It does not register a chat control.

-----

<a id="dev-note"></a>
## Dev Note

The node half is intentionally empty. Tests cover settings slot registration, persistence writes, failure display, Host policy precedence, and conditional system-prompt assembly.

No runtime invariant companion is published because this browser control owns no divergent runtime observations.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`, which requires one structured `web_search` call before each answer when enabled, otherwise searches only for current or missing information while preferring other relevant tools, and uses the user's language for search queries by default.

#### KV Cache effect

Changing the setting alters the next assembled system prompt for every session. A stable setting remains prefix-stable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The toggle is available only when the host exposes `web-search-policy`.
- Provider availability remains independent; a missing provider still produces the normal web-tool error.
