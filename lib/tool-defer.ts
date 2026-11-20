// Tools on demand. Every request carries the full description of every tool a bot has, and a few rarely
// used tools (images, slides, spreadsheets with charts, papers…) are a large part of that. Those are sent
// as one line each inside a single `use_tool` tool; their full guide is given the first time one is needed,
// as a tool result (so the instructions and tools at the top of the request never change, and stay cached).
// The rest of the app keeps seeing the real tool names: calls are unwrapped when they arrive and wrapped
// again when the conversation is sent. Pure (types only): tests/unit/tool-defer.test.mts.
import type { ToolSpec } from "./llm";
import type { Msg, ToolCall, ToolResult } from "./types";

export const USE_TOOL = "use_tool";

/**
 * Tools sent on demand, with the one line that says when to reach for each. Only tools the user asks for
 * by name of the thing ("a poster", "slides", "an Excel file with a chart"): tools a bot must think of by
 * itself in the middle of a job (find_places, find_papers, scrape_list, propose_routine…) stay in full.
 */
export const DEFERRED: Record<string, string> = {
  create_image: "design a finished picture (PNG) from text, colours and an optional photo: social media post, poster or flyer, quote card, simple infographic",
  create_presentation: "make a PowerPoint deck (.pptx) with a designed cover, native charts, tables and pictures",
  create_spreadsheet: "make an Excel workbook (.xlsx) or CSV from scratch: several sheets, formulas, number formats, native charts (to deliver a work table, use work_export instead)",
  edit_copy_of_file: "make an edited copy of a file on the user's computer (Word, PowerPoint, Excel, text); the original is never changed",
};

/**
 * Tools sent in one line too, but called in ONE step: the line names their parameters, the first call is the
 * real call, and its result brings the tool's full guide along (withFirstGuide), so nothing is paid to learn
 * it. Why: the fixed part of every request was about 22,000 tokens, two thirds of it tool descriptions, and a
 * cold conversation pays to write all of it again (2.7 credits for "what is 15% of 2400?", measured). These
 * are tools most conversations never touch, or whose first call is a lookup and not the deliverable. A tool
 * whose first call IS the deliverable (a deck, a designed image) stays in DEFERRED: its guide comes first.
 */
export const DIRECT: Record<string, string> = {
  read_rows: "work on a table without loading it (an attached Excel or CSV file, or a work table): chosen rows (filter is a list like [{\"column\":\"City\",\"op\":\"=\",\"value\":\"Alger\"}], with only the columns you need), counts and sums per group (group_by, values), or a part of it copied into a work table to deliver as a file (save_to_table)",
  edit_attachment: "make an edited copy of a file the user attached (Word, PowerPoint, Excel, text): replacements, cells and formulas; the original is never changed",
  recall_history: "search the full saved history of this conversation for an exact detail that is no longer in view (a number, a name, a link, a file)",
  work_table: "the team's shared tables in this chat: any list you build or keep (prospects, contacts, products, sources, tasks). Actions: add, replace, read, update, remove, columns, chart. The user sees it in the Canvas",
  work_notes: "the team's shared notes: long text that doesn't belong in a chat message (findings, a draft, a report). Actions: append, write, read",
  work_export: "turn a work table or notes into a real file for the user, complete, without retyping: Excel, CSV, Word, PDF or Markdown",
  find_places: "businesses and places of a city or district (restaurants, shops, clinics…) in ONE call from open map data, with address, phone, email and site, straight into a work table: use it FIRST for any list of local businesses",
  find_papers: "scientific and scholarly publications on a topic in ONE call (title, authors, year, journal, link), straight into a work table",
  scrape_list: "a whole list from a website (a directory, a catalogue, results pages; all its pages, each item's own page with details=true) into a work table in ONE call",
  extract_list: "every item of the list on the page open in your browser, in one step (results, a directory, a table)",
  propose_routine: "something to do again and again at a time (\"every day at 10…\", \"each Monday…\", \"كل يوم على 8…\", \"chaque matin…\"), a one-time reminder, a task for later, or watching a page for news: set it up instead of doing it once",
  list_routines: "the user's routines and reminders, and when each runs",
  propose_team: "create a new group of bots for a job, with the user's OK (when they ask for a team, or no group fits)",
  propose_specialist: "propose a specialist bot when a job needs a skill nobody on the team has",
  use_project_folder: "ask the user to let this chat work in a folder on their computer (a project they name, code, a site)",
  start_big_job: "call first when the request needs long, heavy work (a long list, many items to find or check, deep research, a large document): it lifts the limits on steps",
  request_abilities: "ask the user to turn on an ability you lack (web, browser, their signed-in accounts, a connector) with one click",
  run_helpers: "hand 2 to 5 independent parts of a big job to helpers that work at the same time (one city, competitor or source each)",
  replay_skill: "run a skill the user recorded by showing it: their steps are repeated in your browser",
  upload_file: "attach a file from the user's computer to the page open in your browser (an email attachment, an import field)",
  save_skill: "save a reliable multi-step procedure as a skill, so the same kind of task is faster next time",
  send_telegram: "send a message to the user's own Telegram now, when they ask to get something there or on their phone",
  oovi_help: "how oovi itself works: where things are, how to connect, enable or set something up in the app (instead of guessing)",
  find_files: "find files on the user's computer by name (Desktop, Documents, Downloads…)",
  list_folder: "what is in a folder on the user's computer",
  read_computer_file: "read a file on the user's computer by its full path (PDF, Office, CSV, text, images)",
  send_file_to_user: "give the user a file from their computer in the chat (and on Telegram)",
  copy_file_to_downloads: "copy a file from the user's computer into their Downloads/oovi folder",
};

