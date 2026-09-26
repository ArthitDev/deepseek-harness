---
description: "Browser recon run viewer: the Recon tab over the reconRuns Remote namespace, the target control in the composer, and the compact Chat handoff."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-recon

English | [中文](README.zh.md)

## Summary

Use this package to give operators a browser surface over the deterministic recon engine. It registers the `conversation.view` Recon tab (run list, compact report, coverage, warnings, phases, lazy evidence reading) and the composer's Recon Target control, both wired to the generated `reconRuns` Remote namespace. Starting a scan from either entry point calls the same engine the `recon_scan` tool drives; while the scan runs, the tab polls the run list for live phase progress and offers cancellation; finished reports badge legacy scans, explain an unobservable backend, and hand a compact projection to the Agent through Chat.

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

Mount this plugin in the web-app bundle next to the recon-engine host plugin; it needs the `remote.reconRuns` carrier, the conversation shell, and the locale service. No configuration of its own exists: evidence location, budgets, and cache behavior stay owned by the engine plugin's settings card. Operators type a target URL in the composer control or the tab, watch the phase line until the run settles, open stored runs from the list, and delete a run with its evidence through the confirmed discard dialog.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/client/index.ts` registers both slots and adapts the generated Remote client into the view's injected loaders; every Remote result is unwrapped once and errors surface through the view's alert line. `ReconView.tsx` owns list/detail state, the scan-progress poll (a three-second list refresh that reads the newest running entry's phase), and the compact Chat projection in `reconChatPrompt`, which keeps findings, endpoints, coverage, and warnings but never raw bodies. `ReconTargetControl.tsx` renders the composer entry. Locale copy lives in `locales.ts` with Simplified Chinese as the key-set source of truth and English checked complete against it.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Recon engine](../../pentest/recon-engine/README.md) — the scans, reports, and evidence this surface projects.
- [Locale-owned client UI copy](../../../.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md) — why all copy routes through the typed dictionaries.

-----

<a id="model-experience"></a>
## Model Experience

### Operator surface, not an agent surface

#### What the model sees

Nothing directly. Chat receives what the operator sends: the compact projection built by `reconChatPrompt`, submitted as one user message through the conversation service.

#### Token effect

One bounded message per explicit operator send; the projection carries endpoints, coverage, and warnings but no raw page or evidence bodies.

#### KV Cache effect

None. The package registers no tools or prompts; the sent message behaves like any other user input.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The tab projects stored runs; it never computes reconnaissance itself.

- **No authenticated re-run flows** — the surface starts only the anonymous Full Deep scan the engine defines.
- **Poll-based progress** — live phase updates ride a three-second list poll, not a push channel; a scan that writes no checkpoint shows an indeterminate progress line.
- **No run comparison** — two runs of one target are listed side by side but never diffed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
