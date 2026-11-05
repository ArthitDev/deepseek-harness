// sb-executor.mjs — ESM facade over the CJS implementation (single source of truth).
import { createRequire } from 'node:module';

const { extractCodeBlocks, classifyEnvironment, execute, runChain, analyzeResult, CONFIG } =
  createRequire(import.meta.url)('./sb-executor.cjs');

export { extractCodeBlocks, classifyEnvironment, execute, runChain, analyzeResult, CONFIG };