const GUIDE_END = "[/guide]";
const guideOpen = (name: string) => `[guide:${name}]`;

export type Deferral = { sent: ToolSpec[]; deferred: ToolSpec[] };

/** The tools to send: the everyday ones as they are, the on-demand ones folded into `use_tool`. */
/** Above this many connector tools, they are sent on demand too (measured: 60 of them made a 34-step job cost
 * 35% more, tests/e2e/cost-scenario.cjs with OOVI_COST_MCP=60). */
export const MANY_CONNECTOR_TOOLS = 15;

/** One line that says when to reach for a connector tool: the first sentence of its description. */
const lineOf = (t: ToolSpec) => (DEFERRED[t.name] ?? DIRECT[t.name] ?? (t.description || t.name).split(/(?<=[.!?])\s/)[0]!.replace(/\s+/g, " ").slice(0, 110));

/**
 * A connector tool's parameter names, the optional ones with "?": enough to call it at the first try. Reading
 * a guide first cost one more model call for every connector tool a bot touched (measured: 8 of the 14 calls
 * behind one email were guide round trips).
 */
const signature = (t: ToolSpec) => {
  const p = t.parameters as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  const names = Object.keys(p?.properties ?? {});
  if (!names.length) return "()";
  const req = new Set(p?.required ?? []);
  return `(${[...names.filter((n) => req.has(n)), ...names.filter((n) => !req.has(n)).map((n) => `${n}?`)].slice(0, 10).join(", ")})`;
};

/** A connector tool's parameters, given with an error: the bot corrects its call without a round trip for the guide. */
export const paramsHint = (t: ToolSpec) => `Parameters of ${t.name} (JSON schema): ${JSON.stringify(t.parameters)}`;

const oneStep = (name: string) => name.startsWith("mcp_") || name in DIRECT;

/** A result that starts with a tool's guide, in its two parts (the guide is kept whole when old results are shortened). */
export function splitGuide(content: string): { guide: string; rest: string } {
  if (!content.startsWith("[guide:")) return { guide: "", rest: content };
  const end = content.indexOf(GUIDE_END);
  if (end < 0) return { guide: "", rest: content };
  return { guide: content.slice(0, end + GUIDE_END.length), rest: content.slice(end + GUIDE_END.length).replace(/^\n/, "") };
}

/**
 * The first result of a one-step tool in a conversation, with the tool's guide in front of it (its full
 * description and parameters): the bot learns the details from its first use, with no call spent asking.
 * `history`: the conversation so far (a guide already there isn't given twice).
 */
export function withFirstGuide(r: ToolResult, spec: ToolSpec, history: Msg[], extra?: { key: string; text: string } | null): ToolResult {
  const given = (key: string) => history.some((m) => m.role === "tool" && m.results.some((x) => x.content.includes(guideOpen(key))));
  // Guidance about a group of tools (the browser, the work files): with the first result of any of them.
  const more = extra && !given(extra.key) ? extra : null;
  if (spec.name in DIRECT) {
    const own = !given(spec.name);
    if (!own && !more) return r;
    // An error keeps the tool's own guide (it says how to call it), not the guidance about using its results.
    if (r.isError && !own) return r;
    const parts = [
      ...(own ? [guideOpen(spec.name), `${spec.name}: ${spec.description}`, `Parameters (JSON schema): ${JSON.stringify(spec.parameters)}`] : []),
      ...(more && !r.isError ? [...(more.key !== spec.name || !own ? [guideOpen(more.key)] : []), more.text] : []),
    ];
    return { ...r, content: `${parts.join("\n")}\n${GUIDE_END}\n${r.content}` };
  }
  if (!more || r.isError) return r;
  return { ...r, content: `${guideOpen(more.key)}\n${more.text}\n${GUIDE_END}\n${r.content}` };
}

/** Whether this tool is sent on demand, among these tools. */
export function onDemand(tools: ToolSpec[], name: string): boolean {
  if (name in DEFERRED || name in DIRECT) return true;
  return name.startsWith("mcp_") && tools.filter((t) => t.name.startsWith("mcp_")).length > MANY_CONNECTOR_TOOLS;
}

