/**
 * Credential and auth type definitions.
 * @see _reverse/NOTEPAD.md "How Credential is Used"
 */
import type { ProviderId } from "../provider/types.js";

/** A resolved credential ready to be injected into upstream requests. */
export interface Credential {
  /** The API key portion (e.g. Z.AI API key id, or Bigmodel API key). */
  apiKey: string;
  /** The secret portion (required for Z.AI, optional for Bigmodel — appended as `{apiKey}.{secret}`). */
  secret?: string;
  /** Which provider this credential is for. */
  provider: ProviderId;
  /** Unix timestamp (ms) when the credential expires. Present only for OAuth. */
  expiresAt?: number;
  /** Upstream account identifier (OAuth only); LLM metadata.user_id uses a device/session JSON blob. */
  userId?: string;
  /** JWT token for start-plan (zcode.z.ai). Present when login captured the ZCode plan token. */
  jwt?: string;
  /**
   * Raw provider OAuth access token (bigmodel). Required by the 3.15.1
   * project-access-token plane: getCustomerInfo (bare) and
   * `…/api_keys/{id}/access_tokens` (Bearer) mint the signing JWT
   * (`project_access`, 5h). Absent for API-key imports and pre-patch logins
   * — signing then falls back to the apiKey form and fails open.
   */
  oauthAccessToken?: string;
}

/**
 * Convert a `Credential` to the string sent upstream.
 *
 * - Z.AI: `{apiKey}.{secret}` (secret required)
 * - Bigmodel: `{apiKey}.{secret}` when a secret exists, otherwise `{apiKey}`
 */
export function credentialString(cred: Credential): string {
  if (cred.secret) {
    return `${cred.apiKey}.${cred.secret}`;
  }
  return cred.apiKey;
}

/** Check whether a credential has expired. */
export function isExpired(cred: Credential, now: number = Date.now()): boolean {
  if (cred.expiresAt === undefined) return false;
  return now >= cred.expiresAt;
}
