# 远程机器

[English](remote-machines.md) | 中文

[`dsh-remote-machines`](../../packages/remote/remote-machines/README.zh.md) 让一个 DSH Host 保存命名的 SSH profile 并在这些机器上打开工作区。`ctx.remoteMachines` 服务通过 `ctx.settings` 存储机器 profile，探测候选机器并报告其观测到的 SHA-256 主机指纹，并以用户的显式指纹信任作为工作区执行的前提。机器限定的文件操作经 SFTP 路由，命令与终端操作经 SSH 路由，本地路径仍走既有本地提供方；浏览器响应永远不包含密码、私钥或口令。[包 README](../../packages/remote/remote-machines/README.zh.md) 持有配置、Remote API 表面与限制。

Source: [`packages/remote/remote-machines/src/index.ts`](../../packages/remote/remote-machines/src/index.ts)

## Profile 与信任

已保存的 profile 携带连接字段与存储的密钥类别；移除会清除该 profile 及其存储的密钥。信任按机器生效：机器上的工作区只有在其观测指纹被确认后才运行，指纹变化需要操作者重新决策而不是静默重连。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
