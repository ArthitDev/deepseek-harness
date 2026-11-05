/** Configuration-free snapshots captured before a failed startup disposes its plugins. */
import { Context } from '@deepseek-ai/cordis';
/** One configured entry at the time startup failed. */
export interface StartupPluginState {
    readonly id: string;
    readonly module: string;
    readonly version: string;
    readonly state: 'disabled' | 'active' | 'pending' | 'failed' | 'disposed' | 'loading' | 'unloading';
    /** Loader source URL; individual overlay ownership may be unavailable. */
    readonly source: string;
    readonly missing: readonly string[];
}
/** Observed registrations for one service missing from a consumer. */
export interface StartupServiceState {
    readonly consumer: string;
    readonly service: string;
    /** Empty means no registration was observed, not that no configured plugin can provide it. */
    readonly providers: readonly {
        readonly entry: string;
        readonly state: string;
        readonly visibility: 'same-scope' | 'other-scope';
    }[];
}
/** Bounded startup state without plugin config, service values, or logger arguments. */
export interface StartupCompositionDiagnostic {
    readonly plugins: readonly StartupPluginState[];
    readonly services: readonly StartupServiceState[];
    readonly omittedPlugins: number;
    readonly omittedServices: number;
}
/**
 * Capture Loader state and registered service ownership before teardown.
 * Providers that never registered cannot be inferred from their package names.
 * @param ctx - Live application context with its Loader still mounted.
 * @returns At most 256 plugin rows and 256 missing-service observations, with omission counts.
 */
export declare function captureStartupComposition(ctx: Context): StartupCompositionDiagnostic;
//# sourceMappingURL=startup-diagnostics.d.ts.map