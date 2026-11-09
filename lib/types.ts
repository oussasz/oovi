// Shared by server and client.
import type { Face } from "./faces";
import type { ProviderId } from "./providers-meta";

// ---------- provider-neutral conversation (what a model sees) ----------

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type ToolResult = {
  id: string;
  name: string;
  content: string;
  isError?: boolean;
  /** URL of a browser screenshot after the action (UI only, never sent to the model). */
  image?: string;
  /** A file the tool created (UI shows Open / Show in folder). */
  file?: { path: string; name: string; size: number };
};

export type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; reasoning?: string }
  | { role: "tool"; results: ToolResult[] };

/** detail: preview shown under the summary (file content, a diff, a command). always: can be allowed for good. */
export type ApprovalItem = { call: ToolCall; summary: string; detail?: string; always?: boolean };

/** The one folder on the user's computer that bots in a chat may work in. */
export type Workspace = {
  path: string;
  /** Create and edit files without asking. Deleting and running commands always ask. */
  autoEdit?: boolean;
};

// ---------- bots ----------

/** accounts: the browser uses the user's signed-in sessions (needs browser). */
export type BotTools = { web: boolean; browser: boolean; accounts?: boolean; mcp?: string[] };

export type Bot = {
  id: string;
  /** One word, used for @mentions. */
  name: string;
  role: string;
  instructions: string;
  face: Face;
  /** Model provider for this bot; empty = the default from Settings. */
  provider?: ProviderId;
  model?: string;
  tools: BotTools;
  createdAt: number;
};

export type BotInput = Omit<Bot, "id" | "createdAt">;

// ---------- chats (a group, or a 1:1 "direct" chat with one bot) ----------

export type Usage = { input: number; output: number };

/** via: sent by the user's main bot on the user's behalf (its bot id). */
/** effort: how hard the bots think for this message. deep: Deep work mode (plan, work longer, verify). */
export type UserEntry = { id: string; kind: "user"; text: string; at: number; via?: string; effort?: Effort; deep?: boolean };
export type Effort = "auto" | "low" | "medium" | "high" | "max";
export type PlanItem = { text: string; status: "pending" | "doing" | "done" };
/** Lessons, user preferences and a skill draft learned from a reply. */
export type LearnedNote = { lessons: string[]; user: string[]; skill?: { name: string; description: string; body: string }; skillSaved?: boolean; at: number };

export type BotEntry = {
  id: string;
  kind: "bot";
  botId: string;
  at: number;
  /** This bot's own model turns and tool results for this reply. */
  steps: Msg[];
  /** Final reply text. */
  text: string;
  status: "running" | "waiting" | "done" | "error" | "stopped";
  error?: string;
  usage: Usage;
  /** US dollars spent on this reply (only counts models whose price is known). */
  cost?: number;
  /** theOovi credits this reply used (hosted model only). */
  credits?: number;
  /** Why a theOovi reply couldn't run: no_credits, daily_limit, offline, signed_out... */
  errorCode?: string;
  /** Something the user should know, e.g. a retired model was replaced. */
  note?: string;
  /** Which model answered, e.g. "Gemini · gemini-2.5-flash". */
  model?: string;
  /** True when a backup model answered because the bot's own model failed. */
  fallback?: boolean;
  /** Deep work checklist the bot keeps up to date. */
  plan?: PlanItem[];
  /** What the bots learned from this reply (self-learning). */
  learned?: LearnedNote;
  /** The user's thumbs up/down on this reply. */
  feedback?: { rating: "up" | "down"; note?: string; at: number };
  /** Teammates this reply handed off to (bot ids). */
  handoff?: string[];
  /** Hand-off requested but the per-message limit was reached. */
  handoffBlocked?: boolean;
};

export type Entry = UserEntry | BotEntry;

export type Approval = { entryId: string; botId: string; items: ApprovalItem[] };

export type Pending = {
  queue: string[];
  turnsLeft: number;
  approval?: Approval;
  /** Leader mode: the leader delegated and gets the turn back when teammates finish. */
  awaitingLead?: boolean;
  /** How many similar requests came before this one (nudges the bot to save a skill). */
  learn?: number;
  /** This bot gets the last word: it gives the user the final answer and the conversation ends. */
  wrapUpFor?: string;
  /** Settings of the message being worked on. */
  effort?: Effort;
  deep?: boolean;
};

export type Chat = {
  id: string;
  kind: "group" | "direct";
  name: string;
  memberIds: string[];
  /** Who answers when a message mentions nobody (the team leader). */
  leadId?: string;
  /** Leader mode (default on): the leader plans, delegates and writes the final answer. */
  orchestrate?: boolean;
  createdAt: number;
  updatedAt: number;
  entries: Entry[];
  pending?: Pending;
  /** Older entries (up to and including upTo) condensed to save tokens. */
  summary?: { upTo: string; text: string };
  /** Project folder the bots in this chat can work in. */
  workspace?: Workspace;
};

export type ChatWithState = Chat & { running: boolean };

export type ChatSummary = {
  id: string;
  kind: Chat["kind"];
  name: string;
  memberIds: string[];
  leadId?: string;
  updatedAt: number;
  preview: string;
  running: boolean;
  waiting: boolean;
};

export type ChatEvent =
  | { type: "entry"; entry: Entry }
  | { type: "status"; entryId: string; text: string }
  | { type: "approval"; approval: Approval }
  | { type: "error"; error: string }
  | { type: "done" };
