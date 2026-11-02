/**
 * Bundles the captcha worker entry into a self-contained ESM file for
 * embedding as a `with { type: "file" }` asset in the compiled single-file
 * binary. Raw .ts assets are NOT parsed by Bun at extraction (they'd be
 * evaluated as plain JS and fail on type annotations), so the worker must
 * be pre-bundled to plain JS.
 *
 * Run before `bun build --compile` (every build:* script chains it):
 *   bun run scripts/build-fork-worker.ts
 * Output: src/proxy/captcha-worker-entry.bundle.js (gitignored build input)
 */
import { build } from "bun";

const result = await build({
  entrypoints: ["./src/proxy/captcha-worker-entry.ts"],
  outdir: "./src/proxy",
  target: "bun",
  format: "esm",
  naming: { entry: "[dir]/[name].bundle.[ext]" },
  minify: false,
  external: [],
});

for (const log of result.logs) console.log(String(log));
if (!result.success) throw new AggregateError(result.logs, "Captcha worker build failed");
console.log(`captcha worker bundled: ${result.outputs.map((o) => o.path).join(", ")}`);
