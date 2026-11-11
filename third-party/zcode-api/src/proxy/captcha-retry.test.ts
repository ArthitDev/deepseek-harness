/**
 * Tests for the shared captcha challenge detection + retry seam
 * (src/proxy/captcha-retry.ts), extracted from the two hand-rolled copies in
 * handler.ts and responses-handler.ts (CL-20 / CL-08 / CL-14).
 */
import { describe, it, expect } from "bun:test";
import { gzipSync } from "node:zlib";
import { detectInBodyChallenge, isCaptchaChallenged, retryOnCaptchaChallenge, resolveCaptchaAcquireBudgetMs, acquireCaptchaWithRetry, type CaptchaModuleLike } from "./captcha-retry.js";

function challengeBytes(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ code: 3007, msg: "captcha verify failed" }));
}

/** Wrap bytes as a BodyInit-safe plain ArrayBuffer (bun-types strictness). */
function bytesBody(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

const PARAM_HEADER = "x-aliyun-captcha-verify-param";
const REGION_HEADER = "x-aliyun-captcha-verify-region";

describe("detectInBodyChallenge", () => {
  it("detects the challenge in a plain 400 JSON body", async () => {
    const resp = new Response(bytesBody(challengeBytes()), { status: 400, headers: { "content-type": "application/json" } });
    expect(await detectInBodyChallenge(resp)).toBe(true);
  });

  it("detects the challenge in a gzip body labeled content-encoding: gzip (passthrough bytes)", async () => {
    // Bun fetch `decompress:false` / ordered raw-TCP passthrough deliver the
    // raw compressed bytes with the header intact — the peek must inflate first.
    const resp = new Response(bytesBody(gzipSync(challengeBytes())), {
      status: 400,
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
    });
    expect(await detectInBodyChallenge(resp)).toBe(true);
  });

  it("sniffs as-is when the body is labeled gzip but already inflated (Node undici semantics)", async () => {
    const resp = new Response(bytesBody(challengeBytes()), {
      status: 400,
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
    });
    expect(await detectInBodyChallenge(resp)).toBe(true);
  });

  it("returns false for ok responses and SSE content types", async () => {
    const ok = new Response(bytesBody(challengeBytes()), { status: 200, headers: { "content-type": "application/json" } });
    expect(await detectInBodyChallenge(ok)).toBe(false);
    const sse = new Response(bytesBody(challengeBytes()), { status: 400, headers: { "content-type": "text/event-stream" } });
    expect(await detectInBodyChallenge(sse)).toBe(false);
  });

  it("returns false for a non-challenge error body", async () => {
    const resp = new Response(JSON.stringify({ code: 1001, msg: "other" }), { status: 400, headers: { "content-type": "application/json" } });
    expect(await detectInBodyChallenge(resp)).toBe(false);
  });

  it("leaves the original response body consumable after the peek", async () => {
    const resp = new Response(bytesBody(challengeBytes()), { status: 400, headers: { "content-type": "application/json" } });
    await detectInBodyChallenge(resp);
    const text = await resp.text();
    expect(text).toContain("3007");
  });
});

describe("isCaptchaChallenged", () => {
  const headerDetector = (resp: Response): string | null => resp.headers.get(PARAM_HEADER);

  it("header variant wins without touching the body", async () => {
    const resp = new Response("denied", { status: 403, headers: { [PARAM_HEADER]: "challenge-xyz" } });
    expect(await isCaptchaChallenged(resp, { detectCaptchaChallenge: headerDetector })).toBe(true);
  });

  it("falls through to the in-body variant", async () => {
    const resp = new Response(bytesBody(challengeBytes()), { status: 400, headers: { "content-type": "application/json" } });
    expect(await isCaptchaChallenged(resp, { detectCaptchaChallenge: headerDetector })).toBe(true);
  });
});

function fakeCaptcha(opts?: { failSolve?: boolean }): CaptchaModuleLike {
  return {
    RETRY_HEADERS: { PARAM: PARAM_HEADER, REGION: REGION_HEADER },
    detectCaptchaChallenge: (resp: Response) => resp.headers.get(PARAM_HEADER),
    getCaptchaToken: async () => {
      if (opts?.failSolve) throw new Error("solver exploded");
      return { verifyParam: "fresh-token", region: "cn" };
    },
  };
}

describe("retryOnCaptchaChallenge", () => {
  it("cancels the challenged body, re-solves, and re-dispatches once with fresh headers", async () => {
    let cancelled = false;
    const challenged = new Response(bytesBody(challengeBytes()), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    const origCancel = challenged.body!.cancel.bind(challenged.body);
    challenged.body!.cancel = () => {
      cancelled = true;
      return origCancel();
    };

    let retryHeaders: Record<string, string> | undefined;
    const outcome = await retryOnCaptchaChallenge({
      captcha: fakeCaptcha(),
      appVersion: "3.11.2",
      challengedResp: challenged,
      solveAndRetry: async (headers) => {
        retryHeaders = headers;
        return new Response("recovered", { status: 200 });
      },
      mapError: (err) => new Response(`unexpected:${err.message}`, { status: 599 }),
    });

    expect(cancelled).toBe(true);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.resp.status).toBe(200);
      expect(await outcome.resp.text()).toBe("recovered");
    }
    expect(retryHeaders![PARAM_HEADER]).toBe("fresh-token");
    expect(retryHeaders![REGION_HEADER]).toBe("cn");
  });

  it("solver failure maps to the 'solver' phase (ok:false, terminal)", async () => {
    const challenged = new Response(bytesBody(challengeBytes()), { status: 400 });
    const phases: string[] = [];
    const outcome = await retryOnCaptchaChallenge({
      captcha: fakeCaptcha({ failSolve: true }),
      appVersion: "3.11.2",
      challengedResp: challenged,
      solveAndRetry: async () => {
        throw new Error("must not be reached");
      },
      mapError: (err, phase) => {
        phases.push(phase);
        return new Response(err.message, { status: phase === "solver" ? 503 : 502 });
      },
    });
    expect(phases).toEqual(["solver"]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.resp.status).toBe(503);
  });

  it("retry dispatch network failure maps to the 'dispatch' phase (502, not mislabeled 503)", async () => {
    const challenged = new Response(bytesBody(challengeBytes()), { status: 400 });
    const phases: string[] = [];
    const outcome = await retryOnCaptchaChallenge({
      captcha: fakeCaptcha(),
      appVersion: "3.11.2",
      challengedResp: challenged,
      solveAndRetry: async () => {
        throw new Error("connection reset");
      },
      mapError: (err, phase) => {
        phases.push(phase);
        return new Response(err.message, { status: phase === "solver" ? 503 : 502 });
      },
    });
    expect(phases).toEqual(["dispatch"]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.resp.status).toBe(502);
  });
});

