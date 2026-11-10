// What a bot may ask the user to change in their team, checked before any card is shown:
// - request_abilities: turn on Web search / Browser / "Use my signed-in accounts" for itself
//   (the Chief also for another bot), so a bot offers the fix instead of explaining menus;
// - propose_team: the Chief creates a group with existing bots and new ones, then runs it.
// Nothing changes until the user clicks the card. Pure: tested in tests/unit/team-admin.test.mts.

export type Ability = "web" | "browser" | "accounts";
export const ABILITIES: readonly Ability[] = ["web", "browser", "accounts"];

type BotLike = { id: string; name: string; tools: { web: boolean; browser: boolean; accounts?: boolean } };

/** Same naming rules as bots made in the app (lib/mentions NAME_RE, lib/store validateBot); a test keeps them equal. */
export const NAME_RE = /^[\p{L}\p{N}_-]{1,24}$/u;
const RESERVED = ["all", "everyone", "user", "you"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const byName = (bots: BotLike[], name: string) => bots.find((b) => b.name.toLowerCase() === name.trim().replace(/^@/, "").toLowerCase());

// ---------- request_abilities ----------

export type AbilityRequest = { botId: string; botName: string; turnOn: Ability[]; why: string };

/**
 * A valid request, or an error for the bot. Only the Chief may ask for another bot.
 * "accounts" needs the browser, so it brings "browser" with it.
 */
export function abilityRequest(input: Record<string, unknown>, self: BotLike, bots: BotLike[], canForOthers: boolean): AbilityRequest | string {
  const named = str(input.bot, 40);
  const target = named ? byName(bots, named) : self;
  if (!target) return `No bot called "${named}". Bots: ${bots.map((b) => b.name).join(", ")}.`;
  if (target.id !== self.id && !canForOthers) return `Only the Chief can turn on abilities for another bot. Ask for your own, or tell the user that ${target.name} can do it.`;
  const asked = (Array.isArray(input.abilities) ? input.abilities : []).filter((a): a is Ability => (ABILITIES as readonly string[]).includes(String(a)));
  if (!asked.length) return `Say which abilities to turn on: ${ABILITIES.join(", ")}.`;
  const want = new Set<Ability>(asked);
  if (want.has("accounts")) want.add("browser");
  const has = { web: !!target.tools.web, browser: !!target.tools.browser, accounts: !!target.tools.browser && !!target.tools.accounts };
  const turnOn = ABILITIES.filter((a) => want.has(a) && !has[a]);
  if (!turnOn.length) return `${target.name} already has ${asked.join(" and ")}. Go ahead and use it.`;
  const why = str(input.why, 300);
  if (!why) return "Say in one sentence why (the user sees it on the card).";
  return { botId: target.id, botName: target.name, turnOn, why };
}

// ---------- propose_team ----------

export type NewBot = { name: string; role: string; instructions: string; web: boolean; browser: boolean };
export type TeamPlan = { name: string; purpose: string; existing: { id: string; name: string }[]; created: NewBot[]; leader: string };

export const TEAM_MAX = 8;
export const NEW_BOTS_MAX = 5;

/** A team the user can approve, or an error for the Chief. groupNames: the user's current groups. */
export function teamPlan(input: Record<string, unknown>, bots: BotLike[], groupNames: string[]): TeamPlan | string {
  const name = str(input.name, 48);
  if (!name) return "Give the team a name.";
  if (groupNames.some((g) => g.toLowerCase() === name.toLowerCase())) return `There's already a group called "${name}". Give that group the job with message_group, or pick another name.`;
  const purpose = str(input.purpose, 300);
  if (!purpose) return "Say in one sentence what the team is for (the user sees it on the card).";

  const existing: { id: string; name: string }[] = [];
  for (const raw of Array.isArray(input.members) ? input.members : []) {
    const b = byName(bots, String(raw));
    if (!b) return `No bot called "${String(raw)}". Bots: ${bots.map((x) => x.name).join(", ")}. To add a new one, put it in new_bots.`;
    if (!existing.some((e) => e.id === b.id)) existing.push({ id: b.id, name: b.name });
  }

  const created: NewBot[] = [];
  const rawNew = Array.isArray(input.new_bots) ? input.new_bots : [];
  if (rawNew.length > NEW_BOTS_MAX) return `At most ${NEW_BOTS_MAX} new bots at once.`;
  for (const r of rawNew) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const n = str(o.name, 40);
    if (!NAME_RE.test(n)) return `"${n}": a bot name is one word (letters, numbers, - or _), up to 24 characters.`;
    if (RESERVED.includes(n.toLowerCase())) return `"${n}" is reserved. Pick another name.`;
    if (byName(bots, n) || created.some((c) => c.name.toLowerCase() === n.toLowerCase())) return `There's already a bot called ${n}. Use it in members, or pick another name.`;
    const role = str(o.role, 40);
    if (!role) return `Give ${n} a role (a short job title).`;
    const instructions = str(o.instructions, 2000);
    if (instructions.length < 40) return `Write fuller instructions for ${n}: what it's expert in and what it delivers.`;
    // Signed-in accounts are never given here: they're asked for on their own (request_abilities).
    created.push({ name: n, role, instructions, web: o.web !== false, browser: o.browser === true });
  }

  const total = existing.length + created.length;
  if (total < 2) return "A team needs at least 2 bots.";
  if (total > TEAM_MAX) return `A team has at most ${TEAM_MAX} bots.`;
  const all = [...existing.map((e) => e.name), ...created.map((c) => c.name)];
  const leadName = str(input.leader, 40).replace(/^@/, "");
  const leader = leadName ? all.find((n) => n.toLowerCase() === leadName.toLowerCase()) : all[0];
  if (!leader) return `The leader must be one of the team: ${all.join(", ")}.`;
  return { name, purpose, existing, created, leader };
}
