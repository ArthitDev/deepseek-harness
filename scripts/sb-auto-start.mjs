// sb-auto-start.mjs — ESM facade over the CJS implementation (single source of truth).
import { createRequire } from 'node:module';

const { startDaemon, stopDaemon, status, install, detectEnvironment, startProxy, checkPortAlive } =
  createRequire(import.meta.url)('./sb-auto-start.cjs');

export { startDaemon, stopDaemon, status, install, detectEnvironment, startProxy, checkPortAlive };
