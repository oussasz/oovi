// Problem reports go to oovi's developers (Admin > Problems), not into the user's learning:
// "read_url returned no phone numbers on dzadvisor.com" or "a bot stopped: the screen can't be captured"
// helps fix oovi, and teaches the user's bots nothing about the user's work. (lib/run-report.ts says
// what is reported and when.)
// Sent only while "Send crash reports and problems" is on in Settings, cleaned of personal details,
// and each note once per app version: a problem that comes back after an update is reported again,
// so the console can tell that a fix didn't work.

import fs from "node:fs";
import path from "node:path";
import { appVersion, cloud, currentUser, sessionToken } from "./account";
import { cleanToolNote } from "./lesson-rules";
import { cleanProblemNote, type ProblemNote } from "./run-report";
import { dataDir, loadSettings } from "./settings";

const sentFile = () => path.join(dataDir(), "memory", "tool-notes-sent.json");
const keyOf = (t: string) => `${appVersion()}|${t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 120)}`;

function readSent(): string[] {
  try {
    const j = JSON.parse(fs.readFileSync(sentFile(), "utf8")) as unknown;
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string").slice(-300) : [];
  } catch {
    return [];
  }
}

/** The signed-in user's name and email name, never sent even if a model wrote them. */
export function namesToHide(): string[] {
  const u = currentUser();
  return [u?.name, u?.email?.split("@")[0]]
    .filter((x): x is string => !!x && x.trim().length >= 3)
    .flatMap((x) => x.trim().split(/\s+/))
    .filter((w) => w.length >= 3);
}

/** Whether problem reports may be sent now. */
export const reportsAllowed = () => loadSettings().crashReports !== false && !!sessionToken();

/** Send what's new (at most 4 per call). Never throws: it must not disturb the chat. */
export async function sendProblems(notes: ProblemNote[]): Promise<number> {
  try {
    if (!reportsAllowed()) return 0;
    const sent = readSent();
    const hide = namesToHide();
    const fresh: ProblemNote[] = [];
    for (const n of notes) {
      const message = cleanProblemNote(n.message, hide);
      if (!message || sent.includes(keyOf(message)) || fresh.some((f) => f.message === message)) continue;
      fresh.push({ ...n, message });
      if (fresh.length >= 4) break;
    }
    let count = 0;
    for (const n of fresh) {
      try {
        await cloud("/api/v1/feedback", { method: "POST", auth: true, body: { source: "bot", kind: "problem", message: n.message, tag: n.tag, ...(n.tool ? { tool: n.tool.slice(0, 60) } : {}), ...(n.site ? { site: n.site.slice(0, 100) } : {}) } });
        sent.push(keyOf(n.message));
        count++;
      } catch {
        /* offline or refused: it may be noticed again another day */
      }
    }
    if (count) {
      fs.mkdirSync(path.dirname(sentFile()), { recursive: true });
      fs.writeFileSync(sentFile(), JSON.stringify(sent.slice(-300)));
    }
    return count;
  } catch {
    return 0;
  }
}

/** Notes about oovi's tools written by the learning review (free text, must name a tool). */
export async function sendToolNotes(notes: string[]): Promise<number> {
  const hide = namesToHide();
  return sendProblems(notes.map((n) => ({ tag: "tool" as const, message: cleanToolNote(cleanProblemNote(n, hide)) })).filter((n) => n.message));
}