describe("resolveCaptchaAcquireBudgetMs (§H)", () => {
  it("equivalence classes: undefined/empty/non-numeric/zero/negative → default 45s; valid numerics pass through", () => {
    for (const raw of [undefined, "", "abc", "0", "-5000"]) {
      expect(resolveCaptchaAcquireBudgetMs(raw)).toBe(45_000);
    }
    expect(resolveCaptchaAcquireBudgetMs("10")).toBe(10);
    expect(resolveCaptchaAcquireBudgetMs("120000")).toBe(120_000);
  });
});

describe("acquireCaptchaWithRetry", () => {
  it("keeps the authoritative disabled result without retrying", async () => {
    let attempts = 0;
    expect(await acquireCaptchaWithRetry(async () => { attempts++; return null; }, { budgetMs: 1000 })).toBeNull();
    expect(attempts).toBe(1);
  });

  it("does not start a new attempt after backoff exhausts the budget", async () => {
    let attempts = 0;
    await expect(acquireCaptchaWithRetry(async () => {
      attempts++;
      throw new Error("configs unavailable");
    }, { budgetMs: 25 })).rejects.toThrow("configs unavailable");
    expect(attempts).toBe(1);
  });

  it("bounds a stalled attempt and ignores its late result", async () => {
    let attempts = 0;
    let resolveToken!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { resolveToken = resolve; });
    try {
      await expect(acquireCaptchaWithRetry(() => { attempts++; return pending; }, { budgetMs: 25 })).rejects.toThrow("timed out");
    } finally {
      resolveToken("late-token");
    }
    await Promise.resolve();
    expect(attempts).toBe(1);
  });

  it("rejects a result completed beyond the deadline even before the timer runs", async () => {
    let now = 0;
    await expect(acquireCaptchaWithRetry(async () => {
      now = 1001;
      return "late-token";
    }, { budgetMs: 1000, now: () => now })).rejects.toThrow("timed out");
  });

  it("retries a transient failure while time remains", async () => {
    let attempts = 0;
    const result = await acquireCaptchaWithRetry(async () => {
      if (++attempts === 1) throw new Error("temporary failure");
      return "fresh-token";
    }, { budgetMs: 4000 });
    expect(result).toBe("fresh-token");
    expect(attempts).toBe(2);
  });

  it("stops waiting on client abort and does not acquire for an already aborted client", async () => {
    const controller = new AbortController();
    const reason = new Error("client disconnected");
    let attempts = 0;
    let resolveToken!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { resolveToken = resolve; });
    const result = acquireCaptchaWithRetry(() => { attempts++; return pending; }, { budgetMs: 1000, signal: controller.signal });
    await Promise.resolve();
    controller.abort(reason);
    try {
      await expect(result).rejects.toThrow("client disconnected");
      await expect(acquireCaptchaWithRetry(() => { attempts++; return pending; }, { budgetMs: 1000, signal: controller.signal })).rejects.toThrow("client disconnected");
      expect(attempts).toBe(1);
    } finally {
      resolveToken("late-token");
    }
  });
});
