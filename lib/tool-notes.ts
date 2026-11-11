// Notes about how oovi's own tools behaved go to oovi's developers (the admin Feedback page), not into
// the user's learning: "read_url returned no phone numbers on dzadvisor.com" helps fix the tool, and
// teaches the user's bots nothing about the user's work.
// Sent only while "Send crash reports and tool problems" is on in Settings, cleaned of personal details
// (lib/lesson-rules.ts cleanToolNote), and each note once.

import fs from "node:fs";
import path from "node:path";
import { cloud, currentUser, sessionToken } from "./account";
import { cleanToolNote } from "./lesson-rules";
import { dataDir, loadSettings } from "./settings";

const sentFile = () => path.join(dataDir(), "memory", "tool-notes-sent.json");
const keyOf = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 120);

function readSent(): string[] {
  try {
    const j = JSON.parse(fs.readFileSync(sentFile(), "utf8")) as unknown;
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string").slice(-300) : [];
  } catch {
    return [];
  }
}

/** Send what's new (at most 3 per call). Never throws: it must not disturb the chat. */
export async function sendToolNotes(notes: string[]): Promise<number> {
  try {
    if (loadSettings().crashReports === false || !sessionToken()) return 0;
    const sent = readSent();
    // The user's own name never goes out, even if the model wrote it.
    const names = [currentUser()?.name, currentUser()?.email?.split("@")[0]].filter((x): x is string => !!x && x.trim().length >= 3).flatMap((x) => x.trim().split(/\s+/)).filter((w) => w.length >= 3);
    const hide = (t: string) => names.reduce((acc, w) => acc.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[user]"), t);
    const fresh = [...new Set(notes.map((n) => cleanToolNote(hide(n))).filter(Boolean))].filter((n) => !sent.includes(keyOf(n))).slice(0, 3);
    let n = 0;
    for (const message of fresh) {
      try {
        await cloud("/api/v1/feedback", { method: "POST", auth: true, body: { source: "bot", kind: "problem", message } });
        sent.push(keyOf(message));
        n++;
      } catch {
        /* offline or refused: it may be noticed again another day */
      }
    }
    if (n) {
      fs.mkdirSync(path.dirname(sentFile()), { recursive: true });
      fs.writeFileSync(sentFile(), JSON.stringify(sent.slice(-300)));
    }
    return n;
  } catch {
    return 0;
  }
}
