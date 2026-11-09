// Crash reports: always written to <data>/crash.log on this computer; also sent
// to oovi (app version, OS, error text, never chat content) when the user
// leaves "Send crash reports" on in Settings.

import fs from "node:fs";
import path from "node:path";
import { appVersion, baseDir, cloud, sessionToken } from "./account";
import { loadSettings } from "./settings";

export type CrashInput = { message: string; stack?: string; context?: string; source: "ui" | "server" | "main" };


export async function reportCrash(c: CrashInput): Promise<void> {
  const entry = {
    at: new Date().toISOString(),
    source: c.source,
    appVersion: appVersion(),
    platform: `${process.platform}-${process.arch}`,
    message: c.message.slice(0, 2000),
    stack: c.stack?.slice(0, 16_000),
    context: c.context?.slice(0, 4000),
  };
  try {
    const file = path.join(baseDir(), "crash.log");
    fs.mkdirSync(baseDir(), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) fs.writeFileSync(file, "");
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    /* never let crash reporting crash */
  }
  let allowed = true;
  try {
    allowed = loadSettings().crashReports !== false;
  } catch {
    allowed = true;
  }
  if (!allowed) return;
  await cloud("/api/v1/crash", {
    method: "POST",
    auth: !!sessionToken(),
    body: { appVersion: entry.appVersion, platform: entry.platform, message: entry.message, stack: entry.stack, context: [c.source, entry.context].filter(Boolean).join(" | ") },
  }).catch(() => {});
}
