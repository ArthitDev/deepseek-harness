/** Package metadata resolved through one runtime interception. */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import { barePackageName, installRuntimeInterception, registerWorkerResolution, } from "./resolver.js";
import { ProfileRuntimeResolution } from "../profile.js";
import { readPluginMeta } from "../package-meta.js";
function readPackage(dir, fallbackName) {
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath))
        return undefined;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const name = manifest.name;
    const version = manifest.version;
    return {
        name: typeof name === 'string' ? name : fallbackName,
        version: typeof version === 'string' ? version : undefined,
        dir,
        manifestPath,
        manifest,
    };
}
/** Package lookup shared by metadata consumers in one profile process. */
export class PluginPackages extends Service {
    packages = new Map();
    interception;
    disposeWorkerResolution;
    current;
    constructor(ctx, config = {}) {
        super(ctx, 'pluginPackages');
        if (config.resolution === undefined)
            return;
        this.current = config.resolution;
        const interception = installRuntimeInterception(config.resolution);
        this.disposeWorkerResolution = registerWorkerResolution(config.resolution);
        this.interception = interception;
        ctx.effect(() => () => {
            this.disposeWorkerResolution?.();
            interception.dispose();
        }, 'profile package resolution');
    }
    /** The published runtime resolution, or `undefined` when Node resolves packages alone. */
    get resolution() {
        return this.current;
    }
    /**
     * Publish a complete successor generation for this process and subsequently created Workers.
     * Profile mappings and local package names may be removed after their plugins stop; linked roots may also be removed.
     * Retained profile mappings may change their declarer and version, but not their normalized directory or scope;
     * installation mappings must remain unchanged. Publication does not unload modules or clear Node caches.
     * @param successor - fully constructed generation accepted by {@link RuntimeInterception.replace}.
     */
    replace(successor) {
        if (this.interception === undefined)
            throw new Error('plugin-packages: runtime resolution is not installed');
        this.interception.replace(successor);
        this.current = successor;
        this.packages = new Map();
        this.disposeWorkerResolution?.();
        this.disposeWorkerResolution = registerWorkerResolution(successor);
    }
    /**
     * Publish the latest generation computed by the installed resolution through {@link replace}. Package contents
     * and loaded modules are not reloaded.
     * @throws when no resolution is installed, it is plain data rather than a {@link ProfileRuntimeResolution},
     * reading the latest files fails, or the successor is rejected. A computed resolution without a profile can refresh.
     */
    async refresh() {
        if (!(this.current instanceof ProfileRuntimeResolution)) {
            throw new Error('plugin-packages: the installed runtime resolution cannot be recomputed');
        }
        this.replace(await this.current.computeLatestResolution());
    }
    /**
     * Locate the package named by a specifier without requiring a package export.
     * @param specifier - module specifier whose package owns the requested module.
     * @param parentURL - URL whose Node lookup order applies.
     * @returns the parsed package, or undefined when no package owns the request.
     */
    packageOf(specifier, parentURL) {
        const name = barePackageName(specifier);
        if (name === undefined)
            return undefined;
        const dir = this.interception === undefined
            ? packageDirFromParent(name, parentURL)
            : this.interception.packageDir(name, parentURL);
        if (dir === undefined)
            return undefined;
        const key = JSON.stringify({ dir, name });
        if (!this.packages.has(key))
            this.packages.set(key, readPackage(dir, name));
        return this.packages.get(key);
    }
    /**
     * Read display metadata without loading or activating the target plugin.
     * @param specifier - configured package module, including package subpaths.
     * @param parentURL - owning Loader tree's resolution base.
     * @returns local display metadata or its diagnostic; undefined for non-package requests or absent metadata.
     */
    metaOf(specifier, parentURL) {
        return readPluginMeta(specifier, parentURL);
    }
}
function packageDirFromParent(name, parentURL) {
    for (const searchPath of createRequire(parentURL).resolve.paths(name)) {
        const candidate = join(searchPath, name);
        if (existsSync(join(candidate, 'package.json')))
            return candidate;
    }
    return undefined;
}
//# sourceMappingURL=service.js.map