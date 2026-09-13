# Agent Note: Web skill management

Status: implemented

English | [中文](2026-09-08-web-skill-management.zh.md)

## Problem

The Web client could invoke skills already visible to DSH but had no way to discover or install a global skill. Users had to leave the application and manually place files under the DSH home directory.

## Decision

Add one **Settings > Skills** section backed by three root-addressed Remotes (`skills/installed`, `skills/search`, and `skills/add`): list installed global skills, search skills.sh through `npx skills find`, and install one selected `owner/repository@skill` through `npx skills add --agent universal -y --copy`. A simulated terminal accepts both `npx skills add owner/repository@skill` and the official `owner/repository --skill skill-name` form, including an HTTPS GitHub repository URL. The browser parses an allowlisted command grammar, extracts only the canonical catalog identifier, and never executes pasted text.

The Host executes `npx` directly without a shell, bounds runtime and output, removes Harness credentials from the child environment, and stages the result outside the DSH home. It publishes only when the staging directory contains exactly the requested skill and a regular `SKILL.md`. Replacement uses a pending directory plus a recoverable backup under `$DSH_HOME/skill-backups`; a failed final move restores the prior version.

## Alternatives considered

**Run the installer in the browser.** Rejected because browsers cannot safely write the Host skill directory and would expose an unnecessary execution boundary.

**Install directly into `$DSH_HOME/skills`.** Rejected because a failed or malicious package operation could leave a partial skill or overwrite the current version without recovery.

**Build a second catalog client.** Rejected because the maintained `skills` CLI already defines skills.sh discovery and installation behavior.

## Consequences

Users can enter a familiar npx command in a terminal-like control or discover and install catalog skills without leaving the Web UI, and every preset sees the same `$DSH_HOME/skills` collection. Installation requires network access and `npx`, accepts one catalog identifier at a time, and deliberately omits update and uninstall controls. A skill remains trusted instruction content that can direct an Agent to execute commands, so the UI requires explicit confirmation and displays a source warning.
