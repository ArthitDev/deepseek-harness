/**
 * Deployment-level target-scope policy. Every tool call's arguments are read
 * as candidate network targets (the shared normalized vocabulary) and judged
 * against the operator's configured authorized/excluded scope before the tool
 * body runs; a denied call becomes a structured failed result with the
 * `SCOPE_DENIED` code. This is the opt-in enforcement half of the Dead Mode
 * posture: it binds plain sessions and executor episodes alike, without any
 * shipped default.
 *
 * Ceiling: hostname authorization stays text-based and the resolved-address
 * check compares each answer against excluded IP-literal entries only — the
 * connection itself is not pinned here, so a DNS rebinding race between this
 * check and the tool's own connection remains possible (network confinement
 * in the shell sandbox closes that; this plugin does not).
 *
 * @module @deepseek-ai/dsh-scope-policy
 */

import { lookup as systemLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  extractArgumentTargets, formatPentestNetworkTarget, normalizePentestTarget, pentestPathCovers,
  pentestTargetMatches, type PentestNetworkTarget,
} from '@deepseek-ai/dsh-pentest-run'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** The structured error `code` on every denied tool result. */
export const SCOPE_DENIED = 'SCOPE_DENIED'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'scope-policy'

/** Deterministic reason one tool call was denied by the scope policy. */
export const SCOPE_POLICY_RULES = [
  'excluded_target', 'outside_authorized', 'unparseable_target',
  'unsupported_protocol', 'resolved_excluded', 'unresolved_host',
] as const
/** Deterministic reason one tool call was denied by the scope policy. */
export type ScopePolicyRule = typeof SCOPE_POLICY_RULES[number]

/** One answer returned by the address resolver for one candidate hostname. */
export interface ResolvedAddress {
  readonly address: string
  readonly family: number
}

/** The resolver the plugin queries for each non-literal candidate hostname. */
export type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>

/**
 * Plugin config, validated at load: every scope entry must parse
 * (`host[:port][/path]` forms), `allowedSchemes` must be non-empty lowercase
 * scheme tokens. An empty `authorizedTargets` list is unrestricted on hosts —
 * only exclusions then bind.
 */
export interface Config {
  /** Hosts the run may touch; empty means every host is authorized. */
  authorizedTargets?: string[]
  /** Hosts refused even when authorized (`http://10.0.0.8`, `host:port`, `host/path`). */
  excludedTargets?: string[]
  /** URL schemes a tool call may reference (default `['http', 'https', 'ws', 'wss']`). */
  allowedSchemes?: string[]
  /** Resolve each hostname and refuse answers that hit an excluded IP literal (default `true`). */
  resolveAddresses?: boolean
}

export const Config: z<Config> = z.object({
  authorizedTargets: z.array(z.string()).default([]),
  excludedTargets: z.array(z.string()).default([]),
  allowedSchemes: z.array(z.string()).default(['http', 'https', 'ws', 'wss']),
  resolveAddresses: z.boolean().default(true),
})

const DENIAL_PHRASES: Readonly<Record<ScopePolicyRule, string>> = {
  excluded_target: 'is an excluded target',
  outside_authorized: 'is outside the authorized targets',
  unparseable_target: 'is not a parsable target and scope enforcement is active',
  unsupported_protocol: 'uses a scheme outside the allowed protocol list',
  resolved_excluded: 'resolves to an excluded address',
  unresolved_host: 'could not be resolved and scope enforcement is active',
}

/** Bound one raw value inside the denial message. */
function truncateDenialText(raw: string): string {
  return raw.length <= 120 ? raw : `${raw.slice(0, 117)}...`
}

/**
 * The structured result substituted for a denied call. `error.info` carries
 * the rule and normalized target so a UI can render why the policy refused.
 * @param rule - the policy rule that rejected the call.
 * @param display - the model-visible rejected value.
 * @param target - normalized target form, when one exists.
 */
