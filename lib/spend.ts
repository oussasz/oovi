// The spending ledger (spend.json in the account's folder) and the check made before each model call.
import fs from "node:fs";
import path from "node:path";
import { addSpend, dayKey, limitReached, type Ledger, type Reached } from "./spend-core";
import { dataDir, loadSettings } from "./settings";

const file = () => path.join(dataDir(), "spend.json");

export function readLedger(): Ledger {
  try {
    const j = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<Ledger>;
    return { days: j.days && typeof j.days === "object" ? j.days : {} };
  } catch {
    return { days: {} };
  }
}

/** Add one model call's cost. Never throws. */
export function recordSpend(usd: number | undefined, credits: number | undefined): void {
  if (!(usd && usd > 0) && !(credits && credits > 0)) return;
  try {
    const next = addSpend(readLedger(), dayKey(new Date()), usd ?? 0, credits ?? 0);
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(next));
  } catch {
    /* the ledger must never break a run */
  }
}

/** The limit reached now (Settings > AI models > Spending limits), or null. */
export const spendLimitReached = (): Reached => limitReached(readLedger(), loadSettings().spend, new Date());
