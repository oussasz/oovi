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

const GUIDE_END = "[/guide]";
const guideOpen = (name: string) => `[guide:${name}]`;

export type Deferral = { sent: ToolSpec[]; deferred: ToolSpec[] };

/** The tools to send: the everyday ones as they are, the on-demand ones folded into `use_tool`. */
export function deferTools(tools: ToolSpec[]): Deferral {
  const deferred = tools.filter((t) => t.name in DEFERRED);
  // Not worth a detour for one small tool, and never twice.
  if (deferred.length < 2 || tools.some((t) => t.name === USE_TOOL)) return { sent: tools, deferred: [] };
  const spec: ToolSpec = {
    name: USE_TOOL,
    description:
      "More tools, loaded when needed. They are yours like the others: when a task calls for one (or your instructions name one that is not in your tool list), use it through this tool. " +
      "First call use_tool with only `name`: you get that tool's guide (what it does, its parameters). Then call use_tool with `name` and `input` filled as the guide says. The guide stays in the conversation: read it once, not before every use.\n" +
      deferred.map((t) => `- ${t.name}: ${DEFERRED[t.name]}`).join("\n"),
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", enum: deferred.map((t) => t.name) },
        input: { type: "object", description: "The tool's parameters, as its guide describes them (leave out to get the guide)" },
      },
      required: ["name"],
    },
  };
  return { sent: [...tools.filter((t) => !(t.name in DEFERRED)), spec], deferred };
}

/** The guide a bot gets the first time it reaches for an on-demand tool. */
export function guideText(t: ToolSpec): string {
  return `${guideOpen(t.name)}\n${t.name}: ${t.description}\n\nParameters (JSON schema) for use_tool's \`input\`:\n${JSON.stringify(t.parameters)}\n\nNow call use_tool with name "${t.name}" and \`input\` filled in.\n${GUIDE_END}`;
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
    if (!d.deferred.some((t) => t.name === target) || !input || !Object.keys(input).length || !guideSeen(sent, target)) return c;
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
export function useToolResult(c: ToolCall, tools: ToolSpec[]): ToolResult {
  const target = String(c.input.name ?? "").trim();
  const spec = tools.find((t) => t.name === target);
  const onDemand = tools.filter((t) => t.name in DEFERRED).map((t) => t.name);
  if (!spec) return { id: c.id, name: c.name, content: `There is no tool named "${target}". use_tool gives: ${onDemand.join(", ") || "nothing here"}.`, isError: true };
  if (!(target in DEFERRED)) return { id: c.id, name: c.name, content: `${target} is in your tool list: call it directly, not through use_tool.`, isError: true };
  return { id: c.id, name: c.name, content: guideText(spec) };
}
