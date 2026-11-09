// Marketplace items the oovi team publishes from the admin console
// (GET /api/v1/catalog on the account service). They're added to the built-in
// catalog; an item with the same id replaces the built-in one. Cached for 5
// minutes; if the service can't be reached, the built-in catalog is used as is.

import { cloud } from "./account";
import { PLUGINS, SKILLS, mergeById, type CatalogConnector, type CatalogPlugin, type CatalogSkill } from "./catalog";

/** hidden: ids unpublished in the admin console (built-in copies are hidden too). */
export type RemoteCatalog = { connectors: CatalogConnector[]; skills: CatalogSkill[]; plugins: CatalogPlugin[]; hidden: string[] };
type Item = { id?: unknown; kind?: unknown; data?: unknown };

export const EMPTY_CATALOG: RemoteCatalog = { connectors: [], skills: [], plugins: [], hidden: [] };
const TTL = 5 * 60_000;
const g = globalThis as unknown as { __ooviRemoteCatalog?: { at: number; data: RemoteCatalog } };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
// Same rule as the admin console (web/lib/catalog.ts).
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function toConnector(id: string, d: Record<string, unknown>): CatalogConnector | null {
  if (typeof d.name !== "string" || typeof d.description !== "string") return null;
  if (d.transport !== "http" && d.transport !== "stdio") return null;
  const soon = typeof d.soon === "string" && d.soon ? d.soon : d.soon === true ? "Coming soon." : undefined;
  if (!soon && d.transport === "http" && !(typeof d.url === "string" && d.url.startsWith("https://"))) return null;
  if (!soon && d.transport === "stdio" && typeof d.command !== "string") return null;
  return {
    ...(d as unknown as CatalogConnector),
    id,
    by: typeof d.by === "string" ? d.by : "",
    category: typeof d.category === "string" ? (d.category as CatalogConnector["category"]) : "everything",
    soon,
    logo: typeof d.logo === "string" && d.logo.startsWith("https://") ? d.logo : undefined,
  };
}

function toSkill(id: string, d: Record<string, unknown>): CatalogSkill | null {
  if (typeof d.name !== "string" || typeof d.description !== "string" || typeof d.body !== "string") return null;
  return { ...(d as unknown as CatalogSkill), id };
}

function toPlugin(id: string, d: Record<string, unknown>): CatalogPlugin | null {
  if (typeof d.name !== "string" || typeof d.group !== "string" || !Array.isArray(d.bots) || !d.bots.length) return null;
  return { ...(d as unknown as CatalogPlugin), id, skills: Array.isArray(d.skills) ? d.skills.filter((x): x is string => typeof x === "string") : [] };
}

/** Turn the service's answer into catalog items, skipping anything malformed. */
export function parseCatalog(j: unknown): RemoteCatalog {
  const hidden = isObj(j) && Array.isArray(j.hidden) ? j.hidden.filter((x): x is string => typeof x === "string" && ID_RE.test(x)).slice(0, 1000) : [];
  const out: RemoteCatalog = { connectors: [], skills: [], plugins: [], hidden };
  const items = isObj(j) && Array.isArray(j.items) ? (j.items as Item[]) : [];
  for (const it of items.slice(0, 500)) {
    if (typeof it.id !== "string" || !ID_RE.test(it.id) || !isObj(it.data)) continue;
    if (it.kind === "connector") {
      const c = toConnector(it.id, it.data);
      if (c) out.connectors.push(c);
    } else if (it.kind === "skill") {
      const s = toSkill(it.id, it.data);
      if (s) out.skills.push(s);
    } else if (it.kind === "plugin") {
      const p = toPlugin(it.id, it.data);
      if (p) out.plugins.push(p);
    }
  }
  return out;
}

/** Published items (cached for 5 minutes). Never throws. */
export async function remoteCatalog(): Promise<RemoteCatalog> {
  const c = g.__ooviRemoteCatalog;
  if (c && Date.now() - c.at < TTL) return c.data;
  try {
    const data = parseCatalog(await cloud<unknown>("/api/v1/catalog"));
    g.__ooviRemoteCatalog = { at: Date.now(), data };
    return data;
  } catch {
    // Keep the last good copy; try again after the normal wait.
    const data = c?.data ?? EMPTY_CATALOG;
    g.__ooviRemoteCatalog = { at: Date.now(), data };
    return data;
  }
}

/** Same, but gives up after `ms` (the fetch keeps going and fills the cache). */
export function remoteCatalogQuick(ms = 4000): Promise<RemoteCatalog> {
  return Promise.race([remoteCatalog(), new Promise<RemoteCatalog>((r) => setTimeout(() => r(g.__ooviRemoteCatalog?.data ?? EMPTY_CATALOG), ms))]);
}

export async function allSkills(): Promise<CatalogSkill[]> {
  const r = await remoteCatalogQuick();
  return mergeById(SKILLS, r.skills, r.hidden);
}

export async function allPlugins(): Promise<CatalogPlugin[]> {
  const r = await remoteCatalogQuick();
  return mergeById(PLUGINS, r.plugins, r.hidden);
}