export function deferTools(tools: ToolSpec[]): Deferral {
  const deferred = tools.filter((t) => onDemand(tools, t.name));
  // Not worth a detour for one small tool, and never twice.
  if (deferred.length < 2 || tools.some((t) => t.name === USE_TOOL)) return { sent: tools, deferred: [] };
  const spec: ToolSpec = {
    name: USE_TOOL,
    description:
      "More tools, loaded when needed. They are yours like the others: when a task calls for one (or your instructions name one that is not in your tool list), use it through this tool. " +
      "A tool listed with its parameters in brackets is called at once: use_tool with `name` and `input`. For the others, first call use_tool with only `name`: you get that tool's guide (what it does, its parameters); then call use_tool with `name` and `input` filled as the guide says. A guide stays in the conversation: read it once, not before every use.\n" +
      deferred.map((t) => `- ${t.name}${oneStep(t.name) ? signature(t) : ""}: ${lineOf(t)}`).join("\n"),
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", enum: deferred.map((t) => t.name) },
        input: { type: "object", description: "The tool's parameters, as its guide describes them (leave out to get the guide)" },
      },
      required: ["name"],
    },
  };
  return { sent: [...tools.filter((t) => !onDemand(tools, t.name)), spec], deferred };
}

/** The guide a bot gets the first time it reaches for an on-demand tool. */
export function guideText(t: ToolSpec, extra = ""): string {
  return `${guideOpen(t.name)}\n${t.name}: ${t.description}${extra ? `\n${extra}` : ""}\n\nParameters (JSON schema) for use_tool's \`input\`:\n${JSON.stringify(t.parameters)}\n\nNow call use_tool with name "${t.name}" and \`input\` filled in.\n${GUIDE_END}`;
}

/** The guide of this tool is in the conversation as sent, whole (an older one that was shortened doesn't count). */
export function guideSeen(messages: Msg[], name: string): boolean {
  const open = guideOpen(name);
  return messages.some((m) => m.role === "tool" && m.results.some((r) => r.content.startsWith(open) && r.content.trimEnd().endsWith(GUIDE_END)));
}

/** A tool result that is a guide: it must stay whole while the conversation lasts. */
export const isGuide = (r: ToolResult) => r.content.startsWith("[guide:");

function inputOf(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      const j: unknown = JSON.parse(raw);
      return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The model's calls as the app runs them: a `use_tool` call for a tool whose guide it has read becomes
 * that tool's own call. One without input, or made before reading the guide, stays a `use_tool` call
 * (answered with the guide by useToolResult).
 */
export function unwrapCalls(calls: ToolCall[], d: Deferral, sent: Msg[]): ToolCall[] {
  if (!d.deferred.length) return calls;
  return calls.map((c) => {
    if (c.name !== USE_TOOL) return c;
    const target = String(c.input.name ?? "");
    const input = inputOf(c.input.input);
    const spec = d.deferred.find((t) => t.name === target);
    if (!spec) return c;
    // A connector tool that takes no parameters has nothing to be told: naming it is calling it.
    const takesNothing = oneStep(target) && !Object.keys((spec.parameters as { properties?: object } | undefined)?.properties ?? {}).length;
    if (takesNothing) return { id: c.id, name: target, input: input ?? {} };
    if (!input || !Object.keys(input).length || !(oneStep(target) || guideSeen(sent, target))) return c;
    return { id: c.id, name: target, input };
  });
}

/** The conversation as sent: calls to on-demand tools are shown the way the model makes them, through `use_tool`. */
export function wrapHistory(messages: Msg[], d: Deferral): Msg[] {
  if (!d.deferred.length) return messages;
  const names = new Set(d.deferred.map((t) => t.name));
  return messages.map((m) => {
    if (m.role === "assistant" && m.toolCalls.some((c) => names.has(c.name))) {
      return { ...m, toolCalls: m.toolCalls.map((c) => (names.has(c.name) ? { id: c.id, name: USE_TOOL, input: { name: c.name, input: c.input } } : c)) };
    }
    if (m.role === "tool" && m.results.some((r) => names.has(r.name))) return { ...m, results: m.results.map((r) => (names.has(r.name) ? { ...r, name: USE_TOOL } : r)) };
    return m;
  });
}

/** The answer to a `use_tool` call that was not turned into a real call: the guide, or what went wrong. */
export function useToolResult(c: ToolCall, tools: ToolSpec[], extraOf: (name: string) => string = () => ""): ToolResult {
  const target = String(c.input.name ?? "").trim();
  const spec = tools.find((t) => t.name === target);
  const listed = tools.filter((t) => onDemand(tools, t.name)).map((t) => t.name);
  if (!spec) return { id: c.id, name: c.name, content: `There is no tool named "${target}". use_tool gives: ${listed.join(", ") || "nothing here"}.`, isError: true };
  if (!onDemand(tools, target)) return { id: c.id, name: c.name, content: `${target} is in your tool list: call it directly, not through use_tool.`, isError: true };
  return { id: c.id, name: c.name, content: guideText(spec, extraOf(target)) };
}
