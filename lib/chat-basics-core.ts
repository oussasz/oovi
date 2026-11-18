// Chat basics: search in a chat and across chats, a copy of a chat from one message ("fork"), a chat as a
// Markdown file, and quoting a message when replying. Pure (no files): tests/unit/chat-basics.test.mts.
import type { Chat, Entry } from "./types";

/** Folds case, accents and Arabic vowel marks, so "cafe" finds "Café" and "مدرسة" finds "مَدْرَسَة". */
export function fold(s: string): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/ـ/g, "") // Arabic tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase();
}

/** The text a person reads for an entry (a bot's reply, or what the user wrote). */
export const entryText = (e: Entry): string => (e.kind === "user" ? (e.command ? `${e.command} ${e.text}` : e.text) : e.text || "");

export type Hit = { chatId: string; entryId: string; who: string; snippet: string; at: number };

/** A short piece of text around the first match: about `width` characters, on word edges. */
export function snippetAround(text: string, query: string, width = 140): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  const f = fold(flat);
  const q = fold(query.trim());
  // fold() can change lengths (decomposed letters lose their marks): map back by searching the folded text
  // of growing prefixes is costly; positions in NFKD-folded text match closely enough for a preview.
  const at = Math.max(0, f.indexOf(q));
  const start = Math.max(0, at - Math.floor((width - q.length) / 2));
  let s = flat.slice(start, start + width);
  if (start > 0) s = `…${s.replace(/^\S*\s/, "")}`;
  if (start + width < flat.length) s = `${s.replace(/\s\S*$/, "")}…`;
  return s;
}

/**
 * Messages whose text holds every word of the query (in any order, any case, with or without accents).
 * Newest first, at most `limit`. `who` names the author ("You" for the user).
 */
export function searchChats(chats: Chat[], query: string, nameOf: (botId: string) => string, limit = 50): Hit[] {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 0);
  if (!words.length || query.trim().length < 2) return [];
  const hits: Hit[] = [];
  for (const c of chats)
    for (const e of c.entries) {
      if (e.kind === "user" && e.via) continue; // tasks the main bot passed on: not the user's words
      const text = entryText(e);
      if (!text) continue;
      const f = fold(text);
      if (!words.every((w) => f.includes(w))) continue;
      hits.push({ chatId: c.id, entryId: e.id, who: e.kind === "user" ? "You" : nameOf(e.botId), snippet: snippetAround(text, words[0]!), at: e.at });
    }
  return hits.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** The ids of a chat's messages that match (for "find in this chat"), oldest first. */
export function findInChat(chat: Chat, query: string): string[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return chat.entries.filter((e) => ((f) => !!f && words.every((w) => f.includes(w)))(fold(entryText(e)))).map((e) => e.id);
}

/**
 * A new chat holding the conversation up to and including `entryId`, to try another direction without losing
 * the original. Waiting cards, a running job and summaries past that point are left behind.
 */
export function forkChat(chat: Chat, entryId: string, id: string, now: number, name: string): Chat | string {
  const i = chat.entries.findIndex((e) => e.id === entryId);
  if (i < 0) return "That message isn't in this chat any more.";
  const entries = JSON.parse(JSON.stringify(chat.entries.slice(0, i + 1))) as Entry[];
  for (const e of entries)
    if (e.kind === "bot") {
      // A copy never resumes waiting cards or a reply that was cut short: it reads as it ended.
      if (e.status === "running" || e.status === "waiting") e.status = "stopped";
      delete e.questions;
    }
  const keepSummary = chat.summary && entries.some((e) => e.id === chat.summary!.upTo);
  return {
    id,
    kind: chat.kind,
    name: name.slice(0, 48),
    memberIds: [...chat.memberIds],
    ...(chat.leadId ? { leadId: chat.leadId } : {}),
    ...(chat.orchestrate !== undefined ? { orchestrate: chat.orchestrate } : {}),
    createdAt: now,
    updatedAt: now,
    entries,
    ...(keepSummary ? { summary: { ...chat.summary! } } : {}),
    ...(chat.workspace ? { workspace: { ...chat.workspace } } : {}),
    forkOf: { chatId: chat.id, entryId },
  };
}

const when = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

/** The chat as a Markdown file: who wrote what and when, files sent, without the bots' inner steps. */
export function chatMarkdown(chat: Chat, title: string, nameOf: (botId: string) => string): string {
  const out = [`# ${title}`, "", `_Exported from oovi on ${when(Date.now())} (UTC)._`, ""];
  for (const e of chat.entries) {
    if (e.kind === "user") {
      if (e.via) continue;
      out.push(`## You · ${when(e.at)}`, "");
      if (e.replyTo) out.push(`> ${e.replyTo.who}: ${e.replyTo.text.replace(/\n/g, " ")}`, "");
      out.push(entryText(e) || "", "");
      for (const a of e.attachments ?? []) out.push(`- 📎 ${a.name}`);
      if (e.attachments?.length) out.push("");
    } else {
      if (!e.text) continue;
      out.push(`## ${nameOf(e.botId)} · ${when(e.at)}`, "", e.text, "");
      const files = e.steps.flatMap((m) => (m.role === "tool" ? m.results.map((r) => r.file?.name).filter((n): n is string => !!n) : []));
      for (const f of files) out.push(`- 📄 ${f}`);
      if (files.length) out.push("");
    }
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** What a reply quotes: who wrote the message, and its start (one line, at most 300 characters). */
export function quoteOf(e: Entry, nameOf: (botId: string) => string): { id: string; who: string; text: string } {
  const t = entryText(e).replace(/\s+/g, " ").trim();
  return { id: e.id, who: e.kind === "user" ? "You" : nameOf(e.botId), text: t.length > 300 ? `${t.slice(0, 299)}…` : t };
}

/** How the model reads a reply to a message. */
export const replyNote = (q: { who: string; text: string }) => `[Replying to ${q.who === "You" ? "the user's own earlier message" : `${q.who}'s message`}: "${q.text}"]\n`;
