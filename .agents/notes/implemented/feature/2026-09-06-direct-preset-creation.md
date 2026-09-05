# Agent Note: Direct preset creation from a system prompt

Status: implemented

English | [中文](2026-09-06-direct-preset-creation.zh.md)

## Problem

The settings page required a person to duplicate a preset before editing its system prompt. This exposed an implementation step instead of the common task: naming an agent and entering its instructions.

## Decision

The custom-preset group offers an Add preset dialog with an id, optional display name, and system prompt. The browser reads the healthy default preset, replaces only its persona text, and sends the source id and complete composition to one authenticated `agentPresets/create` operation.

The Host copies the source directory so the new preset retains its tools, skills, assets, and metadata. It writes the replacement composition inside the copy transaction; any copy, permission, metadata, or composition-write failure removes the destination directory. The id remains path-constrained and shipped presets remain read-only.

Duplication remains available for users who want an unchanged copy of a selected preset. Creator mode remains available for compositions that need plugin or tool changes beyond a system prompt.

## Alternatives considered

- Creating a persona-only composition: rejected because the resulting agent would silently lose the default preset's tools and skills.
- Calling `copy` and `write` as separate browser operations: rejected because a disconnect between them could leave a visible preset carrying the source prompt.
- Replacing duplication entirely: rejected because exact copies and copied assets remain useful.

## Consequences

Creating a prompt-focused preset takes one dialog and produces a complete preset. The default preset defines its initial capabilities, so users who need a different tool set use Duplicate or Creator mode. Composition text remains privileged input protected by the existing authenticated connection and writable-root checks.
