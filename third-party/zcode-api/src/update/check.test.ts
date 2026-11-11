/**
 * Tests for `src/update/check.ts` — the CLI/TUI update notice (issue #60).
 *
 * Every case injects a mock transport: the suite never touches the network,
 * and the "silent failure" contract (which the Android checker documents, and
 * which is why this module deliberately has no throwing path) is what most of
 * these assertions are about.
 */
import { describe, it, expect } from "bun:test";
import {
  LATEST_RELEASE_API,
  RELEASES_PAGE,
  buildUpdateNotice,
  checkForUpdate,
  createUpdateCheckQueue,
  detectContainerRuntime,
  fetchLatestRelease,
  isNewerVersion,
  isSkippedVersion,
  parseVersion,
  updateCheckEnabled,
  updateCommand,
  type FetchLike,
} from "./check.js";

const RELEASE_URL = `${RELEASES_PAGE}/tag/v4.7.6`;
const BODY = { tag_name: "v4.7.6", html_url: RELEASE_URL, body: "release notes" };

function respondWith(body: unknown, status = 200): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function rejecting(): FetchLike {
  return async () => {
    throw new Error("getaddrinfo ENOTFOUND api.github.com");
  };
}

describe("isNewerVersion", () => {
  it("detects a newer patch/minor/major release", () => {
    expect(isNewerVersion("4.7.5", "v4.7.6")).toBe(true);
    expect(isNewerVersion("4.7.5", "v4.8.0")).toBe(true);
    expect(isNewerVersion("4.7.5", "v5.0.0")).toBe(true);
  });

  it("compares numerically, not as strings", () => {
    expect(isNewerVersion("4.7.5", "v4.10.0")).toBe(true);
    expect(isNewerVersion("4.9.0", "v4.10.0")).toBe(true);
    expect(isNewerVersion("4.7.10", "v4.7.9")).toBe(false);
  });

  it("is false for the same or an older tag", () => {
    expect(isNewerVersion("4.7.5", "v4.7.5")).toBe(false);
    expect(isNewerVersion("4.7.5", "v4.7.4")).toBe(false);
    expect(isNewerVersion("4.7.5", "4.7.5")).toBe(false);
  });

  it("accepts the variant suffixes this repository actually uses", () => {
    // Real tags: v4.7.2.android, v4.5.4-AppOverhaul, v2.0.5.alpha, v1.4.7.alpha.
    expect(isNewerVersion("4.7.5", "v4.7.6-android")).toBe(true);
    expect(isNewerVersion("4.7.5", "v4.7.6-rc.1")).toBe(true);
    expect(isNewerVersion("4.7.1", "v4.7.2.android")).toBe(true);
    expect(isNewerVersion("4.5.4", "v4.5.4-AppOverhaul")).toBe(false);
    expect(isNewerVersion("4.7.5", "v4.8")).toBe(true);
    expect(isNewerVersion("4.7.5", "4.8")).toBe(true);
  });

  it("never reports a malformed tag as newer", () => {
    expect(isNewerVersion("4.7.5", "latest")).toBe(false);
    expect(isNewerVersion("4.7.5", "")).toBe(false);
    expect(isNewerVersion("not-a-version", "v9.9.9")).toBe(false);
    // Unseparated junk must not decay into a version core.
    expect(isNewerVersion("4.7.5", "v4.7.6garbage")).toBe(false);
    expect(isNewerVersion("4.7.5", "v4.7.6garbage-android")).toBe(false);
    // A fourth numeric segment is not a version we understand.
    expect(isNewerVersion("4.7.5", "v4.7.6.1")).toBe(false);
    expect(isNewerVersion("4.7.5", "v4.7.6-")).toBe(false);
    expect(isNewerVersion("4.7.5", "Windows")).toBe(false);
  });
});

