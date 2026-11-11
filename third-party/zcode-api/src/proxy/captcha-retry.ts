/**
 * Shared captcha (3007) challenge detection + single-retry flow.
 *
 * The challenge arrives in two variants (observed 2026-08-29, PR #38):
 *   1. response-header variant — `x-aliyun-captcha-verify-param` set on a
 *      non-2xx response (`captcha.detectCaptchaChallenge`);
 *   2. in-body variant — HTTP 400 with `{"code":3007,...}` in the JSON body
 *      and no captcha header.
 *
 * Both the chat hot path (handler.ts) and /v1/responses (responses-handler.ts)
 * used to hand-roll this detection and the re-solve/retry, and the copies had
 * drifted (error mapping, peek handling). This module is the unified seam.
 *
 * Runtime-import discipline: only TYPE imports from ./captcha.js — the real
 * module (which drags in the happy-dom solver) is lazily loaded by the
 * callers and passed in as a value, so non-start-plan processes never pay
 * its startup cost.
 */
import type * as CaptchaExports from "./captcha.js";

/** Shape the callers pass in — satisfied by the real captcha module or test fakes. */
export type CaptchaModuleLike = Pick<typeof CaptchaExports, "detectCaptchaChallenge" | "getCaptchaToken" | "RETRY_HEADERS">
  & Partial<Pick<typeof CaptchaExports, "noteDemand">>;

/** Magic strings of the in-body challenge, for both JSON spacing styles. */
const IN_BODY_CHALLENGE_MARKERS = ['"code":3007', '"code": 3007'] as const;

/** Bound on how many raw (possibly compressed) body bytes a challenge peek reads. */
const MAX_CHALLENGE_PEEK_BYTES = 64 * 1024;

/** Bound on decompressed sniff output — error bodies are small; more is waste. */
const MAX_SNIFF_INFLATED_BYTES = 256 * 1024;

/**
 * CAPTCHA_ACQUIRE_BUDGET_MS → bounded acquire budget (NOTEPAD "3.16.3 增补" §H).
 * Non-numeric / non-finite values fall back to the default: a NaN budget
 * would turn the deadline into NaN, making `Date.now() >= deadline` never
 * true — the bounded-retry contract degenerates into an unbounded (and, with
 * an instantly-throwing solver, hot-spinning) loop.
 */
