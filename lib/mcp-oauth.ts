// "Connect" for remote connectors that use sign-in (OAuth), like Notion, Linear,
// Canva, Stripe or Zapier. Same idea as ChatGPT and Claude connectors:
// 1. oovi registers itself with the service automatically (dynamic client
//    registration, no developer setup),
// 2. your normal browser opens the service's own sign-in and permission page,
// 3. the service sends you back to oovi (a page on this computer), which stores
//    the tokens encrypted. They refresh by themselves; you only sign in again if
//    the service revokes them.

import crypto from "node:crypto";
import { cloudUrl } from "./account";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/** What we keep per connector (stored encrypted in mcp.json by lib/mcp.ts). */
export type OAuthData = { clientInfo?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string; redirectUrl?: string; signedInAt?: number };

export type OAuthStore = { load: () => OAuthData; save: (patch: Partial<OAuthData>, replace?: boolean) => void };

export const CALLBACK_PATH = "/api/mcp/oauth/callback";
/**
 * The address the service sends the browser back to: oovi's website, which hands the code to this
 * app (state ends with the app's local port). The service's permission page then names oovi's own
 * site instead of "localhost". The code alone is useless without the PKCE verifier that stays here.
 */
export const WEB_CALLBACK_PATH = "/connect/callback";
const webRedirect = () => `${cloudUrl()}${WEB_CALLBACK_PATH}`;

export class OoviOAuthProvider implements OAuthClientProvider {
  private readonly redirect: string;
  private readonly flowState: string;

  /**
   * redirect: this app's callback URL (needed to start a sign-in).
   * onRedirect: called with the sign-in page URL; when missing (bots using the
   * connector in the background) a needed sign-in becomes an error instead.
   */
  constructor(
    private readonly store: OAuthStore,
    redirect: string | undefined,
    private readonly onRedirect?: (url: string) => void,
    flowState?: string,
  ) {
    this.redirect = redirect || store.load().redirectUrl || `http://127.0.0.1${CALLBACK_PATH}`;
    this.flowState = flowState ?? crypto.randomBytes(16).toString("hex");
  }

  get redirectUrl(): string {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "oovi",
      client_uri: "https://oovi.conuron.com",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this.flowState;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const d = this.store.load();
    // Registered for another address (oovi's local port changed): register again.
    if (d.clientInfo && d.redirectUrl && d.redirectUrl !== this.redirect && this.onRedirect) return undefined;
    return d.clientInfo;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.store.save({ clientInfo: info, redirectUrl: this.redirect });
  }

  tokens(): OAuthTokens | undefined {
    return this.store.load().tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.store.save({ tokens, signedInAt: Date.now() });
  }

  redirectToAuthorization(url: URL): void {
    if (this.onRedirect) this.onRedirect(url.toString());
  }

  saveCodeVerifier(verifier: string): void {
    this.store.save({ verifier });
  }

  codeVerifier(): string {
    const v = this.store.load().verifier;
    if (!v) throw new Error("The sign-in expired. Press Connect again.");
    return v;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "all") this.store.save({}, true);
    else if (scope === "client") this.store.save({ clientInfo: undefined });
    else if (scope === "tokens") this.store.save({ tokens: undefined });
    else if (scope === "verifier") this.store.save({ verifier: undefined });
  }
}

// ---------- sign-in flows waiting for the browser to come back ----------

type Pending = { serverId: string; redirect: string; at: number };
const g = globalThis as typeof globalThis & { __ooviOAuthPending?: Map<string, Pending> };
const pending = (g.__ooviOAuthPending ??= new Map<string, Pending>());
const FLOW_TTL = 15 * 60 * 1000;

function sweep() {
  for (const [k, v] of pending) if (Date.now() - v.at > FLOW_TTL) pending.delete(k);
}

/** Start signing in. Returns the page to open, or authorized when tokens already work. */
export async function startSignIn(serverId: string, serverUrl: string, store: OAuthStore, appOrigin: string): Promise<{ authUrl?: string; authorized: boolean }> {
  sweep();
  // OOVI_OAUTH_LOCAL=1: the service comes back straight to this app (no website in between).
  const local = process.env.OOVI_OAUTH_LOCAL === "1";
  const redirect = local ? `${appOrigin}${CALLBACK_PATH}` : webRedirect();
  const port = new URL(appOrigin).port;
  const state = `${crypto.randomBytes(16).toString("hex")}${local || !port ? "" : `.${port}`}`;
  let authUrl: string | undefined;
  // A fresh sign-in: forget old tokens so the service shows its permission page.
  store.save({ tokens: undefined, verifier: undefined });
  const provider = new OoviOAuthProvider(store, redirect, (u) => (authUrl = u), state);
  const result = await auth(provider, { serverUrl });
  if (result === "AUTHORIZED") return { authorized: true };
  if (!authUrl) throw new Error("The service didn't return a sign-in page.");
  pending.set(state, { serverId, redirect, at: Date.now() });
  return { authUrl, authorized: false };
}

/** The browser came back with ?code&state. Exchanges the code for tokens. */
export async function finishSignIn(state: string, code: string, lookup: (serverId: string) => { url: string; store: OAuthStore } | null): Promise<string> {
  sweep();
  const p = pending.get(state);
  if (!p) throw new Error("This sign-in link has expired or was already used. Press Connect again in oovi.");
  pending.delete(state);
  const s = lookup(p.serverId);
  if (!s) throw new Error("That connector was removed.");
  const provider = new OoviOAuthProvider(s.store, p.redirect, () => {}, state);
  const result = await auth(provider, { serverUrl: s.url, authorizationCode: code });
  if (result !== "AUTHORIZED") throw new Error("The service didn't accept the sign-in. Try Connect again.");
  return p.serverId;
}
