// Specialists: a team leader (or the user's main bot) can propose a new bot with a clear role
// when the team lacks a skill the job needs ("a social media copywriter"). It never creates
// anything by itself: the user sees a card with the specialist's face, name, role and
// instructions and creates it with one click (the normal approval flow, worded "Create").
// A specialist made for a group joins that group and stays out of the bots list (hidden),
// since the group is where it works; the user can show it anytime.

import { randomFace, type Face } from "./faces";
import type { ToolSpec } from "./llm";
import { createBot, getChat, listBots, listChats, saveChat, validateBot } from "./store";
import type { ApprovalItem, Bot, Chat, ToolCall, ToolResult } from "./types";

export const PROPOSE_SPECIALIST_SPEC: ToolSpec = {
  name: "propose_specialist",
  description:
    "Propose adding a specialist bot to the team when the job needs a skill nobody on the team has (e.g. social media copywriting, translation, legal review, data analysis). The user sees a card and creates it with one click; then you can hand it work. Don't use it for simple tasks or for a role the team already has.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "One word, easy to @mention, e.g. Lina. Not the name of an existing bot." },
      role: { type: "string", description: "Short job title, e.g. 'Social media copywriter' (max 40 characters)" },
      instructions: { type: "string", description: "How this specialist works: what it's expert in, its standards, the format of its output. Written to the bot ('You are...'). 3-8 sentences." },
      why: { type: "string", description: "One sentence for the user: what the team is missing and what this specialist will do." },
      web: { type: "boolean", description: "Whether it needs to search the web (default true)" },
      group: { type: "string", description: "Only from a direct chat: the group it should join (default: the group you lead)" },
    },
    required: ["name", "role", "instructions", "why"],
  },
};

export const SPECIALIST_TOOLS: ReadonlySet<string> = new Set([PROPOSE_SPECIALIST_SPEC.name]);

export type SpecialistProposal = { name: string; role: string; instructions: string; why: string; web: boolean; face: Face; groupId?: string; groupName?: string };

/** The group a specialist proposed from this chat joins: the chat itself, or (from a direct chat) the named or led group. */
function targetGroup(chat: Chat, self: Bot, groupName: unknown): Chat | undefined {
  if (chat.kind === "group") return chat;
  const groups = listChats().filter((c) => c.kind === "group");
  const q = String(groupName ?? "").trim().toLowerCase();
  if (q) return groups.find((g) => g.name.toLowerCase() === q) ?? groups.find((g) => g.name.toLowerCase().includes(q));
  return groups.find((g) => g.leadId === self.id) ?? groups.find((g) => g.memberIds.includes(self.id));
}

/** propose_specialist's arguments as a proposal, or an error message for the bot. */
export function specialistOf(call: ToolCall, chat: Chat, self: Bot, face: Face = randomFace()): SpecialistProposal | string {
  const i = call.input;
  const v = validateBot({ name: i.name, role: i.role, instructions: i.instructions, face, tools: { web: i.web !== false, browser: false } });
  if (typeof v === "string") return `${v} Pick another name and call propose_specialist again.`;
  if (!v.role) return "Give the specialist a role (a short job title).";
  if (v.instructions.length < 40) return "Write fuller instructions for the specialist (what it's expert in and what it delivers).";
  const why = String(i.why ?? "").trim().slice(0, 300);
  const group = targetGroup(chat, self, i.group);
  if (chat.kind !== "group" && i.group && !group) return `No group called "${String(i.group)}". Groups: ${listChats().filter((c) => c.kind === "group").map((g) => g.name).join(", ") || "none yet"}.`;
  // The same role already on the team: hand the work to that bot instead.
  const team = group ? group.memberIds.map((id) => listBots().find((b) => b.id === id)).filter((b): b is Bot => !!b) : [];
  const same = team.find((b) => b.role.trim().toLowerCase() === v.role.toLowerCase());
  if (same) return `@${same.name} already is the team's ${same.role}. Give the work to ${same.name} instead.`;
  return { name: v.name, role: v.role, instructions: v.instructions, why, web: v.tools.web, face: v.face, ...(group ? { groupId: group.id, groupName: group.name } : {}) };
}

/** The approval card for a proposal (an invalid one runs straight away and returns its error to the bot). */
export function specialistItem(call: ToolCall, chat: Chat, self: Bot): ApprovalItem {
  const p = specialistOf(call, chat, self);
  if (typeof p === "string") return { call, summary: `Create a specialist: ${p}` };
  return {
    call,
    summary: `Create ${p.name}, ${p.role}${p.groupName ? `, in "${p.groupName}"` : ""}`,
    detail: p.instructions,
    specialist: { name: p.name, role: p.role, instructions: p.instructions, why: p.why, web: p.web, face: p.face, ...(p.groupName ? { group: p.groupName } : {}) },
  };
}

/** Whether a proposal is valid (only valid ones ask the user). */
export const specialistValid = (call: ToolCall, chat: Chat, self: Bot) => typeof specialistOf(call, chat, self) !== "string";

/**
 * Create the specialist (reached only after the user clicked Create). In a group, `members`
 * and `chat` are the run's own objects: the new bot joins them so it can be @mentioned in this
 * same run. From a direct chat it joins the target group on disk (no run holds it, or the
 * write is skipped and the user can add it themselves).
 */
export function runSpecialistTool(call: ToolCall, chat: Chat, self: Bot, members: Bot[], bots: Bot[], approved?: ApprovalItem): ToolResult {
  const ok = (content: string): ToolResult => ({ id: call.id, name: call.name, content });
  const bad = (content: string): ToolResult => ({ id: call.id, name: call.name, content, isError: true });
  // Same face as on the card the user saw.
  const p = specialistOf(call, chat, self, approved?.specialist?.face ?? randomFace());
  if (typeof p === "string") return bad(p);
  const bot = createBot({ name: p.name, role: p.role, instructions: p.instructions, face: p.face, tools: { web: p.web, browser: false, accounts: false, mcp: [] }, hidden: !!p.groupId });
  bots.push(bot);
  if (chat.kind === "group") {
    if (!chat.memberIds.includes(bot.id)) chat.memberIds.push(bot.id);
    members.push(bot);
    return ok(`Created @${bot.name} (${bot.role}). ${bot.name} is in this group now (kept out of the user's bots list; they can show it anytime). Hand ${bot.name} its part with an @mention.`);
  }
  if (p.groupId) {
    const g = getChat(p.groupId);
    const running = !!(globalThis as typeof globalThis & { __ooviRuns?: Map<string, unknown> }).__ooviRuns?.has(p.groupId);
    if (g && !running) {
      g.memberIds = [...new Set([...g.memberIds, bot.id])];
      saveChat(g);
      return ok(`Created ${bot.name} (${bot.role}) and added it to the group "${g.name}". Give that group the work with message_group; its leader can @mention ${bot.name}.`);
    }
    return ok(`Created ${bot.name} (${bot.role}). The group "${p.groupName}" is busy, so add ${bot.name} to it later in the group's settings.`);
  }
  return ok(`Created ${bot.name} (${bot.role}). The user can chat with it directly or add it to a group.`);
}
