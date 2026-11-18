// Connectors signed in from the phone (docs/CLOUD-BUILD.md, owner 2026-11-18). Same steps as the desktop's
// lib/mcp-oauth.ts (the MCP SDK's auth(): discovery, dynamic client registration, PKCE), but the service sends
// the browser back to the WEBSITE, which stores the tokens sealed in the connector's cloud_vault entry.
//
// Safety:
// - The flow's state is 32 random bytes; only its SHA-256 is stored. It works once, for 10 minutes. Back in the
//   browser of the session that started it: finished at once. Back elsewhere (an iPhone home-screen app opens the
//   sign-in in Safari, another cookie jar): the code is kept sealed, the page shows the account (masked) and asks
//   "Yes, it's my account"; only then can the STARTING session finish it (POST /connectors/oauth/finish). Without
//   that tap, someone who sends another person a sign-in link could quietly receive their connector.
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
import { MAX_OPEN_FLOWS, OAUTH_FLOW_SECONDS, checkConnectorUrl, isPrivateAddress, maskEmail } from "./cloud-core";

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

export type StartResult = { authUrl: string; flowId: string } | { error: "sync_off" | "no_url" | "bad_url" | "too_many" | "failed"; message: string };

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
  const name = typeof stored?.name === "string" && stored.name.trim() ? stored.name.trim().slice(0, 80) : url.hostname;
  const flow = { url: url.toString(), name, verifier: provider.data.verifier, clientInfo: provider.data.clientInfo, redirectUrl: provider.data.redirectUrl };
  const flowId = crypto.randomUUID();
  await pool.query("INSERT INTO cloud_oauth_flow (state_hash, user_id, session_hash, connector_id, data, id) VALUES ($1, $2, $3, $4, $5, $6)", [
    sha(state),
    userId,
    sha(sessionId),
    connectorId,
    sealJson(flow).sealed,
    flowId,
  ]);
  return { authUrl: provider.authUrl, flowId };
}

type Flow = { url: string; name?: string; verifier?: string; clientInfo?: OAuthClientInformationMixed; redirectUrl?: string };

/** Exchanges the code for tokens and stores them in the connector's vault entry. */
async function exchange(userId: string, connectorId: string, flow: Flow, state: string, code: string): Promise<{ version: number } | "failed" | "sync_off"> {
  const provider = new FlowProvider({ verifier: flow.verifier, clientInfo: flow.clientInfo, redirectUrl: flow.redirectUrl }, state);
  try {
    const r = await auth(provider, { serverUrl: flow.url, authorizationCode: code, fetchFn: guardedFetch });
    if (r !== "AUTHORIZED" || !provider.data.tokens) return "failed";
  } catch {
    return "failed";
  }
  const { verifier: _v, ...keep } = provider.data;
  const saved = await saveVaultSignIn(userId, connectorId, flow.url, keep);
  return "off" in saved ? "sync_off" : saved;
}

export type CallbackResult =
  | { connectorId: string }
  | { error: "expired" | "denied" | "failed" | "sync_off"; connectorId: string | null }
  /** Came back without the session that started it: the code is kept (sealed, not exchanged) for the app to finish. */
  | { held: true; connectorId: string; holdToken: string; service: string; email: string; otherAccount: boolean };

/**
 * The service sent the browser back with ?code&state (or ?error). With the session that started it: the code is
 * exchanged at once and the flow is gone. Without it (an iPhone home-screen app whose sign-in opened in Safari, a
 * different cookie jar): the code is kept sealed, unused, under the same 10-minute limit; the page here asks the
 * person to confirm the (masked) account, then the starting session finishes it (finishHeld). A state works once.
 */
