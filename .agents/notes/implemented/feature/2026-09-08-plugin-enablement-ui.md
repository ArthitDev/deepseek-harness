# Agent Note: Confirmed plugin enablement editing

Status: implemented

English | [中文](2026-09-08-plugin-enablement-ui.zh.md)

## Problem

The Plugins inventory shows enablement but users must edit YAML to change it.

## Decision

Expanded cards offer a native switch with explicit save and cancel. The Host
resolves configuration paths and checks the exact document revision under a file
lock. It saves a sibling `.bak` before persistence. User presets use the roster's
write boundary; global tools and the deployment global-skills hook use a profile
patch. Infrastructure, built-in presets, ambiguous entries, expressions and
disabled ancestor groups are protected. Existing Web authentication is unchanged.

The mounted inventory refreshes after saving and one second after each completed
read. Unmounting cancels its timer and ignores late responses. Polling reflects
Host state without claiming that a persisted change has already activated.

## Alternatives considered

**Direct Loader mutation:** changes would disappear on restart and bypass the
configuration source. Persist the configuration instead.

**Switch every global plugin:** disabling the gateway or settings infrastructure
could remove the recovery UI. Keep those entries configuration-only.

## Consequences

Users no longer need YAML for supported switches. Preset serialization preserves
values and `!!js`, but loses comments. Global patches can accumulate overrides;
existing reload policy and higher-priority patches still apply. Preset edits
affect new sessions. Save success does not promise runtime activation. Tests
cover revisions, backups, protected entries, YAML semantics and confirmation.
