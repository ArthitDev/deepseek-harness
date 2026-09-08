# Agent Note: Shield Break Agent upstream integration

Status: implemented

English | [中文](2026-09-08-shield-master-integration.zh.md)

## Problem

Shield Break Agent adds preset authoring, permanent Session deletion, themed controls, Tailnet settings access, plugin enablement, and bounded output continuation. Upstream changes the file Sidebar, Inbox API, Assistant streams, and persistent Session generations. Choosing one entire side would discard features or restore incompatible APIs.

## Decision

Persona configuration accepts legacy `text` only when `prefix` is absent. The editor writes `prefix` while retaining the suffix and capabilities. Snapshot workspaces for output continuation and skill loading have their own project marker so ancestor instructions and skills cannot enter their logs.

Retain the fork's user-facing features while adapting them to upstream APIs. Session rows carry both deletion and search-reveal callbacks. Preset editing keeps its edit button beside upstream tags. Plugin switches and live status use the updated primitives. Output continuation reads compact Assistant settlements and checks both pending Inbox lists. Permanent deletion uses the same cross-process writer lease as write-open and removes all generations of the selected Session.

## Alternatives considered

**Prefer ours for every conflicting file.** Rejected because older persistence and stream assumptions would compile or behave incorrectly beside the new packages.

**Replace the fork with upstream.** Rejected because it removes requested customization and authoring controls.

## Consequences

Windows verification covers the build, preset authoring in a real browser, settings and workspace browser flows, persistence exclusion, output-limit replay, and PowerShell skill loading. Skill loading uses separate scenarios: `skill-load` runs on POSIX with the shared Bash header; `skill-load-pwsh` requires PowerShell, explicitly selects its shell, and owns its prompt and tool-schema sidecars. Both retain full request and persisted-log comparisons. POSIX execution still requires a POSIX runner; Windows skips that scenario rather than comparing it against PowerShell output.

Source merges do not migrate the user's Harness home. Tests use temporary storage; live deployment requires a separate backup of configuration and histories before first write with the new runtime. The pre-merge source remains on `backup/shield-break-agent-before-master-20260908`. Archived upstream notes retain their sealed contents; current feature notes own the fork's additions.
