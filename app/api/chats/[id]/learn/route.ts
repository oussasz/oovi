import { guard } from "@/lib/guard";
import { changeLearned, mergeLearned, rateLessons, reflect } from "@/lib/learning";
import { isRunning } from "@/lib/runner";
import { loadSettings } from "@/lib/settings";
import { saveSkill } from "@/lib/skills";
import { getChat, listBots, saveChat } from "@/lib/store";
import type { BotEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Feedback on a reply, the self-learning way.
 * {entryId, rating: "up" | "down" | null, note?}: rate the reply. Thumbs down is
 *   turned into a lesson; thumbs up makes its lessons rank higher.
 * {entryId, saveSkill: true}: save the skill the bots drafted from this reply.
 * {entryId, change: {kind: "lesson" | "user", index, action: "remove" | "edit", text?}}: correct or remove
 *   a line of the "Learned" card; the saved lesson or profile fact changes with it.
 */
export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const id = (await params).id;
  const chat = getChat(id);
  if (!chat) return Response.json({ error: "Chat not found." }, { status: 404 });
  if (isRunning(id)) return Response.json({ error: "Wait until the bots finish." }, { status: 409 });
  const b = ((await req.json().catch(() => null)) ?? {}) as { entryId?: unknown; rating?: unknown; note?: unknown; saveSkill?: unknown; change?: { kind?: unknown; index?: unknown; action?: unknown; text?: unknown } };
  const i = chat.entries.findIndex((e) => e.id === b.entryId);
  const entry = chat.entries[i];
  if (!entry || entry.kind !== "bot") return Response.json({ error: "Reply not found." }, { status: 404 });

  if (b.change && typeof b.change === "object") {
    const c = b.change;
    if (!entry.learned) return Response.json({ error: "Nothing was learned from this reply." }, { status: 400 });
    if ((c.kind !== "lesson" && c.kind !== "user") || (c.action !== "remove" && c.action !== "edit") || typeof c.index !== "number" || !Number.isInteger(c.index)) return Response.json({ error: "Send {kind, index, action}." }, { status: 400 });
    const next = changeLearned(entry.learned, c.kind, c.index, c.action, typeof c.text === "string" ? c.text.slice(0, 600) : undefined);
    if (typeof next === "string") return Response.json({ error: next }, { status: 400 });
    entry.learned = next;
    saveChat(chat);
    return Response.json({ entry });
  }

  if (b.saveSkill === true) {
    const sk = entry.learned?.skill;
    if (!sk) return Response.json({ error: "There's no skill to save." }, { status: 400 });
    if (!entry.learned?.skillSaved) {
      saveSkill({ name: sk.name, description: sk.description, body: sk.body, source: "learned" });
      entry.learned = { ...entry.learned!, skillSaved: true };
      saveChat(chat);
    }
    return Response.json({ entry });
  }

  const rating = b.rating === "up" || b.rating === "down" ? b.rating : null;
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 600) : "";
  const before = entry.feedback?.rating;
  if (!rating) {
    entry.feedback = undefined;
    if (before === "up") rateLessons(entry.id, -1);
    saveChat(chat);
    return Response.json({ entry });
  }
  entry.feedback = { rating, ...(note ? { note } : {}), at: Date.now() };
  if (rating === "up" && before !== "up") rateLessons(entry.id, +1);
  // A reply the user didn't like: what was learned from it stops being recalled (score 0).
  if (rating === "down" && before !== "down") rateLessons(entry.id, before === "up" ? -2 : -1);
  saveChat(chat);

  const settings = loadSettings();
  if (rating === "down" && settings.learning !== false) {
    // Learn from what went wrong: the request and the work that led to this reply.
    let u = i;
    while (u >= 0 && chat.entries[u]?.kind !== "user") u--;
    const user = chat.entries[u];
    const bots = listBots();
    const work = chat.entries
      .slice(u + 1, i + 1)
      .filter((e): e is BotEntry => e.kind === "bot")
      .map((e) => ({ entry: e, bot: bots.find((x) => x.id === e.botId) }))
      .filter((x): x is { entry: BotEntry; bot: NonNullable<typeof x.bot> } => !!x.bot);
    try {
      const learned = await reflect(settings, { request: user?.kind === "user" ? user.text : "", work, feedback: { rating, note } }, req.signal);
      if (learned) {
        const fresh = getChat(id);
        const e = fresh?.entries.find((x) => x.id === entry.id);
        if (fresh && e?.kind === "bot") {
          e.learned = mergeLearned(e.learned, learned);
          saveChat(fresh);
          return Response.json({ entry: e });
        }
      }
    } catch {
      /* the rating is saved even if learning fails */
    }
  }
  return Response.json({ entry });
}
