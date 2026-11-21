// The cloud runner (runner/, OOVI_CLOUD_RUNNER=1): which tool calls can run on oovi's server while the user's
// computer is off, and what the bot says when one can't. Pure: tested in tests/unit/cloud-runner.test.mts.
//
// An allow-list, not a block-list: a tool added to the app later needs the computer until it is listed here.
// Everything else (the user's files, desktop control, the bots' browser, documents saved to Downloads, the
// cloud computer on the user's own key, other chats) needs the computer.

/** Tools that work in the cloud: chat, web search, reading pages, places, papers, work tables and notes, routines, Telegram. */
const CLOUD_OK = new Set([
  "web_search",
  "research",
  "read_url",
  "run_helpers",
  "find_places",
  "find_papers",
  "work_table",
  "work_notes",
  // A work table travels with the chat, so its rows are read here (a list built in the cloud is read in the cloud).
  // for_each_row stays on the computer: its ledger of rows already done lives there.
  "read_rows",
  "start_big_job",
  "list_routines",
  "propose_routine",
  "send_telegram",
  "memory",
  "use_skill",
  "save_skill",
  "recall_history",
  "oovi_help",
  "update_plan",
  "propose_plan",
  "ask_user",
  "list_groups",
  "request_abilities",
  "propose_team",
  "propose_specialist",
]);

/**
 * The one way a bot in the cloud leaves a request for the computer. The bot used to be offered every tool of the
 * app there: it picked the computer's browser where reading the page on the server would do, and the whole
 * message ended as "this needs your computer". Now it sees only what runs in the cloud, plus this.
 */
export const HAND_TO_COMPUTER = "hand_to_computer";
export const HAND_SPEC = {
  name: HAND_TO_COMPUTER,
  description:
    "The user's computer is off and this request can't be done without it: their files, a document or file to make or read, the browser, the desktop. Call it first, before any other step: oovi keeps the whole request and runs it on the computer when it is on. Never for something your other tools can do here.",
  parameters: {
    type: "object" as const,
    properties: { what: { type: "string", description: "What needs the computer, in a few words." } },
    required: ["what"],
  },
};

/** Goes with the user's message in the cloud: where the bot is, and the rule (whole, and first). */
export const CLOUD_NOTE =
  `The user's computer is off: this message runs on oovi's cloud server. What you can do here is in your tools; do it now. Their files, making or reading documents and files, the browser and the desktop are on the computer: if the request needs any of them, call ${HAND_TO_COMPUTER} first, before any other step (the whole request then runs there when the computer is on). Don't do one half here, and say nothing about the server or the computer unless something is left for it.`;

/** What the bot is told when it asks for the computer after steps already ran here. */
export const TOO_LATE_FOR_COMPUTER =
  "Not passed to the computer: steps of this request already ran here, and running it again there would do them twice. Tell the user in a few lines what is done, and what is left to ask for when their computer is on.";

/** Steps that can run again on the computer with no harm: they only look. */
const ONLY_LOOKS = new Set(["use_tool", "update_plan", "web_search", "research", "read_url", "find_places", "find_papers", "recall_history", "oovi_help", "list_routines", "list_groups", "use_skill", "read_rows", HAND_TO_COMPUTER]);

/**
 * The computer runs a request left for it from the start. "whole": nothing ran here but lookups, so that is safe.
 * "late": something was sent, saved or set here (a connector, Telegram, a table, a routine), and a second run
 * would do it twice: the request stays here and the bot says what is left.
 */
export function handOver(ranHere: string[]): "whole" | "late" {
  return ranHere.every((n) => ONLY_LOOKS.has(n)) ? "whole" : "late";
}

/** The tools a bot is offered in the cloud: the ones that run there, and the way to leave the request for the computer. */
export function cloudTools<T extends { name: string }>(tools: T[]): (T | typeof HAND_SPEC)[] {
  return [...tools.filter((t) => !needsComputer(t)), HAND_SPEC];
}

/** The on-demand tool guide (lib/tool-defer.ts): judged by the tool it is about. */
const USE_TOOL = "use_tool";

/**
 * True when this call can't run in the cloud. Connector tools (mcp_…) run: only connectors with a web
 * address and their sign-in in the account's vault are installed there (the user's local ones never are).
 */
