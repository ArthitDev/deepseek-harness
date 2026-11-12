# VPN 状态

[English](vpn-status.md) | 中文

[宿主 VPN 服务](../../packages/host/vpn-status/README.zh.md)持有 HTTPS 出口采样结果，供 Web 和 TUI 使用。包参考文档定义配置、证据规则、过期行为和采样限制。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxvpnstatus--vpnstatusservice"></a>

### `ctx.vpnStatus` — `VpnStatusService`

Owns one non-overlapping external check and a bounded-lifetime cached result.

```ts cordis-catalog
/** Read cached verification only; never triggers network I/O.
 * @param signal - optional Remote carrier cancellation; this synchronous cache read performs no I/O.
 * @returns current sample, or unknown after its expiry.
 */
@Remote('read') read(signal?: AbortSignal): VpnStatusSnapshot
```

Source: [`packages/host/vpn-status/src/index.ts`](../../packages/host/vpn-status/src/index.ts)
<!-- END GENERATED cordis-surface -->
