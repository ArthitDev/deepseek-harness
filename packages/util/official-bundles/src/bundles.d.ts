/** The bundle package names the dsh installation selects, offers, installs on demand, or retires. */
/** Installation-owned defaults used when a shipped profile is first opened. */
export interface ProfileTemplate {
    /** Ordered bundle layer list. */
    bundles: readonly string[];
}
/** The shipped profile templates auto-initialized on first use, by name. */
export declare const PROFILE_TEMPLATES: Record<string, ProfileTemplate>;
/**
 * Installation-owned bundle tuples that an earlier release wrote into a shipped profile; app-boot replaces an exact
 * match with the {@link PROFILE_TEMPLATES} entry of the same name and leaves every other list untouched.
 */
export declare const INSTALLATION_OWNED_PROFILE_TUPLES: Readonly<Record<string, readonly string[]>>;
/** Bundles an earlier release shipped and the installation no longer carries; app-boot removes them from profiles. */
export declare const RETIRED_BUNDLES: ReadonlySet<string>;
/** The bundle list a `dsh plugin` init uses for a name with no shipped template. */
export declare const DEFAULT_PROFILE_BUNDLES: readonly string[];
/**
 * The bundles the dsh installation ships for a person to switch on: each a
 * runtime dependency of the installation that declares `dsh.bundle.patch`,
 * an `icon`, and `./locale/*.json` display metadata, selected by no shipped
 * template, and offered switched off by the plugin manager except persistent
 * terminals, which have no page switch
 * ([rationale](../../../../.agents/notes/implemented/process/2026-09-15-shipped-optional-bundles.md),
 * [admission](../../../../.agents/notes/implemented/architecture/2026-09-21-experimental-capabilities-as-optional-bundles.md)).
 */
export declare const OPTIONAL_BUNDLES: readonly string[];
/** Public DSH release members available through the ordinary on-demand bundle installer. */
export declare const ON_DEMAND_BUNDLES: readonly string[];
//# sourceMappingURL=bundles.d.ts.map