/**
 * Solver backend dispatch.
 *
 * Backend (ZCODE_CAPTCHA_BACKEND): "happy" (default) — the happy-dom solver
 * in src/proxy/captcha-happy.ts. Execution (one worker thread per solve, a
 * persistent warm pool on Android / in-process fallback where no entry is
 * available — issue #54) lives in captcha-worker-dispatch.ts.
 */
import { solveViaWorkerOrInProcess, stopCaptchaWorkers } from "./captcha-worker-dispatch.js";

const BACKEND = process.env.ZCODE_CAPTCHA_BACKEND?.trim().toLowerCase() || "happy";
let concurrency = 3;
let active = 0;
let peakActive = 0;
let completed = 0;
let failed = 0;
let stopped = false;
interface PendingSolve {
  start: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pending: PendingSolve[] = [];

function drain(): void {
  while (!stopped && active < concurrency && pending.length > 0) {
    const task = pending.shift()!;
    clearTimeout(task.timer);
    task.start();
  }
}

export async function runCaptchaSolve(scene: string, region: string, prefix: string): Promise<string> {
  if (BACKEND !== "happy") {
    throw new Error(`captcha backend "${BACKEND}" is not available; use ZCODE_CAPTCHA_BACKEND=happy`);
  }
  if (stopped) throw new Error("captcha solver is stopped");
  const waitMs = Number(process.env.CAPTCHA_SOLVE_TIMEOUT_MS || 20_000);
  if (!Number.isFinite(waitMs) || waitMs <= 0) throw new Error("Invalid CAPTCHA_SOLVE_TIMEOUT_MS");
  return new Promise<string>((resolve, reject) => {
    const task: PendingSolve = {
      reject,
      timer: setTimeout(() => {
        const index = pending.indexOf(task);
        if (index < 0) return;
        pending.splice(index, 1);
        failed++;
        reject(new Error(`captcha solver queue timeout (${waitMs}ms)`));
      }, waitMs),
      start: () => {
        active++;
        peakActive = Math.max(peakActive, active);
        void solveViaWorkerOrInProcess({ scene, region, prefix }).then(
          param => { completed++; resolve(param); },
          error => { failed++; reject(error); },
        ).finally(() => { active--; drain(); });
      },
    };
    pending.push(task);
    drain();
  });
}

/** Bound all background, prefill, and request-driven solves across the process. */
export function setCaptchaSolverConcurrency(n: number): void {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("Invalid CAPTCHA solve concurrency");
  concurrency = n;
  stopped = false;
  drain();
}

/** Worker-per-solve terminates itself; the persistent warm pool
 *  (ZCODE_CAPTCHA_WARM_WORKERS, Android) is terminated here — called by the
 *  stopCaptchaPool / shutdownCaptcha chain. */
export function shutdownCaptchaSolver(): void {
  stopped = true;
  for (const task of pending.splice(0)) {
    clearTimeout(task.timer);
    task.reject(new Error("captcha solver stopped before execution"));
  }
  stopCaptchaWorkers();
}

export function captchaSolverConcurrency(): number {
  return concurrency;
}

/** Aggregate work counts only; contains no challenge data, tokens, or credentials. */
export function captchaSolverStats(): { active: number; queued: number; limit: number; peakActive: number; completed: number; failed: number } {
  return { active, queued: pending.length, limit: concurrency, peakActive, completed, failed };
}