export async function callbackCloudSignIn(userId: string | null, sessionId: string | null, state: string, code: string | null, providerError: boolean): Promise<CallbackResult> {
  await ensureCloudTables();
  if (!/^[0-9a-f]{64}$/.test(state)) return { error: "expired", connectorId: null };
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const f = (
      await c.query(
        `SELECT f.user_id, f.session_hash, f.connector_id, f.data, f.held IS NOT NULL AS held,
                f.created_at > now() - make_interval(secs => ${OAUTH_FLOW_SECONDS}) AS fresh, u.email
           FROM cloud_oauth_flow f JOIN "user" u ON u.id = f.user_id WHERE f.state_hash = $1 FOR UPDATE OF f`,
        [sha(state)],
      )
    ).rows[0];
    // Unknown, or its state already used for a held code: nothing about it is revealed.
    if (!f || f.held) {
      await c.query("ROLLBACK");
      return { error: "expired", connectorId: null };
    }
    const connectorId = f.connector_id as string;
    const mine = userId === f.user_id && sessionId !== null && sha(sessionId) === f.session_hash;
    if (!f.fresh || providerError || !code || mine) {
      await c.query("DELETE FROM cloud_oauth_flow WHERE state_hash = $1", [sha(state)]);
      await c.query("COMMIT");
      if (!f.fresh) return { error: "expired", connectorId };
      if (providerError || !code) return { error: "denied", connectorId };
      const r = await exchange(f.user_id, connectorId, unsealJson<Flow>(f.data), state, code);
      return typeof r === "string" ? { error: r, connectorId } : { connectorId };
    }
    const holdToken = crypto.randomBytes(32).toString("hex");
    await c.query("UPDATE cloud_oauth_flow SET held = $2, hold_hash = $3 WHERE state_hash = $1", [sha(state), sealJson({ code, state }).sealed, sha(holdToken)]);
    await c.query("COMMIT");
    const flow = unsealJson<Flow>(f.data);
    return { held: true, connectorId, holdToken, service: flow.name ?? new URL(flow.url).hostname, email: maskEmail(String(f.email)), otherAccount: !!userId && userId !== f.user_id };
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/** The person tapped "Yes, it's my account" on the held page (no session needed: the hold token is the proof). */
export async function confirmHeld(holdToken: string): Promise<{ service: string } | null> {
  await ensureCloudTables();
  if (!/^[0-9a-f]{64}$/.test(holdToken)) return null;
  const { rows } = await pool.query(
    `UPDATE cloud_oauth_flow SET confirmed = true
      WHERE hold_hash = $1 AND held IS NOT NULL AND created_at > now() - make_interval(secs => ${OAUTH_FLOW_SECONDS}) RETURNING data`,
    [sha(holdToken)],
  );
  if (!rows[0]) return null;
  const flow = unsealJson<Flow>(rows[0].data);
  return { service: flow.name ?? new URL(flow.url).hostname };
}

export type FinishHeldResult =
  | { connectorId: string; version: number; data: Record<string, unknown> }
  | { error: "not_found" | "expired" | "not_back" | "not_confirmed" | "failed" | "sync_off" };

/** POST /connectors/oauth/finish {flowId}: only the account AND session that started the flow. Single use. */
export async function finishHeld(userId: string, sessionId: string, flowId: string): Promise<FinishHeldResult> {
  await ensureCloudTables();
  const c = await pool.connect();
  let f: { connector_id: string; data: unknown; held: unknown };
  try {
    await c.query("BEGIN");
    const row = (
      await c.query(
        `SELECT connector_id, data, held, confirmed, created_at > now() - make_interval(secs => ${OAUTH_FLOW_SECONDS}) AS fresh
           FROM cloud_oauth_flow WHERE id = $1 AND user_id = $2 AND session_hash = $3 FOR UPDATE`,
        [flowId, userId, sha(sessionId)],
      )
    ).rows[0];
    if (!row) {
      await c.query("ROLLBACK");
      return { error: "not_found" };
    }
    if (!row.fresh) {
      await c.query("DELETE FROM cloud_oauth_flow WHERE id = $1", [flowId]);
      await c.query("COMMIT");
      return { error: "expired" };
    }
    if (!row.held || !row.confirmed) {
      await c.query("ROLLBACK");
      return { error: row.held ? "not_confirmed" : "not_back" };
    }
    await c.query("DELETE FROM cloud_oauth_flow WHERE id = $1", [flowId]);
    await c.query("COMMIT");
    f = row;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
  const held = unsealJson<{ code: string; state: string }>(f.held);
  const r = await exchange(userId, f.connector_id, unsealJson<Flow>(f.data), held.state, held.code);
  if (typeof r === "string") return { error: r };
  const entry = await getVault(userId, f.connector_id);
  if (!entry || "off" in entry) return { error: "sync_off" };
  return { connectorId: f.connector_id, version: entry.version, data: entry.data };
}

/** Sign-ins of this account waiting in the cloud (shown in GET /vault so the app finishes them on focus). */
export async function pendingSignIns(userId: string, sessionId: string): Promise<{ flowId: string; connectorId: string; status: "waiting_finish" | "waiting_confirm"; here: boolean }[]> {
  await ensureCloudTables();
  const { rows } = await pool.query(
    `SELECT id, connector_id, confirmed, session_hash FROM cloud_oauth_flow
      WHERE user_id = $1 AND held IS NOT NULL AND created_at > now() - make_interval(secs => ${OAUTH_FLOW_SECONDS}) ORDER BY created_at`,
    [userId],
  );
  return rows.map((r) => ({ flowId: r.id, connectorId: r.connector_id, status: r.confirmed ? "waiting_finish" : "waiting_confirm", here: r.session_hash === sha(sessionId) }));
}