export function needsComputer(call: { name: string; input?: Record<string, unknown> }): boolean {
  if (call.name === USE_TOOL) {
    const inner = call.input?.name;
    return typeof inner === "string" && inner !== USE_TOOL ? needsComputer({ name: inner }) : false;
  }
  if (call.name.startsWith("mcp_")) return false;
  return !CLOUD_OK.has(call.name);
}

/** The first call of a step that needs the computer, or null. */
export function firstNeedingComputer<T extends { name: string; input?: Record<string, unknown> }>(calls: T[]): T | null {
  return calls.find((c) => needsComputer(c)) ?? null;
}

export type ReplyLocale = "ar" | "fr" | "darija" | "en";

/** What the bot answers, in the user's language (oovi writes it: no model call). */
export function needsComputerText(locale: ReplyLocale): string {
  switch (locale) {
    case "ar":
      return "هذا يحتاج إلى حاسوبك: افتح oovi عليه وسأقوم بذلك.";
    case "fr":
      return "Il faut ton ordinateur pour ça : ouvre oovi dessus et je m'en occupe.";
    case "darija":
      return "Hadi lazemha l'ordinateur ta3ek: 7ell oovi 3lih w ndirha.";
    default:
      return "This needs your computer: open oovi on it and I'll do it.";
  }
}

/** The tool result left in the bot's steps for every call of that step (none of them ran). */
export const NOT_RUN_IN_CLOUD = "Not run: this needs the user's computer (oovi runs it when the computer is on).";

/** The reply's language from the user's latest message: Arabic script, Darija in Latin letters, French, else English. */
export function pickLocale(script: "ar" | "fr" | null, latinDarija: boolean): ReplyLocale {
  if (script === "ar") return "ar";
  if (latinDarija) return "darija";
  return script === "fr" ? "fr" : "en";
}

/**
 * A job's payload (sent by the phone through the website) as the run's input: the same fields the chat's run
 * route accepts, checked the same way. No attachments (files are not synced yet) and nothing only the app
 * itself sets (routine, channel, via). A string is the reason it can't run.
 */
export function runInputOf(kind: string, payload: unknown): Record<string, unknown> | string {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const id = (v: unknown) => (typeof v === "string" && /^[\w-]{1,40}$/.test(v) ? v : undefined);
  if (kind === "message") {
    const text = typeof p.text === "string" ? p.text.trim() : "";
    if (!text) return "empty message";
    if (text.length > 20_000) return "message too long";
    const effort = ["auto", "low", "medium", "high", "max"].includes(String(p.effort)) ? p.effort : undefined;
    // A Telegram message handed to the cloud (web/lib/telegram-cloud-core.ts): its answer goes back to that chat.
    const tg = p.channel === "telegram" && typeof p.telegramChatId === "number" && Number.isSafeInteger(p.telegramChatId) ? { channel: "telegram", telegramChatId: p.telegramChatId } : {};
    return { text, ...tg, ...(effort ? { effort } : {}), deep: p.deep === true, plan: p.plan === true, ...(id(p.entryId) ? { entryId: id(p.entryId) } : {}), ...(id(p.replyTo) ? { replyTo: id(p.replyTo) } : {}) };
  }
  if (kind === "decision") {
    if (p.planDecision && typeof p.planDecision === "object") {
      const d = p.planDecision as { approve?: unknown; items?: unknown };
      const items = Array.isArray(d.items) ? d.items.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 500)).slice(0, 20) : [];
      return { planDecision: { approve: d.approve === true, items } };
    }
    if ("answers" in p && (p.answers === null || Array.isArray(p.answers))) {
      return { answers: p.answers === null ? null : (p.answers as unknown[]).slice(0, 4).map((x) => (typeof x === "string" ? x.slice(0, 1000) : "")) };
    }
    if (p.decisions && typeof p.decisions === "object") {
      const decisions: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(p.decisions as Record<string, unknown>)) if (typeof v === "boolean" && /^[\w-]{1,80}$/.test(k)) decisions[k] = v;
      if (!Object.keys(decisions).length) return "no decision";
      return { decisions, alwaysEdit: false, alwaysFolders: false, allowChat: p.allowChat === true, allowSite: p.allowSite === true };
    }
    return "unknown decision";
  }
  return `unknown kind ${kind}`;
}
