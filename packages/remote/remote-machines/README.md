---
description: "Save SSH machines, verify their host fingerprints, and run workspace file and command operations on them from one DSH Host."
kind: "package-reference"
---

# @deepseek-ai/dsh-remote-machines

English | [中文](README.zh.md)

## Summary

`dsh-remote-machines` lets one DSH Host keep named SSH profiles and open workspaces on those machines. It routes machine-qualified file operations through SFTP and command or terminal operations through SSH while leaving local paths on the existing local providers. Browser responses never include passwords, private keys, or passphrases. A user must confirm the observed SHA-256 host fingerprint before workspace execution starts.

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

Mount this package in the Host composition that serves the Web client. Users then add, probe, trust, and remove machines in Settings and choose a saved machine when adding a workspace.

### When to choose it

Choose this package when repositories or tools live on SSH-accessible Linux or macOS machines and one DSH instance should manage them. Keep the local filesystem and subprocess providers alone when every workspace runs on the Host. The package supports SSH-agent authentication, saved passwords, lifetime-only prompted passwords, and saved private keys with optional passphrases.

### Minimal configuration

The plugin has no direct configuration fields. It stores profiles through `ctx.settings` and never returns secret fields through its Remote API.

```yaml
- name: '@deepseek-ai/dsh-remote-machines'
```

### Connection trust and failures

Probe opens a temporary SSH connection that reports the observed fingerprint and remote platform. Trust probes again and saves only the exact matching fingerprint. Later filesystem and process connections reject a different key. Removing a machine fails while a registered workspace still refers to it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals - click to expand</summary>

The package encodes remote locations under an internal machine-qualified path prefix. `SshFileSystem` and `SshSubprocessRuntime` extend the local providers and delegate only paths with that prefix. `SshConnectionPool` shares verified SSH clients and opens caller-owned SFTP or command channels.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Saved profile service, redacted Remote methods, trust, and provider composition. |
| [`src/connection.ts`](src/connection.ts) | SSH authentication, fingerprint checks, connection reuse, and probing. |
| [`src/path.ts`](src/path.ts) | Machine-qualified internal path encoding and resolution. |
| [`src/fs.ts`](src/fs.ts) | Local and SFTP filesystem routing. |
| [`src/subprocess.ts`](src/subprocess.ts) | Local and SSH subprocess routing. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Remote package group](../README.md) - the package family map.
- [Filesystem subsystem](../../../docs/subsystems/filesystem.md) - shared file operation semantics.
- [Subprocess subsystem](../../../docs/subsystems/subprocess.md) - shared process and terminal semantics.
- [Saved SSH machine decision](../../../.agents/notes/implemented/feature/2026-09-12-remote-ssh-machines.md) - security and ownership rationale.

-----

<a id="model-experience"></a>
## Model Experience

### Remote workspace execution

#### What the model sees

Existing file and command tools keep their normal schemas and return remote paths, command output, and failures for the selected workspace `cwd`. The package adds no separate tool or system-prompt text.

#### Token effect

The package adds no request prefix. Remote file contents and command output consume the same result tokens as equivalent local tool calls.

#### KV Cache effect

Selecting a remote workspace changes tool execution paths, not the model request prefix, so it does not directly invalidate cached request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define which SSH machines can back a workspace.

- **POSIX command runtime only** - probing identifies Windows SSH hosts, but the Web client refuses to create their workspaces because remote commands use POSIX shell quoting and environment syntax.
- **No jump-host or SSH config expansion** - each profile connects directly to one host and port with the selected authentication method.
- **Host-stored credentials use the configured settings backend** - prompted passwords live only for the current Host lifetime; saved passwords, private keys, and passphrases have the durability and protection of that backend.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published because this transport adds no separately checkable model-facing invariant.

<details>
<summary>Working context for maintainers - click to expand</summary>

None.

</details>
