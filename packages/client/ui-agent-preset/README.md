---
description: "Choose Agent presets and the new-task default in Web, and read what each mode does. Authoring is guided to Creator mode."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-preset

English | [中文](README.zh.md)

## Summary

Choose Agent presets and the new-task default in Web, and read what each mode does. Authoring is guided to Creator mode.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Settings shows the built-in and custom card groups with default highlighting and card-body selection; a group without presets is omitted, except the custom group, which keeps its Creator entry on screen. The page edits nothing: that entry starts a Creator-mode task that authors or overrides a preset as a bundle, offered while the `cordis` preset is on the roster and a conversation flow exists.

The “Choose a mode for new tasks” switch controls whether the saved user default is active. Hiding selection uses the deployment default; showing it restores the user preference. Choosing a healthy default also synchronizes the blank session on the current new-task surface. Creator starts a new task using the `cordis` preset. The new-session picker additionally requires Developer tools in General Settings.

The settings section shows the roster as cards: a copy dialog creates a preset, then opens that custom preset in a native textarea editor for `agent.cordis.yml`; every custom card also keeps a location action for its metadata, skills, and assets. Save sends only the preset id and text, preserves the draft on failure, and affects later sessions rather than sessions already composed. The default is set from any surface; deleting removes the preset directory while sessions already composed from it keep running. A shipped preset opens in a read-only viewer and offers no edit, location, or delete. A roster row carrying `broken` renders as a marked card whose body and duplication are disabled, because a copy of a broken preset is another broken preset; broken custom rows keep their location and delete actions so the files can be fixed and ghost directories cleared. The card face still shows the preset's own description — a chooser cannot act on a package specifier there — and the host's reason rides the badge as a tooltip, plus a visually hidden alert that carries it to assistive technology, which a disabled card body cannot.

The Model bindings list joins the Host's current model catalog with the preset roster. Each model can select a healthy preset or Default preset; choosing Default preset removes that route's override. A changed binding applies to new sessions and to a blank session when the model is selected, while a session that has started keeps its current preset.

### The conversational entry

When the roster carries the self-referential `cordis` preset, a dashed add-card stages it and starts a new session — the section closes the settings panel and the new-session chip's own applier composes the blank session the workspace flow produces.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`agentPresets/list` supplies the roster and the chooser policy; default and visibility changes write the `agent-presets` settings namespace. The picker, blank-session synchronization and read-only session label use recorded preset identities. Connection resets and settings updates refresh the roster.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Scope](../../core/scope/README.md) — Registration isolation.
- [Agent](../../core/agent/README.md) — Session runtime.
- [Cordis](../../../docs/cordis-primer.md) — Plugin configuration and lifecycle.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the selected preset, whose plugins own model-visible capabilities.

#### KV Cache effect

Selection changes affect only later tasks; existing plugins and prompts remain unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Web creates and edits no preset: a bundle installed through Creator mode declares a new preset or overrides a shipped one by row id, replacing its complete child list.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published; the Host registry owns state, and component tests cover client presentation and selection.
