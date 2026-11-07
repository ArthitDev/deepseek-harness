---
description: "Official sidebar brand mark for Shield Break client builds."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

## Summary

This package gives an `official` client build the Shield Break shield mark in the sidebar. The shipped Web and Desktop compositions load it by default. The brand name stays on the shell's localized product label, so the build badge below it keeps rendering, and the home page keeps its declaring fallbacks. The package has no runtime state and adds no model requests.

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

The shipped Web and Desktop compositions already mount this plugin; an `official` client build registers the sidebar mark.

### Choosing the profile

`DSH_CLIENT_BUILD_PROFILE` selects which brand renders. An `official` build shows the Shield Break mark in the sidebar; any other value leaves the shell fallbacks — the fish mark and the local-build label — in place. The plugin still loads and validates in both cases; only the mark registration is profile-gated.

### Replacing the brand

A deployment with its own identity leaves this package out and composes another package that occupies the sidebar slots. Occupying a slot is the only composition route; the artwork identity is not configurable.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The mark installs as one declaration-aware registration: `ctx.slots.inject()` waits on the sidebar declaration, so the occupant works whether this row activates before or after the declarer, withdraws when the declaration collapses, and leaves no partial brand mix during HMR. The brand name and every home surface stay on their declaring fallbacks. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The browser title is a build-environment concern (`DSH_CLIENT_TITLE`), outside the slot system.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` and the `conversation.hero.frame` layer, both left on their fallbacks here.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package retains no mutable state, and its slot occupant installs and leaves through one transactional effect.
