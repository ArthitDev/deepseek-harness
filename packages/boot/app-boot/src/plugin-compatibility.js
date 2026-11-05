/** Evaluate plugin dsh requirements (`engines.dsh`, else dsh peers) without importing plugin code. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
function objectOf(value, field) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${field} must be an object`);
    }
    return value;
}
function runtimeVersionOf(value) {
    if (typeof value !== 'string' || semver.valid(value) === null) {
        throw new Error(`Invalid dsh runtime version: ${JSON.stringify(value)}; expected a semantic version`);
    }
    return value;
}
function identityField(manifest, field) {
    const value = Object.hasOwn(manifest, field) ? manifest[field] : undefined;
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`Plugin manifest ${field} must be a non-empty string when dsh requirements are unmet`);
    }
    return value;
}
/**
 * Read this app-boot package's version in both source and bundled installations.
 * @returns the validated runtime semantic version, preserving its exact spelling.
 * @throws if package.json cannot be read or its version is missing or invalid.
 */
export function getDshRuntimeVersion() {
    // The executable's virtual filesystem intercepts string paths, not URL arguments.
    const filename = fileURLToPath(new URL('../package.json', import.meta.url));
    const manifest = objectOf(JSON.parse(fs.readFileSync(filename, 'utf8')), 'app-boot package.json');
    return runtimeVersionOf(Object.hasOwn(manifest, 'version') ? manifest.version : undefined);
}
function satisfies(runtimeVersion, range) {
    return range.trim() !== '' && semver.satisfies(runtimeVersion, range, { includePrerelease: true });
}
function unmetRequirements(fields, runtimeVersion) {
    const engines = Object.hasOwn(fields, 'engines') ? objectOf(fields.engines, 'Plugin manifest engines') : {};
    if (Object.hasOwn(engines, 'dsh')) {
        const range = engines.dsh;
        if (typeof range !== 'string')
            throw new Error('Plugin manifest engines.dsh must be a string');
        return satisfies(runtimeVersion, range) ? {} : { 'engines.dsh': range };
    }
    if (!Object.hasOwn(fields, 'peerDependencies'))
        return {};
    const dependencies = objectOf(fields.peerDependencies, 'Plugin manifest peerDependencies');
    const unmet = {};
    for (const [name, range] of Object.entries(dependencies)) {
        if (typeof range !== 'string') {
            throw new Error(`Plugin manifest peerDependencies[${JSON.stringify(name)}] must be a string`);
        }
        if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-'))
            continue;
        const requirement = ['workspace:^', 'workspace:~', 'workspace:*'].includes(range) ? runtimeVersion : range;
        if (!satisfies(runtimeVersion, requirement))
            unmet[name] = range;
    }
    return unmet;
}
/**
 * Check the plugin's dsh requirements against the runtime. An own `engines.dsh` range decides alone and
 * peerDependencies are ignored; otherwise every @deepseek-ai/dsh or @deepseek-ai/dsh-* peer must match.
 * Prereleases participate in ranges. For peers only, workspace:^, workspace:~, and workspace:* refer to
 * the current runtime; other empty or invalid ranges, including any workspace: `engines.dsh`, are unmet.
 * @param manifest - parsed plugin package.json; inherited fields are ignored.
 * @param exemptions - exact plugin name@version keys mapped to exact runtime versions.
 * @param runtimeVersion - running dsh version, defaulting to this app-boot package.
 * @returns unmet requirements and exemption status, or undefined when every requirement is met.
 * @throws for malformed manifest engines or peer fields, invalid runtime versions, or missing identity on a mismatch.
 */
export function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion()) {
    runtimeVersionOf(runtimeVersion);
    const fields = objectOf(manifest, 'Plugin manifest');
    const requirements = unmetRequirements(fields, runtimeVersion);
    if (Object.keys(requirements).length === 0)
        return undefined;
    const name = identityField(fields, 'name');
    const version = identityField(fields, 'version');
    const key = `${name}@${version}`;
    const exemptedVersions = Object.hasOwn(exemptions, key) ? exemptions[key] : undefined;
    const exempted = exemptedVersions?.includes(runtimeVersion) === true;
    return { name, version, runtimeVersion, requirements, exempted };
}
/**
 * Describe unmet requirements, their risk, and the exact-version remedy.
 * Surfaces with their own grant mechanism or locale render the structured result themselves.
 * @param issue - incompatible plugin/runtime result, including exempted mismatches.
 * @returns an English diagnostic for logs and stderr.
 */
export function pluginCompatibilityWarning(issue) {
    const key = `${issue.name}@${issue.version}`;
    return `Plugin ${key} is incompatible with dsh ${issue.runtimeVersion}: requirements ${JSON.stringify(issue.requirements)}. `
        + 'Running it may cause crashes or data loss. '
        + 'Update the plugin or install a plugin version compatible with this dsh runtime. '
        + `To accept this risk explicitly, grant the exact-version exemption for ${key} on dsh ${issue.runtimeVersion} with \`dsh plugin allow-version\` or the plugin manager, then retry the installation or restart dsh. `
        + `Exact-version exemption: ${issue.exempted ? 'active' : 'not active'}.`;
}
//# sourceMappingURL=plugin-compatibility.js.map