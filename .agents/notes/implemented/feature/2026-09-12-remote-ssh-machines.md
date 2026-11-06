# Agent Note: Workspaces can run on saved SSH machines

Status: implemented

English | [中文](2026-09-12-remote-ssh-machines.zh.md)

## Problem

Workspaces previously used only the computer running DSH. Users who keep tools and repositories on another machine had to leave the app or maintain a separate harness there.

## Decision

The `remote-machines` Host service stores named SSH profiles and exposes only redacted profile views to the browser. Passwords, private keys, and passphrases never appear in list responses. Users may save a password or private key, use automatic SSH-agent authentication, or enter a password for one Host lifetime without writing it to disk. Changing authentication mode removes secrets that belong to the previous mode.

Remote workspace paths use an internal machine-qualified prefix. The shared filesystem and subprocess services recognize that prefix and route file operations, commands, and interactive terminal channels through SFTP and SSH. Local paths continue through the existing local implementations.

The first connection probes the host key and shows its SHA-256 fingerprint. A user must trust that exact observed fingerprint before a workspace starts. Trust re-probes the host to reject a key that changed between inspection and confirmation. A saved machine cannot be deleted while a registered workspace still refers to it.

The Web client adds a Remote machines settings section, a computer selector beside the composer controls, and machine-grouped workspace rows. Existing remote workspaces run through the same fingerprint check as newly entered paths.

## Alternatives considered

**Run a separate Harness on each machine.** This keeps execution local to each server, but users must switch applications and duplicate configuration instead of managing those workspaces from one DSH instance.

**Trust hosts on first use without confirmation.** This removes one setup step but cannot distinguish the intended server from an intercepted first connection, so the client requires explicit fingerprint confirmation.

## Consequences

One DSH instance can manage local workspaces and saved Linux or macOS SSH machines. Windows SSH hosts remain visible during probing but the client refuses to create a remote workspace because the command runtime currently uses POSIX shell conventions.
