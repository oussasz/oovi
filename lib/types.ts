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
};

export type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export type ApprovalItem = { call: ToolCall; summary: string };

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

export type UserEntry = { id: string; kind: "user"; text: string; at: number };

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
  /** Which model answered, e.g. "Gemini · gemini-2.5-flash". */
  model?: string;
  /** True when a backup model answered because the bot's own model failed. */
  fallback?: boolean;
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
