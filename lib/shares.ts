// Canvas pages the user shares by a public link (the oovi website keeps a snapshot: web/lib/public-pages.ts).
// Sharing is always the user's own click, never a bot's. The link shows the page as it was when shared or last
// updated; "Update" sends it again, "Stop sharing" removes it from the website. Which pages are shared, and their
// links, are kept here (shares.json), by chat and page.
import fs from "node:fs";
import path from "node:path";
import { cloud, CloudError } from "./account";
import { dataDir } from "./settings";
import { loadWork } from "./workfiles";

export type Share = { id: string; url: string; at: number };
type Kind = "note" | "table";
type Shares = Record<string, Record<string, Share>>;

const file = () => path.join(dataDir(), "shares.json");
const key = (kind: Kind, name: string) => `${kind}:${name}`;

function load(): Shares {
  try {
    const j = JSON.parse(fs.readFileSync(file(), "utf8")) as Shares;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}
function save(s: Shares) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(s));
}

export const sharesOf = (chatId: string): Record<string, Share> => load()[chatId] ?? {};

/** Share a page (or update its shared copy). Returns its link, or why it can't be shared. */
export async function sharePage(chatId: string, kind: Kind, name: string): Promise<Share | string> {
  const store = loadWork(chatId);
  const content =
    kind === "note"
      ? store.notes[name] && { kind: "notes", text: store.notes[name]!.text }
      : store.tables[name] && { kind: "table", columns: store.tables[name]!.columns, rows: store.tables[name]!.rows };
  if (!content) return "That page isn't there any more.";
  const all = load();
  const cur = all[chatId]?.[key(kind, name)];
  const send = (id?: string) => cloud<{ id: string; url: string }>("/api/v1/pages", { method: "POST", auth: true, body: { ...(id ? { id } : {}), title: name, content } });
  let r: { id: string; url: string };
  try {
    r = await send(cur?.id);
  } catch (e) {
    // Removed on the website meanwhile: share it again under a new link.
    if (!(e instanceof CloudError && e.status === 404 && cur)) return e instanceof Error ? e.message : "The page couldn't be shared.";
    try {
      r = await send();
    } catch (e2) {
      return e2 instanceof Error ? e2.message : "The page couldn't be shared.";
    }
  }
  const share: Share = { id: r.id, url: r.url, at: Date.now() };
  (all[chatId] ??= {})[key(kind, name)] = share;
  save(all);
  return share;
}

/** Stop sharing: the link stops working. */
export async function unsharePage(chatId: string, kind: Kind, name: string): Promise<string | null> {
  const all = load();
  const cur = all[chatId]?.[key(kind, name)];
  if (!cur) return null;
  try {
    await cloud(`/api/v1/pages?id=${encodeURIComponent(cur.id)}`, { method: "DELETE", auth: true });
  } catch (e) {
    return e instanceof Error ? e.message : "Sharing couldn't be stopped. Try again.";
  }
  delete all[chatId]![key(kind, name)];
  save(all);
  return null;
}

/** A shared page renamed in the Canvas keeps its link (the next update uses the new title). */
export function renameShare(chatId: string, kind: Kind, from: string, to: string) {
  const all = load();
  const cur = all[chatId]?.[key(kind, from)];
  if (!cur) return;
  delete all[chatId]![key(kind, from)];
  all[chatId]![key(kind, to)] = cur;
  save(all);
}

/** Every link of a chat, or of one page, removed from the website (page or chat deleted). Best effort. */
export async function dropShares(chatId: string, only?: { kind: Kind; name: string }) {
  const mine = sharesOf(chatId);
  for (const k of Object.keys(mine)) {
    if (only && k !== key(only.kind, only.name)) continue;
    const [kind, ...rest] = k.split(":");
    await unsharePage(chatId, kind as Kind, rest.join(":")).catch(() => {});
  }
}
