// First run, made personal (lib/onboarding-core.ts). GET suggests a team for the user's goals; POST applies the
// choices once: the leader's character and name, what the user will use oovi for (in the leader's instructions),
// the suggested experts and teams installed, and the old one-size-fits-all starter bots removed when the user
// didn't choose them (only if nobody has used them yet).
import fs from "node:fs";
import path from "node:path";
import { allPlugins, allSkills } from "@/lib/catalog-remote";
import { guard } from "@/lib/guard";
import { GOALS, LEADERS, STARTER, isGoal, leaderNotes, suggestSetups, type LeaderStyle } from "@/lib/onboarding-core";
import { installPlugin } from "@/lib/plugins";
import { dataDir } from "@/lib/settings";
import { deleteBot, deleteChat, dmId, getChat, listBots, listChats, updateBot, validateBot } from "@/lib/store";
import { mainBot, pinMainBot } from "@/lib/team";
import { cleanFace } from "@/lib/faces";
import { cloud } from "@/lib/account";
import { loadSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SETUPS = 6;
const doneFile = () => path.join(dataDir(), "onboarding.json");
const clean = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const goalsOf = (v: unknown) => [...new Set((Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).filter(isGoal))];

/** ?goals=a,b&other=… → the setups to suggest, with what the cards show, and the ones ticked from the start. ?mine=1 → the goals the user chose. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const url = new URL(req.url);
  if (url.searchParams.get("mine") === "1") {
    // What the first run already did (the app was closed before its last screen: it goes on from there).
    try {
      const d = JSON.parse(fs.readFileSync(doneFile(), "utf8")) as { goals?: unknown; leader?: { id?: string } };
      const leader = d.leader?.id ? listBots().find((b) => b.id === d.leader!.id) : undefined;
      return Response.json({ goals: goalsOf(d.goals), done: d, face: leader?.face ?? null });
    } catch {
      return Response.json({ goals: [], done: null, face: null });
    }
  }
  const plugins = await allPlugins();
  const s = suggestSetups(goalsOf(url.searchParams.get("goals") ?? ""), clean(url.searchParams.get("other"), 200), plugins);
  const setups = s.ids
    .map((id) => {
      if (id === STARTER.id) return { id, name: STARTER.name, description: STARTER.description, group: true, bots: STARTER.bots };
      const p = plugins.find((x) => x.id === id);
      return p ? { id, name: p.name, description: p.description, group: p.bots.length > 1, bots: p.bots.map((b) => ({ name: b.name, role: b.role, face: b.face })) } : null;
    })
    .filter(Boolean);
  return Response.json({ setups, picked: s.picked, goals: GOALS.map((g) => g.id), leaders: LEADERS });
}

/** The starter bots everyone used to get, if they are still exactly as made and nobody used them. */
function untouchedStarter() {
  const bots = listBots();
  const trio = STARTER.bots.map((s) => bots.find((b) => b.name === s.name && b.role === s.role)).filter((b) => !!b);
  const unused = (id: string) => !(getChat(dmId(id))?.entries.length);
  const studio = listChats().find((c) => c.kind === "group" && c.name === "Studio" && !c.entries.length);
  return { bots: trio.length === 3 && trio.every((b) => unused(b.id)) ? trio : [], studio };
}

/** {style, name, face, goals, other, setups} applies the first-run choices (once). */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  if (fs.existsSync(doneFile())) return Response.json({ error: "Your team is already set up.", done: JSON.parse(fs.readFileSync(doneFile(), "utf8")) }, { status: 409 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Invalid request." }, { status: 400 });
  const style = LEADERS.some((l) => l.id === b.style) ? (b.style as LeaderStyle) : null;
  const goals = goalsOf(b.goals);
  const other = clean(b.other, 200);
  const plugins = await allPlugins();
  const wanted = [...new Set((Array.isArray(b.setups) ? b.setups : []).filter((x): x is string => typeof x === "string"))].filter((id) => id === STARTER.id || plugins.some((p) => p.id === id)).slice(0, MAX_SETUPS);

  const leader = mainBot();
  if (!leader) return Response.json({ error: "Your leader isn't ready yet. Try again in a moment." }, { status: 409 });

  // The leader's new name must be free: the starter bots the user didn't choose go first.
  if (!wanted.includes(STARTER.id)) {
    const old = untouchedStarter();
    for (const bot of old.bots) if (bot.id !== leader.id) deleteBot(bot.id);
    if (old.studio) deleteChat(old.studio.id);
  }
  const notes = leaderNotes(style, goals, other);
  const base = leader.instructions.split("\n\nYour personality:")[0]!.split("\n\nThe user told you, when they started")[0]!;
  const input = validateBot({ ...leader, name: clean(b.name, 24) || leader.name, face: b.face ? cleanFace(b.face) : leader.face, instructions: notes ? `${base}\n\n${notes}` : base }, leader.id);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  const updated = updateBot(leader.id, input)!;
  pinMainBot(updated.id);

  const skills = await allSkills();
  const created: { id: string; name: string; groupId: string; bots: string[] }[] = [];
  const failed: string[] = [];
  for (const id of wanted) {
    if (id === STARTER.id) continue; // kept above
    try {
      const r = installPlugin(id, plugins, skills);
      created.push({ id, name: plugins.find((p) => p.id === id)?.name ?? id, ...r });
    } catch {
      failed.push(plugins.find((p) => p.id === id)?.name ?? id);
    }
  }
  const done = { at: Date.now(), leader: { id: updated.id, name: updated.name }, created, starter: wanted.includes(STARTER.id), failed, goals };
  fs.mkdirSync(path.dirname(doneFile()), { recursive: true });
  fs.writeFileSync(doneFile(), JSON.stringify(done));
  return Response.json(done);
}

const STEPS = new Set(["chief", "team", "created", "alone", "tried", "later"]);
/**
 * {step, style?, goals?, setups?}: tells the oovi server which first-run step was reached (Admin > Overview,
 * "First run"), unless the user turned usage statistics off. Only the ids of choices go, never typed text.
 * Never fails the first run.
 */
export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.step !== "string" || !STEPS.has(b.step)) return Response.json({ error: "Unknown step." }, { status: 400 });
  if (loadSettings().usageStats !== false) {
    const body = { step: b.step, ...(typeof b.style === "string" ? { style: b.style } : {}), goals: goalsOf(b.goals), ...(Array.isArray(b.setups) ? { setups: b.setups.filter((x) => typeof x === "string").slice(0, 6) } : {}) };
    void cloud("/api/v1/onboarding", { method: "POST", body, auth: true }).catch(() => {});
  }
  return new Response(null, { status: 204 });
}