describe("parseVersion", () => {
  it("parses the numeric core and zero-fills missing segments", () => {
    expect(parseVersion("v4.7.6")).toEqual([4, 7, 6]);
    expect(parseVersion("4.8")).toEqual([4, 8, 0]);
    expect(parseVersion("5")).toEqual([5, 0, 0]);
    expect(parseVersion("v4.7.6-rc.1")).toEqual([4, 7, 6]);
    expect(parseVersion("v4.7.2.android")).toEqual([4, 7, 2]);
  });

  it("returns null when there is no numeric core", () => {
    expect(parseVersion("master")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("v4.7.6garbage")).toBeNull();
    expect(parseVersion("v4.7.6.1")).toBeNull();
  });
});

describe("updateCheckEnabled", () => {
  it("is on by default and for explicit truthy values", () => {
    expect(updateCheckEnabled({})).toBe(true);
    expect(updateCheckEnabled({ ZCODE_UPDATE_CHECK: "" })).toBe(true);
    expect(updateCheckEnabled({ ZCODE_UPDATE_CHECK: "1" })).toBe(true);
    expect(updateCheckEnabled({ ZCODE_UPDATE_CHECK: "on" })).toBe(true);
  });

  it("is off for every documented off value, case/space insensitive", () => {
    for (const value of ["0", "off", "OFF", " off ", "false", "no", "disabled"]) {
      expect(updateCheckEnabled({ ZCODE_UPDATE_CHECK: value })).toBe(false);
    }
  });
});

describe("isSkippedVersion", () => {
  it("matches muted tags regardless of the v prefix and whitespace", () => {
    expect(isSkippedVersion("v4.7.6", { ZCODE_UPDATE_SKIP: "v4.7.6" })).toBe(true);
    expect(isSkippedVersion("4.7.6", { ZCODE_UPDATE_SKIP: " v4.7.6 , v4.7.7 " })).toBe(true);
    expect(isSkippedVersion("v4.7.6-android", { ZCODE_UPDATE_SKIP: "4.7.6" })).toBe(true);
  });

  it("does not mute anything else", () => {
    expect(isSkippedVersion("v4.7.6", {})).toBe(false);
    expect(isSkippedVersion("v4.7.6", { ZCODE_UPDATE_SKIP: "v4.7.5" })).toBe(false);
    expect(isSkippedVersion("v4.7.6", { ZCODE_UPDATE_SKIP: "   " })).toBe(false);
    // A malformed tag has no core, so it can neither be muted nor compared.
    expect(isSkippedVersion("v4.7.6garbage", { ZCODE_UPDATE_SKIP: "v4.7.6" })).toBe(false);
  });
});

describe("detectContainerRuntime", () => {
  it("attributes the Docker and Podman markers", () => {
    expect(detectContainerRuntime({}, (p) => p === "/.dockerenv")).toBe("docker");
    expect(detectContainerRuntime({}, (p) => p === "/run/.containerenv")).toBe("podman");
  });

  it("reads systemd's `container=` declaration", () => {
    expect(detectContainerRuntime({ container: "podman" }, () => false)).toBe("podman");
    expect(detectContainerRuntime({ container: "docker" }, () => false)).toBe("docker");
    expect(detectContainerRuntime({ container: " Docker " }, () => false)).toBe("docker");
  });

  it("reports an unknown container instead of guessing Docker", () => {
    expect(detectContainerRuntime({ container: "lxc" }, () => false)).toBe("unknown");
    expect(detectContainerRuntime({ container: "systemd-nspawn" }, () => false)).toBe("unknown");
  });

  it("is null on a bare host", () => {
    expect(detectContainerRuntime({}, () => false)).toBeNull();
    expect(detectContainerRuntime({ container: "   " }, () => false)).toBeNull();
  });
});

describe("updateCommand", () => {
  const release = { tag: "v4.7.6", url: RELEASE_URL, notes: null };

  it("names a command that exists in the detected runtime", () => {
    expect(updateCommand(release, "docker")).toBe("docker compose pull && docker compose up -d");
    expect(updateCommand(release, "podman")).toBe("podman compose pull && podman compose up -d");
    expect(updateCommand(release, "unknown")).toBe("pull the new image and recreate the container");
    expect(updateCommand(release, null)).toBe(`re-download from ${RELEASE_URL}`);
  });
});

