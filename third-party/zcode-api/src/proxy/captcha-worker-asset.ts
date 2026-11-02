// @ts-nocheck — the file-asset import below is a Bun extension with no type
// declaration.
/**
 * captcha-worker-asset.ts — sole carrier of Bun's `with { type: "file" }`
 * import: it is what embeds the pre-bundled worker into `bun build --compile`
 * binaries (`new Worker(new URL(...))` does not survive compilation).
 *
 * esbuild (the Android server bundle) REJECTS the attribute at parse time
 * ("Importing with a type attribute of 'file' is not supported"), so this
 * file must stay out of the esbuild graph — build:android-bundle marks it
 * --external — and importers must reach it via DYNAMIC import only: the
 * asset is a gitignored build input whose absence means "solve in-process"
 * (see captcha-worker-dispatch.ts).
 */
import entryPath from "./captcha-worker-entry.bundle.js" with { type: "file" };

export default entryPath;
