// The tools that change the user's team, each behind an approval card (rules: lib/team-admin-core.ts):
// - request_abilities (any bot talking with the user; the Chief also for another bot),
// - propose_team (the Chief): a new group with existing and new bots, ready for message_group.
import type { ApprovalItem, Bot, ToolCall, ToolResult } from "./types";
import type { ToolSpec } from "./llm";
import { translateFor } from "./i18n-server";
import { abilityRequest, teamPlan, ABILITIES, NEW_BOTS_MAX, TEAM_MAX, type Ability, type AbilityRequest, type TeamPlan } from "./team-admin-core";
import { createBot, createGroup, listBots, listChats, updateBot, validateBot } from "./store";
import { randomFace } from "./faces";

export const REQUEST_ABILITIES_SPEC: ToolSpec = {
  name: "request_abilities",
  description:
    "Ask the user to turn on an ability you (or, for the Chief, another bot) don't have: web (Web search), browser (open pages, click, type), accounts (post, comment and send messages as the user on sites they signed in to; needs the browser, which it turns on too). The user sees a card with what it allows and why, and decides. Use it instead of explaining menus when a task needs an ability that's off. After the user agrees, carry on with the task.",
  parameters: {
    type: "object",
    properties: {
      abilities: { type: "array", items: { type: "string", enum: [...ABILITIES] } },
      why: { type: "string", description: "One sentence the user sees, e.g. 'To post your text on your Facebook page.'" },
      bot: { type: "string", description: "Chief only: the bot that should get it (default: you)" },
    },
    required: ["abilities", "why"],
  },
};

export const PROPOSE_TEAM_SPEC: ToolSpec = {
  name: "propose_team",
  description: `Create a new group (a team) for a job, with the user's OK: pick fitting bots from the user's bots (members) and add new ones the job needs (new_bots, at most ${NEW_BOTS_MAX}). ${TEAM_MAX} bots at most. The user sees a card and decides. After they agree, give the team the job with message_group. Use an existing group instead when one already fits.`,
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Team name, e.g. 'Launch'" },
      purpose: { type: "string", description: "One sentence the user sees: what the team is for" },
      members: { type: "array", items: { type: "string" }, description: "Names of existing bots" },
      new_bots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "One word, easy to @mention" },
            role: { type: "string", description: "Short job title" },
            instructions: { type: "string", description: "What it's expert in and what it delivers" },
            web: { type: "boolean", description: "Web search (default on)" },
            browser: { type: "boolean", description: "Browser (default off)" },
          },
          required: ["name", "role", "instructions"],
        },
      },
      leader: { type: "string", description: "Which team member leads it (default: the first)" },
    },
    required: ["name", "purpose"],
  },
};

export const ADMIN_TOOLS: ReadonlySet<string> = new Set([REQUEST_ABILITIES_SPEC.name, PROPOSE_TEAM_SPEC.name]);

const groupNames = () => listChats().filter((c) => c.kind === "group").map((c) => c.name);
const label = (a: Ability) => translateFor(a === "web" ? "bot.web" : a === "browser" ? "bot.browser" : "bot.accounts");

/** The checked request, or an error for the bot (then no card is shown). */
export function adminCheck(call: ToolCall, self: Bot, isMain: boolean): AbilityRequest | TeamPlan | string {
  if (call.name === REQUEST_ABILITIES_SPEC.name) return abilityRequest(call.input, self, listBots(), isMain);
  if (!isMain) return "Only the Chief can create teams.";
  return teamPlan(call.input, listBots(), groupNames());
}

/** The approval card, in the app's language and with the app's own labels. */
export function adminItem(call: ToolCall, self: Bot, isMain: boolean): ApprovalItem {
  const r = adminCheck(call, self, isMain);
  if (typeof r === "string") return { call, summary: r };
  if ("turnOn" in r) {
    const does = r.turnOn.map((a) => translateFor(a === "web" ? "admin.webDoes" : a === "browser" ? "admin.browserDoes" : "admin.accountsDoes", { label: label(a) }));
    if (r.turnOn.includes("accounts")) does.push(translateFor("admin.accountsNext", { place: translateFor("bot.accountsLink") }));
    return { call, summary: translateFor("admin.abilities", { abilities: r.turnOn.map(label).join(" + "), bot: r.botName }), detail: [translateFor("admin.why", { why: r.why }), ...does].join("\n") };
  }
  const lines = [
    r.purpose,
    translateFor("admin.teamLead", { name: r.leader }),
    ...(r.existing.length ? [translateFor("admin.teamExisting", { names: r.existing.map((e) => e.name).join(", ") })] : []),
    ...r.created.map((c) => `${translateFor("admin.teamNew", { name: c.name, role: c.role })}${c.browser ? ` (${label("browser")})` : ""}\n  ${c.instructions}`),
  ];
  return { call, summary: translateFor("admin.team", { name: r.name, count: r.existing.length + r.created.length }), detail: lines.join("\n") };
}

/** Whether a call is valid (only valid ones ask the user; invalid ones return their error to the bot). */
export const adminValid = (call: ToolCall, self: Bot, isMain: boolean) => typeof adminCheck(call, self, isMain) !== "string";

/** Runs after the user said yes. Everything is checked again: the team may have changed meanwhile. */
export function runAdminTool(call: ToolCall, self: Bot, isMain: boolean): ToolResult {
  const ok = (content: string): ToolResult => ({ id: call.id, name: call.name, content });
  const bad = (content: string): ToolResult => ({ id: call.id, name: call.name, content, isError: true });
  const r = adminCheck(call, self, isMain);
  if (typeof r === "string") return bad(r);

  if ("turnOn" in r) {
    const bot = listBots().find((b) => b.id === r.botId);
    if (!bot) return bad(`${r.botName} no longer exists.`);
    const tools = { ...bot.tools, ...Object.fromEntries(r.turnOn.map((a) => [a, true])) };
    const input = validateBot({ ...bot, tools }, bot.id);
    if (typeof input === "string") return bad(input);
    if (!updateBot(bot.id, input)) return bad(`Couldn't update ${bot.name}.`);
    const next = r.turnOn.includes("accounts")
      ? ` If the site isn't signed in yet, ask the user to sign in once under "${translateFor("bot.accountsLink")}" (or call request_user_takeover so they sign in in your browser).`
      : "";
    return ok(`Turned on ${r.turnOn.join(", ")} for ${bot.name}. ${bot.id === self.id ? "You can use it from your next step: carry on with the task." : `${bot.name} can use it now.`}${next}`);
  }

  const created: Bot[] = [];
  for (const c of r.created) {
    const input = validateBot({ name: c.name, role: c.role, instructions: c.instructions, face: randomFace(), tools: { web: c.web, browser: c.browser } });
    if (typeof input === "string") return bad(`${c.name}: ${input}`);
    created.push(createBot(input));
  }
  const ids = [...r.existing.map((e) => e.id), ...created.map((b) => b.id)];
  const lead = [...r.existing, ...created].find((b) => b.name === r.leader);
  const group = createGroup({ name: r.name, memberIds: ids, leadId: lead?.id, orchestrate: true });
  return ok(`Created the team "${group.name}" led by ${r.leader}, with ${[...r.existing.map((e) => e.name), ...created.map((b) => b.name)].join(", ")}. Now give it the job with message_group (group: "${group.name}").`);
}
