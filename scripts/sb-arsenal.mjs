// sb-arsenal.mjs — ESM facade over the CJS implementation (single source of truth).
// The harness is an ESM/TypeScript monorepo; this shim lets packages import
// the arsenal cleanly while the CLI keeps using sb-arsenal.cjs directly.
import { createRequire } from 'node:module';

const { TOOLS, dispatch, listTools, runInKali } = createRequire(import.meta.url)('./sb-arsenal.cjs');

export { TOOLS, dispatch, listTools, runInKali };
