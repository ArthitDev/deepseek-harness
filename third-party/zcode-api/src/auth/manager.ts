/**
 * Auth manager — resolves the upstream credential from the OAuth login flow.
 */
import type { Credential } from "./types.js";

/**
 * Resolves the upstream credential to inject into proxied requests.
 *
 * The credential comes from `auth login` and is injected via
 * {@link setOAuthCredential} at startup (and re-loaded on Android's
 * `startProxy` so a fresh login after restart is picked up).
 */
export class AuthManager {
  private oauthCred: Credential | null = null;

  /**
   * Returns the current credential or throws when none is stored.
   *
   * There is no proactive refresh: the login flows never populate
   * `expiresAt`, so expiry surfaces as an upstream 401, not here. The guard
   * below is retained for the day a flow starts filling `expiresAt`.
   */
  async getCredential(): Promise<Credential> {
    if (this.oauthCred) {
      if (this.oauthCred.expiresAt && Date.now() >= this.oauthCred.expiresAt) {
        this.oauthCred = null;
        throw new Error("OAuth credential expired; re-authentication required — run: zcode-proxy auth login");
      }
      return this.oauthCred;
    }
    throw new Error("OAuth credential not available — run: zcode-proxy auth login");
  }

  /** Set the OAuth credential (used by the `auth login` flow). */
  setOAuthCredential(cred: Credential): void {
    this.oauthCred = cred;
  }

  /**
   * Drop the in-memory credential without touching the store.
   *
   * Used when the user logs out while the process keeps running (the `serve`
   * web panel): this manager is consulted before the store, so a credential
   * that is already gone from disk would otherwise keep being spent by `/v1`
   * requests and by auto-claim.
   */
  clearOAuthCredential(): void {
    this.oauthCred = null;
  }
}
