// Connectors signed in from the phone (docs/CLOUD-BUILD.md, owner 2026-11-18). Same steps as the desktop's
// lib/mcp-oauth.ts (the MCP SDK's auth(): discovery, dynamic client registration, PKCE), but the service sends
// the browser back to the WEBSITE, which stores the tokens sealed in the connector's cloud_vault entry.
//
// Safety:
// - The flow's state is 32 random bytes; only its SHA-256 is stored. It works once (deleted when used), for 10
//   minutes, and only for the same signed-in account AND session that started it.
// - The PKCE verifier and the client registration are sealed in the flow row; nothing is kept in memory, so it
//   works across server instances.
// - The website only calls public https addresses for a sign-in (every hop checked, also after redirects and DNS):
//   a connector's address can't make it reach this machine, a private network or a cloud metadata address.
import crypto from "node:crypto";
import dns from "node:dns/promises";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { pool } from "./db";
import { siteUrl } from "./site";
import { ensureCloudTables, getVault, isEnabled, saveVaultSignIn, sealJson, unsealJson } from "./cloud";
import { MAX_OPEN_FLOWS, OAUTH_FLOW_SECONDS, checkConnectorUrl, isPrivateAddress } from "./cloud-core";

export const CLOUD_CALLBACK_PATH = "/api/v1/cloud/connectors/oauth/callback";
const redirectUri = () => `${siteUrl()}${CLOUD_CALLBACK_PATH}`;
const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

/** Test-only: hosts allowed over plain http and on this machine (never set in production). */
const testHosts = () => (process.env.OOVI_CLOUD_OAUTH_TEST_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);

/** What the vault entry's `oauth` holds (the desktop's OAuthData shape, so the app and the runner read it the same way). */
type OAuthData = { clientInfo?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string; redirectUrl?: string; signedInAt?: number };

