---
description: "Agent-preset surfaces for the Web GUI: the default-preset setting, the new-session chip, the session-header label, and the preset roster management section; for users and maintainers of agent composition."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-preset

English | [中文](README.zh.md)

## Summary

This package provides the agent-preset surfaces of the Web GUI: a chip on the new-session screen choosing the next session's preset, a read-only label in the session header, and a settings section that manages direct creation, duplication, deletion, defaults, and preset files. A session's preset is fixed at creation, so the choice applies to sessions started afterwards while running sessions keep the composition they began with; the default preset is edited in the settings section, where the roster is visible, so General settings carries no duplicate control for the same field. When a deployment composes no presets, all three surfaces render nothing and every session shares the host composition.

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

Mount this plugin alongside the settings and conversation packages; the preset surfaces then appear where their slots render. The new-session chip opens on the deployment default and stages a pick that lands on the next blank session; the stage is spent on first use, so the following new session opens on the default again.

### Managing the roster

The settings section shows the roster as cards. Add preset collects an id, optional name, and system prompt, then creates a custom preset with the current default preset's capabilities. Duplicate keeps the selected source unchanged and opens the copy in the prompt editor. Every custom card also keeps a location action for its metadata, skills, and assets. Save sends only the preset id and text, preserves the draft on failure, and affects later sessions rather than sessions already composed. The default is set from any surface; deleting removes the preset directory while sessions already composed from it keep running. A shipped preset opens in a read-only viewer and offers no edit, location, or delete. A roster row carrying `broken` renders as a marked card whose body and duplication are disabled; broken custom rows keep their location and delete actions so the files can be fixed and ghost directories cleared.

The Model bindings list joins the Host's current model catalog with the preset roster. Each model can select a healthy preset or Default preset; choosing Default preset removes that route's override. A changed binding applies to new sessions and to a blank session when the model is selected, while a session that has started keeps its current preset.

### The conversational entry

When the roster carries the self-referential `cordis` preset, a dashed add-card stages it and starts a new session — the section closes the settings panel and the new-session chip's own applier composes the blank session the workspace flow produces.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The display options come from one `agentPresets/list` call — the roster already reports which id a session with no explicit choice gets, so no surface introspects the settings schema — and the default write targets the `agent-presets` settings namespace's `default` field. Direct creation reads that default composition, replaces its persona prompt in memory, and sends the complete text to one Host `agentPresets/create` operation; the Host copies the source directory and writes the replacement before the operation succeeds. The settings section queries `settings.canOpenAgentPresetDirectory()` when it first loads and joins that result with the roster; a failed query removes only the native-open affordance. The new-session chip and the header label share one controller because the staged choice belongs to the flow rather than to any session. [`dsh-client-connection`](../connection/README.md) authenticates the preset Remote methods and every other Host API method with the same browser session. The section re-reads on its own actions, `settings/document-updated`, and `connection/reset`, because composition files can also change outside the browser.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the preset surface is not enough. They move from the browser surfaces to the preset domain and the composition model.

- [dsh-agent-presets](../../preset/agent-presets/README.md) — the host roster and composition the surfaces read and manage.
- [ui-conversation](../ui-conversation/README.md) — declares the hero and session-header slots the chip and label fill.
- [ui-settings](../ui-settings/README.md) — the settings shell that hosts the roster section.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the preset a later session is composed from; the preset it selects owns every model-facing effect.

#### KV Cache effect

No direct invalidation. Changing the default never touches a running session's prefix; a session created afterwards establishes its own prefix from its own composition.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current preset surfaces. They are current package constraints, not a general composition comparison or a task backlog.

- **A preset without metadata is listed by id** — display text is optional, and a copy given no name deliberately falls back to its directory name rather than presenting itself identically to its source. The resolution itself is the shared `presetDisplayText` fold from [`dsh-agent-presets/display`](../../preset/agent-presets/README.md), which the Settings plugin list inlines over this plugin’s dictionaries to show shipped presets in the active locale without translating user-authored metadata.
- **A revealed path is display text, not a link** — where the host has no desktop opener the row shows the directory to copy by hand; the browser cannot open a host filesystem location itself.
- **Composition edits are invisible to the page** — the files are edited outside the browser and nothing on the wire announces a file change, so the roster re-reads on its own actions, `settings/changed`, and `connection/reset`, not on every disk edit.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This is a browser-side surface plugin whose node half owns no event stream or mutable runtime data; the roster and the settings write are host contracts covered there.
