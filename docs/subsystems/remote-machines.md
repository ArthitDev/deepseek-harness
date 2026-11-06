# Remote machines

English | [中文](remote-machines.zh.md)

[`dsh-remote-machines`](../../packages/remote/remote-machines/README.md) lets one DSH Host keep named SSH profiles and open workspaces on those machines. The `ctx.remoteMachines` service stores machine profiles through `ctx.settings`, probes a candidate machine and reports its observed SHA-256 host fingerprint, and gates workspace execution on the user's explicit fingerprint trust. Machine-qualified file operations route through SFTP and command or terminal operations through SSH, while local paths stay on the existing local providers; browser responses never include passwords, private keys, or passphrases. The [package README](../../packages/remote/remote-machines/README.md) owns configuration, the Remote API surface, and the limitations.

Source: [`packages/remote/remote-machines/src/index.ts`](../../packages/remote/remote-machines/src/index.ts)

## Profiles and trust

A saved profile carries the connection fields and the stored secret kind; removal clears the profile and its stored secrets. Trust is per machine: a workspace on a machine runs only after its observed fingerprint is confirmed, and a changed fingerprint requires the operator's renewed decision rather than silent reconnection.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxremotemachines--remotemachines"></a>

### `ctx.remoteMachines` — `RemoteMachines`

Owns saved SSH profiles, fingerprint trust, and shared remote transports.

```ts cordis-catalog
/**
 * Read a Host-only profile with any lifetime-only password applied.
 * @param id - Saved machine identifier.
 * @returns the complete profile, or undefined when it is absent.
 */
profile(id: string): RemoteMachineProfile | undefined

/**
 * List every saved machine without credential fields.
 * @returns redacted views for every saved machine.
 */
@Remote('list') list(): RemoteMachinesValue

/**
 * Create or update one saved profile.
 * @param request - Validated profile fields and optional secrets.
 * @returns the redacted saved profile.
 */
@Remote('save') async save(request: RemoteMachineSaveRequest): Promise<RemoteMachineValue>

/**
 * Delete a saved profile that has no registered workspace.
 *
 * The wire name avoids the client namespace service's reserved `remove` bookkeeping member, which no
 * remote method may share (`remoteMachines/remove` breaks client mounting).
 * @param request - Saved machine identifier.
 * @returns confirmation after settings and cached credentials are cleared.
 */
@Remote('deleteMachine') async remove(request: RemoteMachineIdRequest): Promise<RemoteMachineRemoveValue>

/**
 * Observe an SSH host key and platform without trusting a new key.
 * @param request - Saved machine identifier and optional lifetime-only password.
 * @returns the observed fingerprint and remote platform details.
 */
@Remote('probe') async probe(request: RemoteMachineProbeRequest): Promise<RemoteMachineProbeValue>

/**
 * Re-probe and save one exact SSH host fingerprint.
 * @param request - Saved machine identifier and observed fingerprint.
 * @returns the updated redacted profile.
 */
@Remote('trust') async trust(request: RemoteMachineTrustRequest): Promise<RemoteMachineValue>
```

Source: [`packages/remote/remote-machines/src/index.ts`](../../packages/remote/remote-machines/src/index.ts)
<!-- END GENERATED cordis-surface -->