class FlowProvider implements OAuthClientProvider {
  authUrl: string | null = null;
  constructor(
    public data: OAuthData,
    private readonly flowState: string,
  ) {}
  get redirectUrl() {
    return redirectUri();
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "oovi",
      client_uri: siteUrl(),
      redirect_uris: [redirectUri()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  state() {
    return this.flowState;
  }
  clientInformation() {
    // A registration made for another address (the desktop's) can't be used with the website's.
    return this.data.redirectUrl === redirectUri() ? this.data.clientInfo : undefined;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.data = { ...this.data, clientInfo: info, redirectUrl: redirectUri() };
  }
  tokens() {
    return this.data.tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.data = { ...this.data, tokens, signedInAt: Date.now() };
  }
  redirectToAuthorization(url: URL) {
    this.authUrl = url.toString();
  }
  saveCodeVerifier(verifier: string) {
    this.data = { ...this.data, verifier };
  }
  codeVerifier() {
    if (!this.data.verifier) throw new Error("verifier missing");
    return this.data.verifier;
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all") this.data = {};
    else if (scope === "client") this.data = { ...this.data, clientInfo: undefined };
    else if (scope === "tokens") this.data = { ...this.data, tokens: undefined };
    else if (scope === "verifier") this.data = { ...this.data, verifier: undefined };
  }
}

/** Refuses a name that resolves to a private address (checked on every request, redirects included). */
async function assertPublic(u: URL): Promise<void> {
  if (testHosts().includes(u.host)) return;
  if (u.protocol !== "https:") throw new Error("not https");
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("private address");
}

/** fetch for the SDK: public https only, 10 s per request, at most 3 redirects, each checked. */
export async function guardedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  let url = new URL(input instanceof Request ? input.url : String(input));
  let opts: RequestInit = { ...(init ?? {}) };
  if (input instanceof Request && !init) opts = { method: input.method, headers: input.headers, body: input.body };
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { ...opts, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url);
      if (res.status !== 307 && res.status !== 308) opts = { ...opts, method: "GET", body: undefined };
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

export type StartResult = { authUrl: string } | { error: "sync_off" | "no_url" | "bad_url" | "too_many" | "failed"; message: string };

/** Starts a sign-in for a connector of this account. The url comes from its vault entry, else from the request. */
export async function startCloudSignIn(userId: string, sessionId: string, connectorId: string, urlFromRequest: unknown): Promise<StartResult> {
  await ensureCloudTables();
  if (!(await isEnabled(userId))) return { error: "sync_off", message: "Cloud sync is off." };
  const entry = await getVault(userId, connectorId);
  const stored = entry && !("off" in entry) ? entry.data : null;
  const rawUrl = typeof stored?.url === "string" ? stored.url : urlFromRequest;
  if (rawUrl === undefined || rawUrl === null) return { error: "no_url", message: "Add the connector first: its address is missing." };
  const url = checkConnectorUrl(rawUrl, testHosts());
  if (typeof url === "string") return { error: "bad_url", message: url };

  await pool.query(`DELETE FROM cloud_oauth_flow WHERE created_at < now() - make_interval(secs => ${OAUTH_FLOW_SECONDS})`);
  const open = Number((await pool.query("SELECT count(*) AS n FROM cloud_oauth_flow WHERE user_id = $1", [userId])).rows[0].n);
  if (open >= MAX_OPEN_FLOWS) return { error: "too_many", message: "Too many sign-ins started. Wait 10 minutes and try again." };

  const state = crypto.randomBytes(32).toString("hex");
  const prior = (stored?.oauth ?? {}) as OAuthData;
  // A fresh sign-in: old tokens are not reused (the service shows its permission page).
  const provider = new FlowProvider({ clientInfo: prior.clientInfo, redirectUrl: prior.redirectUrl }, state);
  try {
    const r = await auth(provider, { serverUrl: url, fetchFn: guardedFetch });
    if (r === "AUTHORIZED" || !provider.authUrl) return { error: "failed", message: "This service didn't offer a sign-in page." };
  } catch {
    return { error: "failed", message: "This service's sign-in couldn't be reached. Check its address, or try again later." };
  }
  const flow = { url: url.toString(), verifier: provider.data.verifier, clientInfo: provider.data.clientInfo, redirectUrl: provider.data.redirectUrl };
  await pool.query("INSERT INTO cloud_oauth_flow (state_hash, user_id, session_hash, connector_id, data) VALUES ($1, $2, $3, $4, $5)", [
    sha(state),
    userId,
    sha(sessionId),
    connectorId,
    sealJson(flow).sealed,
  ]);
  return { authUrl: provider.authUrl };
}

export type FinishResult = { connectorId: string } | { error: "expired" | "denied" | "failed" | "sync_off"; connectorId: string | null };

/**
 * The service sent the browser back with ?code&state (or ?error). The flow is used up whatever happens. It must
 * belong to the same account and session, and be under 10 minutes old.
 */
export async function finishCloudSignIn(userId: string, sessionId: string, state: string, code: string | null, providerError: boolean): Promise<FinishResult> {
  await ensureCloudTables();
  if (!/^[0-9a-f]{64}$/.test(state)) return { error: "expired", connectorId: null };
  const { rows } = await pool.query(
    `DELETE FROM cloud_oauth_flow WHERE state_hash = $1
     RETURNING user_id, session_hash, connector_id, data, created_at > now() - make_interval(secs => ${OAUTH_FLOW_SECONDS}) AS fresh`,
    [sha(state)],
  );
  const f = rows[0];
  // Another account's or session's state is treated as unknown: nothing about it is revealed.
  if (!f || f.user_id !== userId || f.session_hash !== sha(sessionId)) return { error: "expired", connectorId: null };
  const connectorId = f.connector_id as string;
  if (!f.fresh) return { error: "expired", connectorId };
  if (providerError || !code) return { error: "denied", connectorId };
  const flow = unsealJson<{ url: string; verifier?: string; clientInfo?: OAuthClientInformationMixed; redirectUrl?: string }>(f.data);
  const provider = new FlowProvider({ verifier: flow.verifier, clientInfo: flow.clientInfo, redirectUrl: flow.redirectUrl }, state);
  try {
    const r = await auth(provider, { serverUrl: flow.url, authorizationCode: code, fetchFn: guardedFetch });
    if (r !== "AUTHORIZED" || !provider.data.tokens) return { error: "failed", connectorId };
  } catch {
    return { error: "failed", connectorId };
  }
  const { verifier: _v, ...keep } = provider.data;
  const saved = await saveVaultSignIn(userId, connectorId, flow.url, keep);
  if ("off" in saved) return { error: "sync_off", connectorId };
  return { connectorId };
}