function deniedResult(rule: ScopePolicyRule, display: string, target?: string): ToolExecutionResult {
  const message = `denied by scope policy: '${display}' ${DENIAL_PHRASES[rule]}`
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: {
      message,
      info: {
        name: 'ScopePolicyError',
        code: SCOPE_DENIED,
        reason: target === undefined ? rule : `${rule} target=${target}`,
      },
    },
  }
}

/** Scheme tokens referenced anywhere in a serialized argument text. */
const SCHEME_TOKEN_PATTERN = /(^|[^a-z0-9+.-])([a-z][a-z0-9+.-]*):\/\//gi

/** Whether one host token is an IP literal (`isIP` reads the bracketed form as invalid). */
function isIpLiteral(host: string): boolean {
  return isIP(host.replace(/^\[|\]$/g, '')) !== 0
}

/** System DNS narrowed to the plugin's all-answers shape. */
const resolveWithSystemDns: AddressResolver = hostname => systemLookup(hostname, { all: true, order: 'verbatim' })

/**
 * Validate scope entries and schemes fail-loud, then register the waterfall.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param config - validated {@link Config}; scope entries are re-checked here.
 * @param resolve - resolver override for focused tests; defaults to system DNS.
 */
export function apply(ctx: Context, config: Config, resolve: AddressResolver = resolveWithSystemDns): void {
  const parseScope = (target: string): PentestNetworkTarget => {
    const parsed = normalizePentestTarget(target)
    if (parsed === undefined) {
      throw new Error(`scope-policy: scope target '${target}' is not a parsable URL, host:port, or host form`)
    }
    return parsed
  }
  // schemastery's .default() guarantees the fields are set after validation.
  const authorized = (config.authorizedTargets as string[]).map(parseScope)
  const excluded = (config.excludedTargets as string[]).map(parseScope)
  const schemes = new Set((config.allowedSchemes as string[]).map(value => value.toLowerCase()))
  if (schemes.size === 0) throw new Error('scope-policy: `allowedSchemes` must not be empty')
  for (const scheme of schemes) {
    if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
      throw new Error(`scope-policy: invalid scheme token '${scheme}'`)
    }
  }
  const resolves = config.resolveAddresses as boolean && (excluded.length > 0 || authorized.length > 0)
  const excludedAddresses = new Set(
    excluded.filter(scope => isIpLiteral(scope.host)).map(scope => scope.host.toLowerCase()),
  )

  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const { targets, unparseable } = extractArgumentTargets(exec.arguments)
    for (const raw of unparseable) {
      return deniedResult('unparseable_target', truncateDenialText(raw))
    }
    // Protocol check: every scheme URL the arguments reference must name an
    // allowed scheme — including authority-less ones (`file:///etc/passwd`)
    // the target extraction skips.
    for (const match of JSON.stringify(exec.arguments ?? {}).matchAll(SCHEME_TOKEN_PATTERN)) {
      const scheme = match[2]?.toLowerCase()
      if (scheme !== undefined && !schemes.has(scheme)) {
        return deniedResult('unsupported_protocol', `${scheme}://`)
      }
    }
    for (const candidate of targets) {
      const display = formatPentestNetworkTarget(candidate)
      if (excluded.some(scope => pentestTargetMatches(candidate, scope) && pentestPathCovers(candidate, scope))) {
        return deniedResult('excluded_target', display, display)
      }
      if (authorized.length > 0 && !authorized.some(scope => pentestTargetMatches(candidate, scope))) {
        return deniedResult('outside_authorized', display, display)
      }
      if (resolves && !isIpLiteral(candidate.host)) {
        let addresses: readonly ResolvedAddress[]
        try {
          addresses = await resolve(candidate.host)
        } catch {
          return deniedResult('unresolved_host', display, display)
        }
        if (addresses.some(entry => excludedAddresses.has(entry.address.toLowerCase()))) {
          return deniedResult('resolved_excluded', display, display)
        }
      }
    }
    return next()
  })
}