describe("buildUpdateNotice", () => {
  const release = { tag: "v4.7.6", url: RELEASE_URL, notes: null };

  it("points container users at their runtime and binaries at the release asset", () => {
    expect(buildUpdateNotice("4.7.5", release, "docker").text).toContain("docker compose pull && docker compose up -d");
    expect(buildUpdateNotice("4.7.5", release, "podman").text).toContain("podman compose pull && podman compose up -d");
    expect(buildUpdateNotice("4.7.5", release, "unknown").text).toContain("pull the new image and recreate the container");
    expect(buildUpdateNotice("4.7.5", release, null).text).toContain(`re-download from ${RELEASE_URL}`);
    expect(buildUpdateNotice("4.7.5", release, null).text).toContain("v4.7.6 is available (you are on v4.7.5)");
  });
});

describe("fetchLatestRelease", () => {
  it("parses tag, url and notes from the releases API", async () => {
    const release = await fetchLatestRelease({ fetchImpl: respondWith(BODY) });
    expect(release).toEqual({ tag: "v4.7.6", url: RELEASE_URL, notes: "release notes" });
  });

  it("sends the User-Agent GitHub requires, plus a timeout signal", async () => {
    let seenUrl = "";
    let seenInit: { headers?: Record<string, string>; signal?: AbortSignal } | undefined;
    const probe: FetchLike = async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return { ok: true, status: 200, json: async () => BODY };
    };
    await fetchLatestRelease({ fetchImpl: probe });
    expect(seenUrl).toBe(LATEST_RELEASE_API);
    expect(seenInit?.headers?.["User-Agent"]).toBeTruthy();
    expect(seenInit?.headers?.Accept).toBe("application/vnd.github+json");
    expect(seenInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back to the releases page when html_url is missing", async () => {
    const release = await fetchLatestRelease({ fetchImpl: respondWith({ tag_name: "v4.7.6" }) });
    expect(release?.url).toBe(`${RELEASES_PAGE}/tag/v4.7.6`);
    expect(release?.notes).toBeNull();
  });

  it("returns null instead of throwing for every failure mode", async () => {
    expect(await fetchLatestRelease({ fetchImpl: rejecting() })).toBeNull();
    expect(await fetchLatestRelease({ fetchImpl: respondWith(BODY, 403) })).toBeNull();
    expect(await fetchLatestRelease({ fetchImpl: respondWith(BODY, 404) })).toBeNull();
    expect(await fetchLatestRelease({ fetchImpl: respondWith(BODY, 500) })).toBeNull();
    expect(await fetchLatestRelease({ fetchImpl: respondWith(null) })).toBeNull();
    expect(await fetchLatestRelease({ fetchImpl: respondWith({ tag_name: "" }) })).toBeNull();
    expect(await fetchLatestRelease({ fetchImpl: respondWith({ tag_name: 42 }) })).toBeNull();
    const badJson: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    });
    expect(await fetchLatestRelease({ fetchImpl: badJson })).toBeNull();
  });
});

