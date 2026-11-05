/** Host operating-system admission for optional bundle layers. */
/** A valid bundle declaration excludes the operating system running DSH. */
export declare class UnsupportedBundlePlatformError extends Error {
    /**
     * @param platforms Node platform names supported by the bundle.
     * @param platform Operating system of the DSH Host.
     */
    constructor(platforms: readonly string[], platform: string);
}
/**
 * Validate package metadata and reject an unsupported Host before selecting or composing a bundle.
 * @param platforms The optional `dsh.bundle.platforms` field read from package.json.
 * @param platform Operating system of the DSH Host, from Node's `process.platform`.
 * @throws When the declaration is malformed or excludes the Host; omission allows every platform.
 */
export declare function assertBundlePlatform(platforms: unknown, platform: string): void;
//# sourceMappingURL=bundle-platform.d.ts.map