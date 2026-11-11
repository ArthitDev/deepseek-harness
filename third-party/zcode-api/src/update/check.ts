/**
 * Update notice (issue #60) — the CLI/TUI counterpart of the Android app's
 * `UpdateChecker`. The Android rules are ported as-is so both ends agree on
 * what "newer" means:
 *
 *   - ask the GitHub releases API for the newest tag (`/releases/latest`
 *     already excludes prereleases),
 *   - compare major.minor.patch numerically — never as strings,
 *   - fail silently: a blocked, slow or offline network must never affect
 *     startup, and a malformed release must not nag forever,
 *   - a manual check may still report "already latest" / "unavailable" to the
 *     caller; the automatic startup check stays quiet.
 *
 * Zero new dependencies (global fetch) and no long-lived timers: the request
 * carries an `AbortController` deadline that is `unref`ed, so a stalled
 * connection can neither hang a one-shot CLI nor keep a process alive.
 *
 * Container images are immutable, so "self-update" is not offered on either
 * platform; the notice names the pull command of the detected runtime (Docker,
 * Podman) and falls back to a runtime-agnostic "pull and recreate" hint when
 * the container userland cannot be told apart. A real in-place updater would
 * additionally need checksums published in the release (the artifacts have none
 * today) — see the issue.
 */
import { existsSync } from "node:fs";

/** Newest stable release (the API excludes prereleases). */
export const LATEST_RELEASE_API = "https://api.github.com/repos/TriDefender/zcode-api/releases/latest";
/** Human-facing releases page, used for the "how to update" hint. */
export const RELEASES_PAGE = "https://github.com/TriDefender/zcode-api/releases";
/**
 * GitHub answers 403 to requests without a User-Agent — the Android checker
 * carries an explicit one for exactly this reason.
 */
const USER_AGENT = "zcode-proxy-update-check";
const REQUEST_TIMEOUT_MS = 10_000;
/** `ZCODE_UPDATE_CHECK=off` disables the automatic startup check. */
const UPDATE_CHECK_ENV = "ZCODE_UPDATE_CHECK";
/** `ZCODE_UPDATE_SKIP=v4.7.6,v4.7.7` mutes specific tags (Android's skipped_tag). */
const UPDATE_SKIP_ENV = "ZCODE_UPDATE_SKIP";
const DISABLED_VALUES = new Set(["0", "false", "off", "no", "disable", "disabled"]);

type Env = Record<string, string | undefined>;

/**
 * Minimal fetch surface (structural): lets tests inject canned responses and
 * failures without constructing a real `Response`.
 */
export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

export interface ReleaseInfo {
  tag: string;
  url: string;
  notes: string | null;
}

export interface UpdateNotice {
  current: string;
  latest: string;
  url: string;
  text: string;
}

export type UpdateCheckResult =
  | { kind: "update"; notice: UpdateNotice }
  | { kind: "up-to-date"; latest: string }
  | { kind: "skipped"; latest: string }
  /** Offline, blocked, malformed answer, or the check is disabled. */
  | { kind: "unavailable" };

/**
 * Container userland behind the running process, used to pick the update hint:
 * `docker` and `podman` get their own command, `unknown` (a container marker we
 * cannot attribute, e.g. `container=lxc`) gets a runtime-agnostic one, and a
 * bare host (`null`) gets the release download link.
 */
export type ContainerRuntime = "docker" | "podman" | "unknown";

export interface UpdateCheckOptions {
  /** Injected transport (tests). Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  env?: Env;
  /** Container detection override (tests); defaults to probing the markers. */
  containerRuntime?: ContainerRuntime | null;
  /** Manual check: ignores `ZCODE_UPDATE_CHECK=off` and the skip list. */
  force?: boolean;
}

/** Automatic check is on unless `ZCODE_UPDATE_CHECK` is an explicit off value. */
export function updateCheckEnabled(env: Env = process.env): boolean {
  return !DISABLED_VALUES.has((env[UPDATE_CHECK_ENV] ?? "").trim().toLowerCase());
}

/**
 * Accepted release-tag shape: an optional `v`, one to three numeric segments,
 * and an optional, explicitly separated variant suffix — `v4.7.5`, `4.8`,
 * `v4.7.2.android`, `v4.5.4-AppOverhaul`, `v4.7.6-rc.1`. The end anchor is what
 * keeps `v4.7.6garbage` (as well as `v4.7.6.1`, `Windows`, `latest`) from being
 * read as `4.7.6` and nagging forever: no version core means "never newer".
 */
const VERSION_TAG = /^v?(\d+(?:\.\d+){0,2})(?:[.-][A-Za-z][0-9A-Za-z.-]*)?$/;

/** `v4.7.2.android` → `4.7.2`; `""` when the tag is not a release version. */
function versionCore(tag: string): string {
  const match = VERSION_TAG.exec(tag.trim());
  return match ? match[1] : "";
}

/** Comma-separated muted tags; `v` prefixes and variant suffixes are ignored. */
export function isSkippedVersion(tag: string, env: Env = process.env): boolean {
  const wanted = versionCore(tag);
  if (!wanted) return false;
  return (env[UPDATE_SKIP_ENV] ?? "")
    .split(",")
    .map((part) => versionCore(part))
    .some((muted) => muted !== "" && muted === wanted);
}