describe("checkForUpdate", () => {
  it("reports an update with the runtime-aware command", async () => {
    const result = await checkForUpdate("4.7.5", {
      fetchImpl: respondWith(BODY),
      env: {},
      containerRuntime: "docker",
    });
    expect(result.kind).toBe("update");
    if (result.kind !== "update") return;
    expect(result.notice.latest).toBe("v4.7.6");
    expect(result.notice.text).toContain("docker compose pull && docker compose up -d");
  });

  it("uses the Podman command when Podman is the detected runtime", async () => {
    const result = await checkForUpdate("4.7.5", {
      fetchImpl: respondWith(BODY),
      env: {},
      containerRuntime: "podman",
    });
    expect(result.kind).toBe("update");
    if (result.kind !== "update") return;
    expect(result.notice.text).toContain("podman compose pull && podman compose up -d");
  });

  it("detects the runtime from the environment when not overridden", async () => {
    const result = await checkForUpdate("4.7.5", {
      fetchImpl: respondWith(BODY),
      env: { container: "podman" },
    });
    expect(result.kind).toBe("update");
    if (result.kind !== "update") return;
    expect(result.notice.text).toContain("podman compose pull && podman compose up -d");
  });

  it("uses the download hint outside a container", async () => {
    const result = await checkForUpdate("4.7.5", { fetchImpl: respondWith(BODY), env: {}, containerRuntime: null });
    expect(result.kind).toBe("update");
    if (result.kind !== "update") return;
    expect(result.notice.text).toContain(RELEASE_URL);
  });

  it("is up-to-date for equal and older releases", async () => {
    expect((await checkForUpdate("4.7.6", { fetchImpl: respondWith(BODY), env: {} })).kind).toBe("up-to-date");
    expect((await checkForUpdate("4.8.0", { fetchImpl: respondWith(BODY), env: {} })).kind).toBe("up-to-date");
  });

  it("is up-to-date for a malformed tag instead of nagging", async () => {
    const result = await checkForUpdate("4.7.5", {
      fetchImpl: respondWith({ tag_name: "v4.7.6garbage" }),
      env: {},
    });
    expect(result.kind).toBe("up-to-date");
  });

  it("skips disabled checks without even calling the network", async () => {
    let calls = 0;
    const counting: FetchLike = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => BODY };
    };
    const result = await checkForUpdate("4.7.5", { fetchImpl: counting, env: { ZCODE_UPDATE_CHECK: "off" } });
    expect(result.kind).toBe("unavailable");
    expect(calls).toBe(0);
  });

  it("honours the skip list, and a manual check overrides it", async () => {
    const env = { ZCODE_UPDATE_SKIP: "v4.7.6" };
    expect((await checkForUpdate("4.7.5", { fetchImpl: respondWith(BODY), env })).kind).toBe("skipped");
    expect((await checkForUpdate("4.7.5", { fetchImpl: respondWith(BODY), env, force: true })).kind).toBe("update");
    // A manual check is also allowed while the automatic one is disabled.
    const off = { ZCODE_UPDATE_CHECK: "off" };
    expect((await checkForUpdate("4.7.5", { fetchImpl: respondWith(BODY), env: off, force: true })).kind).toBe("update");
  });

  it("reports unavailable when the network fails, never throwing", async () => {
    const result = await checkForUpdate("4.7.5", { fetchImpl: rejecting(), env: {} });
    expect(result.kind).toBe("unavailable");
  });
});

describe("createUpdateCheckQueue", () => {
  function gate(): { promise: Promise<void>; open: () => void } {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  }

  it("runs immediately when idle", async () => {
    const calls: boolean[] = [];
    const queue = createUpdateCheckQueue(async (manual) => {
      calls.push(manual);
    });
    await queue();
    await queue(true);
    expect(calls).toEqual([false, true]);
  });

  it("queues a manual check that arrives while one is in flight", async () => {
    const pending = gate();
    const calls: boolean[] = [];
    const queue = createUpdateCheckQueue(async (manual) => {
      calls.push(manual);
      if (calls.length === 1) await pending.promise;
    });

    const startup = queue(false);
    const manual = queue(true); // `u` while the startup check is still running
    expect(calls).toEqual([false]); // queued, not dropped

    pending.open();
    await Promise.all([startup, manual]);
    expect(calls).toEqual([false, true]); // the queued manual run did happen
  });

  it("drops an automatic duplicate and coalesces repeated manual presses", async () => {
    const pending = gate();
    const calls: boolean[] = [];
    const queue = createUpdateCheckQueue(async (manual) => {
      calls.push(manual);
      if (calls.length === 1) await pending.promise;
    });

    const startup = queue();
    const duplicate = queue();
    const manual = queue(true);
    const secondPress = queue(true);
    expect(calls).toEqual([false]);

    pending.open();
    await Promise.all([startup, duplicate, manual, secondPress]);
    expect(calls).toEqual([false, true]);
  });
});
