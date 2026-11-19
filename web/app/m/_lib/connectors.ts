// Connectors on the phone (owner's decision, docs/CLOUD-BUILD.md "Changes"): the account's vault entries (written
// by the desktop, part A: lib/cloud-sync-core.ts VaultItem) shown and changed from the phone, and new ones added
// from the catalog. Pure: tested in tests/unit/mobile-connectors.test.mts. Only type imports.
//
// What the phone keeps or shows of a connector is a ConnectorView: never its keys, header values, tokens, command
// or address. The full entry is read only to change it, held in memory for that, and sent back as it was.
import type { PhoneSetup } from "./types";

/** A vault entry as the desktop writes it (part A's VaultItem), plus catalogId when the phone added it. */
export type VaultItem = {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  auth?: "oauth";
  env?: Record<string, string>;
  headers?: Record<string, string>;
  oauth?: { clientInfo?: unknown; tokens?: unknown; signedInAt?: number; redirectUrl?: string };
  enabled: boolean;
  trusted: boolean;
  createdAt?: number;
  bots?: string[];
  catalogId?: string;
};

export type ConnectorView = {
  id: string;
  name: string;
  enabled: boolean;
  bots: string[];
  /** local: runs on the computer (a program there); remote: an online service. */
  kind: "remote" | "local";
  /** It signs in with the service (OAuth). */
  oauth: boolean;
  signedIn: boolean;
  /** Keys or header values it was given (counted, never shown). */
  keys: number;
  /** Keys it has no value for yet. */
  missingKeys: number;
  catalogId?: string;
  /** In the account's vault (the phone can change it). False: only known from the setup (sync off, not pushed yet). */
  inCloud: boolean;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** What the phone may show and keep of one vault entry. */
export function viewOfVault(id: string, raw: unknown): ConnectorView {
  const d = obj(raw);
  const secrets = [...Object.values(obj(d.env)), ...Object.values(obj(d.headers))];
  const oauth = obj(d.oauth);
  return {
    id,
    name: typeof d.name === "string" && d.name.trim() ? d.name.slice(0, 80) : id,
    enabled: d.enabled !== false,
    bots: [...new Set(strs(d.bots))],
    kind: d.transport === "stdio" ? "local" : "remote",
    oauth: d.auth === "oauth",
    signedIn: !!oauth.tokens,
    keys: secrets.filter((v) => typeof v === "string" && v.length > 0).length,
    missingKeys: secrets.filter((v) => !v).length,
    ...(typeof d.catalogId === "string" ? { catalogId: d.catalogId.slice(0, 64) } : {}),
    inCloud: true,
  };
}

/** The account's connectors: those in the vault first (in name order), then the ones only the setup knows. */
export function connectorViews(setup: PhoneSetup | null, vault: Record<string, ConnectorView>): ConnectorView[] {
  const inVault = Object.values(vault).sort((a, b) => a.name.localeCompare(b.name));
  const rest = (setup?.connectors ?? [])
    .filter((c) => !vault[c.id])
    .map((c): ConnectorView => ({ id: c.id, name: c.name, enabled: c.enabled, bots: [], kind: c.kind, oauth: false, signedIn: false, keys: 0, missingKeys: 0, inCloud: false }));
  return [...inVault, ...rest];
}

/** A connector needs attention: on, but not signed in, or a key is missing. */
export const needsAction = (c: ConnectorView) => c.inCloud && c.enabled && ((c.oauth && !c.signedIn) || c.missingKeys > 0);

// ---------- changes ----------

/** The same entry with on/off and bots changed; everything else (keys, sign-in) kept as it was. */
export function withSettings(data: VaultItem, change: { enabled?: boolean; bots?: string[] }): VaultItem {
  return {
    ...data,
    ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
    ...(change.bots ? { bots: [...new Set(change.bots)].slice(0, 100) } : {}),
  };
}

/** Signed out: the sign-in is removed, the connector stays (and can sign in again). */
export function signedOut(data: VaultItem): VaultItem {
  const { oauth: _gone, ...rest } = data;
  void _gone;
  return rest;
}

// ---------- the catalog ----------

export type CatalogField = { key: string; label: string; placeholder?: string; secret?: boolean; optional?: boolean; help?: string; to: "env" | "header" | "arg"; name?: string; template?: string };
export type CatalogConnector = {
  id: string;
  name: string;
  by: string;
  description: string;
  category: string;
  transport: "http" | "stdio";
  url?: string;
  oauth?: boolean;
  fields?: CatalogField[];
  soon?: boolean | string;
  logo?: string;
  sort: number;
};
type RawItem = { id?: unknown; kind?: unknown; sort?: unknown; data?: unknown; published?: unknown };

/** The connectors people can add: the built-in list, replaced by the published copy of the same id, hidden ones out. */
export function catalogConnectors(builtin: RawItem[], published: RawItem[], hidden: string[], logos: Record<string, string> = {}): CatalogConnector[] {
  const byId = new Map<string, CatalogConnector>();
  const take = (it: RawItem) => {
    if (it.kind !== "connector" || typeof it.id !== "string" || it.published === false) return;
    const d = obj(it.data);
    if (typeof d.name !== "string" || (d.transport !== "http" && d.transport !== "stdio")) return;
    byId.set(it.id, {
      id: it.id,
      name: d.name.slice(0, 80),
      by: typeof d.by === "string" ? d.by.slice(0, 80) : "",
      description: typeof d.description === "string" ? d.description.slice(0, 600) : "",
      category: typeof d.category === "string" ? d.category : "everything",
      transport: d.transport,
      ...(typeof d.url === "string" ? { url: d.url } : {}),
      ...(d.oauth === true ? { oauth: true } : {}),
      ...(Array.isArray(d.fields) ? { fields: (d.fields as CatalogField[]).filter((f) => f && typeof f.key === "string" && typeof f.label === "string") } : {}),
      ...(d.soon ? { soon: typeof d.soon === "string" ? d.soon : true } : {}),
      ...(typeof d.logo === "string" ? { logo: d.logo } : logos[it.id] ? { logo: logos[it.id] } : {}),
      sort: typeof it.sort === "number" ? it.sort : 0,
    });
  };
  builtin.forEach(take);
  published.forEach(take);
  for (const h of hidden) byId.delete(h);
  return [...byId.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/** Can it be added from the phone? Online services only; a program on the computer is added there. */
export function addableHere(c: CatalogConnector): "yes" | "computer" | "soon" {
  if (c.soon) return "soon";
  if (c.transport !== "http" || !c.url) return "computer";
  return "yes";
}

/** The connector's id, like the desktop makes it (lib/mcp.ts addServer): its name in small letters, unique. */
export function newConnectorId(name: string, existing: string[]): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "connector";
  // "add" is the phone's page for adding one (/m/connectors/add).
  if (base === "add") base = "add-connector";
  let id = base;
  for (let i = 2; existing.includes(id); i++) id = `${base}-${i}`;
  return id;
}

/** Words that mean an AI model's key: never accepted on the phone (owner's rule; the website refuses them too). */
const AI_KEY = /^(sk-(ant-|proj-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|gsk_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,})$/;
export const looksLikeAiKey = (v: string) => AI_KEY.test(v.trim());

/**
 * A new vault entry for a catalog connector, from the values typed for its fields. Answers the entry, or the key
 * of the first field that is missing or wrong ("field:<key>" / "aikey:<key>").
 */
export function vaultFromCatalog(c: CatalogConnector, values: Record<string, string>, bots: string[], now: number): VaultItem | `field:${string}` | `aikey:${string}` | "computer" {
  if (addableHere(c) !== "yes") return "computer";
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  for (const f of c.fields ?? []) {
    const v = (values[f.key] ?? "").trim();
    if (!v) {
      if (!f.optional) return `field:${f.key}`;
      continue;
    }
    if (looksLikeAiKey(v)) return `aikey:${f.key}`;
    const filled = f.template ? f.template.replace("{value}", v) : v;
    if (f.to === "header" && f.name) headers[f.name] = filled;
    else if (f.to === "env") env[f.name || f.key] = filled;
  }
  return {
    name: c.name,
    transport: "http",
    url: c.url!,
    ...(c.oauth ? { auth: "oauth" as const } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    enabled: true,
    trusted: false,
    createdAt: now,
    bots: [...new Set(bots)],
    catalogId: c.id,
  };
}

// ---------- sign-in coming back ----------

export type SignInReturn = { kind: "connected"; id: string } | { kind: "error"; code: "expired" | "denied" | "failed" | "signed_out" | "sync_off"; id?: string };

/** The website's callback sends the browser to /m/connectors?connected=<id> or ?error=<code>&id=<id>. */
export function signInReturn(search: string): SignInReturn | null {
  const q = new URLSearchParams(search);
  const id = q.get("connected") ?? q.get("id") ?? undefined;
  const okId = id && /^[A-Za-z0-9_.:-]{1,100}$/.test(id) ? id : undefined;
  if (q.has("connected") && okId) return { kind: "connected", id: okId };
  const e = q.get("error");
  if (e === "expired" || e === "denied" || e === "failed" || e === "signed_out" || e === "sync_off") return { kind: "error", code: e, ...(okId ? { id: okId } : {}) };
  if (e) return { kind: "error", code: "failed", ...(okId ? { id: okId } : {}) };
  return null;
}

export type PendingSignIn = { flowId: string; connectorId: string; status: "waiting_finish" | "waiting_confirm"; here: boolean };

/** Sign-ins this phone started that came back elsewhere: finish the ready ones, explain the others. */
export function pendingToHandle(pending: PendingSignIn[]): { finish: PendingSignIn[]; confirm: PendingSignIn[] } {
  const mine = pending.filter((p) => p.here && typeof p.flowId === "string");
  return { finish: mine.filter((p) => p.status === "waiting_finish"), confirm: mine.filter((p) => p.status === "waiting_confirm") };
}

/** POST /oauth/finish errors → the words to show (keys of the phone's i18n). */
export function finishProblem(status: number): "conn.err.notHere" | "conn.err.confirm" | "conn.err.expired" | "conn.err.refused" | "conn.err.failed" {
  if (status === 404) return "conn.err.notHere";
  if (status === 409) return "conn.err.confirm";
  if (status === 410) return "conn.err.expired";
  if (status === 502) return "conn.err.refused";
  return "conn.err.failed";
}
