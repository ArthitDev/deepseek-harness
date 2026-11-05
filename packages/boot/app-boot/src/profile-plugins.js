/** Installed profile dependencies and their bundle activation after package-manager operations. */
import { join } from 'node:path';
import { assertBundlePlatform } from "./bundle-platform.js";
import { readProfileManifest, resolveBundleDir, writeProfileManifest } from "./profile.js";
/** Unavailable installed metadata must not prevent listing or removing dependencies. */
function optionalManifest(binName, packageDir) {
    try {
        return readProfileManifest(binName, packageDir);
    }
    catch {
        return undefined;
    }
}
/** Resolve activation metadata with the same installation precedence as profile loading. */
function bundleManifest(location, name) {
    let packageDir;
    try {
        packageDir = resolveBundleDir(location.binName, name, location.installAnchor, location.profileDir);
    }
    catch {
        // An unresolved dependency remains visible as an ordinary package.
        return undefined;
    }
    return optionalManifest(location.binName, packageDir);
}
/**
 * Read installed versions and bundle declarations without requiring loadable plugin code.
 * Missing or unreadable installed metadata leaves the dependency visible for repair or removal.
 * @param location - profile and installation resolution inputs.
 * @returns dependency records in package.json order and the profile manifest.
 */
export function readProfilePlugins(location) {
    const manifest = readProfileManifest(location.binName, location.profileDir);
    const bundles = manifest.dsh?.profile?.bundles ?? [];
    const dependencies = Object.entries(manifest.dependencies ?? {}).map(([name, spec]) => {
        const installed = optionalManifest(location.binName, join(location.profileDir, 'node_modules', name));
        return {
            name,
            version: typeof installed?.version === 'string' ? installed.version : spec,
            bundle: bundleManifest(location, name)?.dsh?.bundle?.patch !== undefined,
            enabled: bundles.includes(name),
        };
    });
    return { manifest, dependencies };
}
/**
 * Write a bundle list while preserving the supplied profile's other metadata.
 * @param profileDir - directory whose package.json is updated.
 * @param manifest - current profile manifest, read after the package operation when applicable.
 * @param bundles - ordered active bundle names, including any template entries.
 * @returns the written manifest.
 */
export function writeProfileBundles(profileDir, manifest, bundles) {
    const updated = { ...manifest, dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles] } } };
    writeProfileManifest(profileDir, updated);
    return updated;
}
/**
 * Reconcile installed bundle declarations after a successful package-manager operation.
 * Dependency-managed entries disappear when removed or when their package loses its declaration;
 * template entries retain their order and duplicates. New bundle dependencies activate automatically.
 * @param options - location, inventory captured before pnpm, and whether explicitly disabled bundles remain disabled.
 * @returns updated inventory and newly added ordinary dependencies for caller-owned warnings.
 * @throws If a new selection has invalid platform metadata or excludes the Host. Installed dependencies
 * remain; no bundle selection changes are written.
 */
export function reconcileProfilePlugins(options) {
    const after = readProfilePlugins(options);
    const beforeNames = new Set(options.before.dependencies.map(dependency => dependency.name));
    const afterNames = new Set(after.dependencies.map(dependency => dependency.name));
    const bundleNames = new Set(after.dependencies.filter(dependency => dependency.bundle).map(dependency => dependency.name));
    const disabled = new Set(options.preserveDisabled
        ? options.before.dependencies.filter(dependency => dependency.bundle && !dependency.enabled).map(dependency => dependency.name)
        : []);
    const previous = after.manifest.dsh?.profile?.bundles ?? [];
    const bundles = previous.filter(name => !(beforeNames.has(name) || afterNames.has(name)) || bundleNames.has(name));
    for (const dependency of after.dependencies) {
        if (dependency.bundle && !disabled.has(dependency.name) && !bundles.includes(dependency.name)) {
            assertBundlePlatform(bundleManifest(options, dependency.name)?.dsh?.bundle?.platforms, process.platform);
            bundles.push(dependency.name);
        }
    }
    const changed = bundles.length !== previous.length || bundles.some((name, index) => name !== previous[index]);
    const manifest = changed ? writeProfileBundles(options.profileDir, after.manifest, bundles) : after.manifest;
    return {
        plugins: {
            manifest,
            dependencies: after.dependencies.map(dependency => ({ ...dependency, enabled: bundles.includes(dependency.name) })),
        },
        addedPlainDependencies: after.dependencies.filter(dependency => !dependency.bundle && !beforeNames.has(dependency.name))
            .map(dependency => dependency.name),
    };
}
//# sourceMappingURL=profile-plugins.js.map