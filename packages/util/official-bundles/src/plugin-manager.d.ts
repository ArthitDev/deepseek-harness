/** The package names the plugin manager protects, hides, orders, or marks experimental. */
/**
 * Plugin packages the plugin manager refuses to disable or remove, because management itself needs them; a bundle that
 * contains one is read-only as well. Removing a name drops only this `management-required` refusal; the manager's own
 * entry, installation-carried bundles, and unaddressable rows stay protected by their own rules.
 */
export declare const PROTECTED_PLUGINS: ReadonlySet<string>;
/**
 * Built-in profile bundles, persistent terminals, and the standalone worktree tool, which have no plugin manager page.
 * Their Host availability and activation stay intact.
 */
export declare const HIDDEN_BUNDLES: ReadonlySet<string>;
/**
 * The optional bundles the plugin manager's main and More lists rank first, in this order. {@link MORE_BUNDLES}, not
 * this list, decides whether a bundle appears on the main list.
 */
export declare const EXTENSION_BUNDLES: readonly string[];
/**
 * The optional bundles the plugin manager's main list leaves out until the profile enables them; its More list,
 * which includes every eligible bundle, ranks them last in this order.
 */
export declare const MORE_BUNDLES: readonly string[];
/** Official bundles the plugin manager marks with the Experimental badge. */
export declare const EXPERIMENTAL_BUNDLES: ReadonlySet<string>;
//# sourceMappingURL=plugin-manager.d.ts.map