/** `[major, minor, patch]`, missing segments defaulting to 0; null when unparsable. */
export function parseVersion(tag: string): [number, number, number] | null {
  const core = versionCore(tag);
  if (!core) return null;
  const parts = core.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Android's rule (`UpdateChecker.isNewer`): compare the three numeric segments
 * in order. An unparsable tag is never "newer" — otherwise a single malformed
 * release would nag every user on every start.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const running = parseVersion(current);
  const candidate = parseVersion(latest);
  if (!running || !candidate) return false;
  for (let i = 0; i < 3; i++) {
    if (candidate[i] !== running[i]) return candidate[i] > running[i];
  }
  return false;
}

/**
 * Tell apart the container userland so the hint names a command that exists
 * there. `/.dockerenv` is Docker's marker, `/run/.containerenv` is Podman's,
 * and systemd exports `container=` inside containers (useful on Windows/WSL and
 * for other runtimes). Anything else that declares itself a container is
 * reported as `unknown` instead of being guessed as Docker.
 */
export function detectContainerRuntime(
  env: Env = process.env,
  exists: (path: string) => boolean = existsSync,
): ContainerRuntime | null {
  if (exists("/.dockerenv")) return "docker";
  if (exists("/run/.containerenv")) return "podman";
  const declared = (env.container ?? "").trim().toLowerCase();
  if (declared.includes("podman")) return "podman";
  if (declared.includes("docker")) return "docker";
  return declared === "" ? null : "unknown";
}

/** Update hint for the detected runtime; the image is immutable either way. */
export function updateCommand(release: ReleaseInfo, runtime: ContainerRuntime | null): string {
  switch (runtime) {
    case "docker":
      return "docker compose pull && docker compose up -d";
    case "podman":
      return "podman compose pull && podman compose up -d";
    case "unknown":
      return "pull the new image and recreate the container";
    default:
      return `re-download from ${release.url}`;
  }
}

export function buildUpdateNotice(
  current: string,
  release: ReleaseInfo,
  runtime: ContainerRuntime | null,
): UpdateNotice {
  return {
    current,
    latest: release.tag,
    url: release.url,
    text: `${release.tag} is available (you are on v${current}) — ${updateCommand(release, runtime)}`,
  };
}

/**
 * Ask the releases API for the newest tag. Returns null for every failure mode
 * — DNS/TLS/proxy interference, timeout, non-2xx (rate limit, 404), truncated
 * or unexpected JSON — because the caller must never treat "cannot check" as an
 * error (the Android checker documents the same contract).
 */
export async function fetchLatestRelease(opts: UpdateCheckOptions = {}): Promise<ReleaseInfo | null> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  // A pending update check must never hold the process open.
  const unref = (timer as unknown as { unref?: () => void }).unref;
  if (typeof unref === "function") unref.call(timer);
  try {
    const response = await fetchImpl(LATEST_RELEASE_API, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown; body?: unknown } | null;
    const tag = typeof body?.tag_name === "string" ? body.tag_name.trim() : "";
    if (!tag) return null;
    const url =
      typeof body?.html_url === "string" && body.html_url.length > 0
        ? body.html_url
        : `${RELEASES_PAGE}/tag/${tag}`;
    return { tag, url, notes: typeof body?.body === "string" ? body.body : null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Full check for `current`: newest release → numeric compare → skip list →
 * runtime-aware hint. Never throws.
 */
export async function checkForUpdate(current: string, opts: UpdateCheckOptions = {}): Promise<UpdateCheckResult> {
  const env = opts.env ?? process.env;
  if (!opts.force && !updateCheckEnabled(env)) return { kind: "unavailable" };
  const release = await fetchLatestRelease(opts);
  if (!release) return { kind: "unavailable" };
  if (!isNewerVersion(current, release.tag)) return { kind: "up-to-date", latest: release.tag };
  if (!opts.force && isSkippedVersion(release.tag, env)) return { kind: "skipped", latest: release.tag };
  const runtime = opts.containerRuntime !== undefined ? opts.containerRuntime : detectContainerRuntime(env);
  return { kind: "update", notice: buildUpdateNotice(current, release, runtime) };
}

/**
 * Single-flight scheduler for the startup / manual update check. While a check
 * is running, another automatic call is dropped (the startup check answers it
 * anyway) but a manual call is queued and re-run once the current request
 * settles — pressing `u` during the startup check must still produce its own
 * answer, and the startup result cannot be reused because it may have been
 * disabled by `ZCODE_UPDATE_CHECK=off` or muted by `ZCODE_UPDATE_SKIP`.
 * Repeated presses collapse into one queued check.
 */
export function createUpdateCheckQueue(run: (manual: boolean) => Promise<void>): (manual?: boolean) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let manualQueued = false;

  async function start(manual: boolean): Promise<void> {
    const current = (async () => {
      try {
        await run(manual);
      } finally {
        inFlight = null;
      }
    })();
    inFlight = current;
    await current;
    if (manualQueued) {
      manualQueued = false;
      await start(true);
    }
  }

  return (manual = false) => {
    if (inFlight) {
      if (manual) manualQueued = true;
      return inFlight;
    }
    return start(manual);
  };
}
