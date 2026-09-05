# Agent Note: Browser-editable user preset compositions

Status: implemented

English | [中文](2026-09-04-browser-editable-user-preset-compositions.zh.md)

## Problem

Copy-first preset authoring created a safe local directory but left `agent.cordis.yml` editable only through an external file editor. That made the Web UI incomplete, especially on remote or headless hosts: it could create and inspect a custom preset but could not change its system prompt.

## Decision

The authenticated `agentPresets` Remote surface exposes `write(id, content)`. The browser never supplies a filesystem path. The Host resolves the id against the roster, requires `user` trust, requires the preset's composition path to equal `<first-user-root>/<id>/agent.cordis.yml`, and atomically replaces that file with owner-only permissions. Shipped presets remain read-only and therefore remain a recovery anchor.

Settings uses a native textarea for a healthy custom preset and keeps the existing read-only viewer for a shipped preset. Duplicating a preset opens the new copy in the editor. A failed save preserves the draft and reports the error. A successful save refreshes the roster and drops the standing pointer so later sessions mount the new generation; sessions already joined keep their current generation.

Composition YAML supports executable `!!js`. Editing a custom composition therefore grants the same process-level capability as editing it on disk or using shell access; the editor does not pretend to sandbox or validate that code. Browser authentication remains the authorization boundary, and the request cannot redirect the write to an arbitrary path.

## Alternatives considered

- Editing shipped presets: rejected because upgrades overwrite them and a known-good source is needed for recovery.
- Keeping external editors as the only path: rejected because it does not satisfy Web UI and headless use.
- Adding CodeMirror or another editor dependency: rejected; a native textarea covers the requested operation without another runtime dependency.

## Consequences

The browser can persist privileged composition text inside the first user preset root. Invalid text can make the preset appear broken, but the draft survives a failed transport write and the preset directory remains available for recovery. Metadata, skills, and assets continue to use the normal file editor or location action.

This supersedes only the no-browser-write decision in [copy-only preset authoring](../simplification/2026-08-08-copy-only-preset-authoring.md). Its copy-first creation, built-in immutability, path-free requests, and location-action decisions remain current.
