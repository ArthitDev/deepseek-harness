---
description: "The remote package group: saved SSH machines and the adapters that route workspace files and commands to them."
kind: "package-group"
---

# remote/ - saved execution machines

English | [中文](README.zh.md)

## Summary

The remote package group lets one DSH Host use workspaces on saved SSH machines. The `remote-machines` package owns profile storage, host-key trust, and the filesystem and subprocess routing used by those workspaces. Browser clients receive redacted profile data; passwords, private keys, and passphrases stay in Host settings or Host memory.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The group currently has one package that owns the complete saved-machine path.

| Package | Role |
|---|---|
| [`remote-machines`](remote-machines/README.md) | Stores SSH profiles, verifies host fingerprints, and routes machine-qualified filesystem and subprocess work. |

<a id="related-documentation"></a>
## Related documentation

- [Filesystem subsystem](../../docs/subsystems/filesystem.md) - the file operations that remote workspaces implement.
- [Subprocess subsystem](../../docs/subsystems/subprocess.md) - the command and terminal operations routed through SSH.
- [Saved SSH machine decision](../../.agents/notes/implemented/feature/2026-09-12-remote-ssh-machines.md) - trust, credential, and workspace ownership choices.

<a id="dev-note"></a>
## Dev Note

None.
