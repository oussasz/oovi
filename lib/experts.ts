// Keeps the bots added from private Marketplace experts in step with the catalog (see lib/experts-core.ts):
// their character changes for everyone who already has them, without a new app version. Runs each time the
// published catalog is fetched (every 5 minutes while oovi is used) and when an expert is added.

import fs from "node:fs";
import path from "node:path";
import type { CatalogPlugin } from "./catalog";
import { builtinExpertPrompt } from "./expert-prompts";
import { expertChanges, type InstalledItem } from "./experts-core";
import { dataDir } from "./settings";
import { listBots, setBotCharacter } from "./store";

function installed(): InstalledItem[] {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(dataDir(), "plugins.json"), "utf8")) as InstalledItem[];
    return Array.isArray(all) ? all.filter((p) => p && typeof p.id === "string" && Array.isArray(p.botIds)) : [];
  } catch {
    return [];
  }
}

/** Never throws: a problem here must not break the Marketplace or a chat. Returns how many bots changed. */
export function syncExperts(plugins: CatalogPlugin[]): number {
  try {
    const inst = installed();
    if (!inst.length) return 0;
    const changes = expertChanges(listBots(), inst, plugins, builtinExpertPrompt);
    for (const c of changes) setBotCharacter(c.botId, "set" in c ? c.set : null);
    return changes.length;
  } catch (err) {
    console.error("expert sync failed", err instanceof Error ? err.message : err);
    return 0;
  }
}