export function resolveCaptchaAcquireBudgetMs(raw: string | undefined): number {
  const parsed = Number(raw ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 45_000;
}

/**
 * Bound the entire initial acquisition, including a stalled attempt and retry
 * backoff (2026-10-24 review of NOTEPAD §H). Timeout/abort only stops this
 * caller's wait: the process-wide config fetch and pool may serve other callers.
 * A late token is ignored and can never trigger another attempt or dispatch.
 */
export async function acquireCaptchaWithRetry<T>(
  acquire: () => Promise<T>,
  options: { budgetMs: number; signal?: AbortSignal; now?: () => number; onRetry?: (err: Error) => void },
): Promise<T> {
  const now = options.now ?? Date.now;
  const deadline = now() + options.budgetMs;
  const signal = options.signal;
  let lastError: Error | undefined;
  let stopped: Error | undefined;
  const timeoutError = (): Error => new Error(`Captcha acquisition timed out after ${options.budgetMs}ms${lastError ? `: ${lastError.message}` : ""}`);
  const checkActive = (): void => {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Captcha acquisition aborted");
    if (stopped) throw stopped;
    if (now() >= deadline) throw timeoutError();
  };
  checkActive();

  let rejectStop!: (err: Error) => void;
  const stop = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  const onAbort = (): void => {
    stopped = signal?.reason instanceof Error ? signal.reason : new Error("Captcha acquisition aborted");
    rejectStop(stopped);
  };
  const timer = setTimeout(() => {
    stopped = timeoutError();
    rejectStop(stopped);
  }, options.budgetMs);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      checkActive();
      try {
        const value = await Promise.race([Promise.resolve().then(() => {
          checkActive();
          return acquire();
        }), stop]);
        checkActive();
        return value;
      } catch (err) {
        checkActive();
        lastError = err instanceof Error ? err : new Error(String(err));
        options.onRetry?.(lastError);
      }
      let backoff: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          new Promise<void>((resolve) => { backoff = setTimeout(resolve, Math.min(2_000, Math.max(0, deadline - now()))); }),
          stop,
        ]);
      } finally {
        if (backoff !== undefined) clearTimeout(backoff);
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Peek (bounded) the body of a non-ok, non-SSE response and detect the
 * in-body 3007 challenge. The response stays consumable for the error path:
 * the peek reads a CLONE, so the original body is untouched.
 *
 * Covers both passthrough transports where the body may arrive still
 * gzip-compressed (Bun fetch `decompress:false`, ordered raw-TCP): when the
 * response advertises `content-encoding: gzip|x-gzip`, the peek inflates
 * before sniffing. On a runtime that already auto-inflated the body while
 * keeping the header (Node undici), inflation fails and the raw bytes are
 * sniffed as-is.
 */
export async function detectInBodyChallenge(resp: Response): Promise<boolean> {
  if (resp.ok) return false;
  const ctype = resp.headers.get("content-type") ?? "";
  if (ctype.includes("text/event-stream")) return false;
  let bytes: Uint8Array;
  try {
    bytes = await peekBodyBytes(resp, MAX_CHALLENGE_PEEK_BYTES);
  } catch {
    return false;
  }
  if (bytes.byteLength === 0) return false;
  const text = await decodeMaybeGzip(bytes, resp.headers.get("content-encoding"));
  return IN_BODY_CHALLENGE_MARKERS.some((marker) => text.includes(marker));
}

/** Unified challenge check: response-header variant first, then in-body peek. */
export async function isCaptchaChallenged(
  resp: Response,
  captcha: Pick<typeof CaptchaExports, "detectCaptchaChallenge">,
): Promise<boolean> {
  if (captcha.detectCaptchaChallenge(resp) !== null) return true;
  return detectInBodyChallenge(resp);
}

export interface CaptchaRetryArgs {
  captcha: CaptchaModuleLike;
  appVersion: string;
  /** The challenged response; its body is cancelled before the retry. */
  challengedResp: Response;
  /** Dispatch the retry. Receives the fresh captcha headers; must return the upstream Response. */
  solveAndRetry: (retryHeaders: Record<string, string>) => Promise<Response>;
  /**
   * Error mapping (unified contract, mirrors handler.ts's correct shape):
   *   "solver"   → the re-solve (getCaptchaToken) failed
   *   "dispatch" → the retry dispatch failed at the network level
   */
  mapError: (err: Error, phase: "solver" | "dispatch") => Response;
  /** Optional debug line sink. */
  debug?: (message: string) => void;
}

/**
 * Shared single-retry flow for a detected captcha challenge: cancel the old
 * body, re-solve a fresh token, rebuild + re-dispatch ONCE (the challenged
 * token was already consumed by this request). Never loops.
 *
 * The caller MUST return `ok:false` responses directly to the client — they
 * are already fully-formed error responses (solver → 503 captcha_solver_failed,
 * dispatch → 502 upstream_unreachable); feeding them back through the
 * upstream `!ok` branch would wrap the error body a second time.
 */
export async function retryOnCaptchaChallenge(args: CaptchaRetryArgs): Promise<{ ok: true; resp: Response } | { ok: false; resp: Response }> {
  const { captcha, appVersion, challengedResp, solveAndRetry, mapError, debug } = args;
  debug?.("captcha challenge — re-solving and retrying once");
  try {
    await challengedResp.body?.cancel();
  } catch {
    // already drained/cancelled
  }
  let fresh: { verifyParam: string; region: string } | null;
  try {
    fresh = await captcha.getCaptchaToken(appVersion);
  } catch (err) {
    return { ok: false, resp: mapError(err as Error, "solver") };
  }
  if (!fresh) {
    // Config flipped to disabled mid-flight — a challenge arrived while the
    // resolver can no longer mint. Treat as solver failure (single retry).
    return { ok: false, resp: mapError(new Error("captcha disabled while challenge arrived"), "solver") };
  }
  const retryHeaders: Record<string, string> = {
    [captcha.RETRY_HEADERS.PARAM]: fresh.verifyParam,
    [captcha.RETRY_HEADERS.REGION]: fresh.region,
  };
  try {
    return { ok: true, resp: await solveAndRetry(retryHeaders) };
  } catch (err) {
    return { ok: false, resp: mapError(err as Error, "dispatch") };
  }
}

/** Read at most `limit` bytes from a clone of the response body. */
async function peekBodyBytes(resp: Response, limit: number): Promise<Uint8Array> {
  const body = resp.clone().body;
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.byteLength;
      if (total >= limit) break;
    }
  } finally {
    reader.cancel().catch(() => {});
    reader.releaseLock?.();
  }
  const all = Buffer.concat(parts);
  return all.byteLength > limit ? all.subarray(0, limit) : all;
}

/**
 * Decode sniff bytes, inflating first when the response is labeled gzip.
 * TextDecoder is non-fatal, so invalid UTF-8 degrades to replacement chars —
 * the ASCII magic strings still match.
 */
async function decodeMaybeGzip(bytes: Uint8Array, encodingHeader: string | null): Promise<string> {
  const enc = encodingHeader?.toLowerCase().trim() ?? "";
  if (enc === "gzip" || enc === "x-gzip") {
    try {
      return new TextDecoder().decode(await inflateBounded(bytes));
    } catch {
      // Runtime already inflated the body while keeping the header (Node
      // undici) — sniff the bytes as-is.
    }
  }
  return new TextDecoder().decode(bytes);
}

async function inflateBounded(bytes: Uint8Array): Promise<Uint8Array> {
  const gunzip = new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(gunzip).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.byteLength;
      if (total >= MAX_SNIFF_INFLATED_BYTES) break;
    }
  } finally {
    reader.cancel().catch(() => {});
    reader.releaseLock?.();
  }
  return Buffer.concat(parts);
}
