/** Launcher-owned profile locations and composition inputs. */
import { join } from 'node:path';
import { composeEntries, loadProfileDirectory, PROFILE_PATCH_FILENAME } from "./profile.js";
import { loadOptionalPatches } from "./index.js";
const TELEMETRY_ROW_ID = 'session-telemetry-otel';
/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake. A composition without the telemetry row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated — custom profiles need not mount telemetry to run with the
 * switch set.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv, hasRow) {
    if ((disabledEnv ?? '') === '' || !hasRow)
        return undefined;
    return { id: TELEMETRY_ROW_ID, disabled: true };
}
/** Read the selected bundles' patches, which apply before the profile patch file.
 * @param binName Diagnostic prefix for malformed or missing configuration.
 * @param context Data supplied by the profile launcher.
 * @param initialProfile Already loaded startup profile; omitted reads the current files.
 * @returns Bundle patches in application order.
 */
export function readBundlePatches(binName, context, initialProfile) {
    const profile = initialProfile ?? loadProfileDirectory(binName, context.dir, context.installAnchor, { userLayer: false });
    return profile.layers.flatMap(layer => layer.patches);
}
/** Read current bundle and user layers with the launch-time overlays.
 * @param binName Diagnostic prefix for malformed or missing configuration.
 * @param context Data supplied by the profile launcher.
 * @param initialProfile Already loaded startup profile; omitted reads the current files.
 * @returns Detached ordered patches; this function does not update the Loader.
 */
export function readProfilePatches(binName, context, initialProfile) {
    const patches = structuredClone([
        ...readBundlePatches(binName, context, initialProfile),
        ...(initialProfile?.patches ?? loadOptionalPatches(binName, context.patchPath) ?? []),
        ...(loadOptionalPatches(binName, join(context.home, PROFILE_PATCH_FILENAME)) ?? []),
        ...context.overlays,
    ]);
    const telemetryPatch = resolveTelemetryPatch(context.telemetryDisabledEnv, composeEntries([patches]).some(row => row.id === TELEMETRY_ROW_ID));
    if (telemetryPatch !== undefined)
        patches.push(telemetryPatch);
    return patches;
}
//# sourceMappingURL=profile-context.js.map