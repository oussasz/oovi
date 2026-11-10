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
  /** Attachments shown to the model with this result (read_attachment on an image). */
  attach?: AttachRef[];
};

// ---------- attachments (files the user adds to a message) ----------

export type AttachmentKind = "image" | "pdf" | "docx" | "xlsx" | "xls" | "pptx" | "csv" | "text";

/** A file attached to a user message. Stored in the chat's data folder; the model never sees its path. */
export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** Images: pixel size of the original. */
  width?: number;
  height?: number;
  /** PDFs (pages), slides (pptx) or sheets (xlsx). */
  pages?: number;
};

/** An attachment as part of what a model sees. brief: only a one-line mention. doc: send a PDF as a PDF (not text). */
export type AttachRef = { chatId: string; att: Attachment; brief?: boolean; doc?: boolean };

export type Msg =
  | { role: "user"; content: string; attachments?: AttachRef[] }
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; reasoning?: string }
  | { role: "tool"; results: ToolResult[] };

/**
 * detail: preview shown under the summary (file content, a diff, a command). always: edits in the project folder can be allowed for good.
 * folder: a file on this computer; "Always allow this folder" lets bots read and send from this folder without asking.
 */
export type ApprovalItem = { call: ToolCall; summary: string; detail?: string; always?: boolean; folder?: string };

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
/** command: the slash command the message started with ("/zapier", "/effort high"); text is the rest. */
/** plan: sent in Plan mode (the bot proposes a plan the user edits and approves before any work). */
/** routine: sent by a scheduled routine (its id), never by the user or the HTTP API. */
export type UserEntry = { id: string; kind: "user"; text: string; at: number; via?: string; effort?: Effort; deep?: boolean; plan?: boolean; command?: string; attachments?: Attachment[]; routine?: string };
/** A slash command's effect for this message: force a skill, lend a connector, or answer a /help question. `for`: the bots it applies to. */
export type SlashUse = { kind: "skill" | "connector" | "help"; cmd: string; id?: string; name?: string; for: string[]; installed?: boolean; enabled?: boolean };
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
  /** Plan mode: the plan this reply proposed is waiting for the user, or was approved / cancelled. */
  planReview?: "waiting" | "approved" | "cancelled";
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
  /** Plan mode: the bot is drafting a plan (read-only tools + propose_plan) and must not act yet. */
  planMode?: boolean;
  /** Plan mode: this proposed plan waits for the user to edit and approve (or cancel) it. */
  planReview?: { entryId: string; botId: string };
  /** Plan mode: the user approved the plan, so deep work follows their steps. */
  planApproved?: boolean;
  /** A slash command used in the message being worked on. */
  slash?: SlashUse;
  /** Where the user is talking from right now (files bots send go there too). */
  channel?: "telegram";
  /** Which Telegram chat the message came from (the main chat or a chat linked to this group). */
  telegramChatId?: number;
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
  /** This chat belongs to a scheduled routine (its id): every run of the routine happens here. */
  routine?: string;
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

// ---------- routines (scheduled tasks) ----------

/** "HH:MM", 24-hour clock, in the routine's own time zone. */
export type RoutineTime = string;
/** Weekdays: 0 = Sunday … 6 = Saturday. hourly: every N hours (1-24), counted from `from` each day. */
export type RoutineSchedule =
  | { kind: "daily"; time: RoutineTime }
  | { kind: "weekly"; time: RoutineTime; days: number[] }
  | { kind: "hourly"; every: number; from: RoutineTime };

/**
 * ok: the bot answered. error: the run failed. skipped: the chat was busy, a run happened less than
 * 15 minutes before, or it was stopped. missed: oovi was closed (or asleep) for more than 12 hours
 * past the time. waiting: a tool needs the user's OK.
 */
export type RoutineRunStatus = "ok" | "error" | "skipped" | "missed" | "waiting";

export type RoutineRun = {
  at: number;
  status: RoutineRunStatus;
  /** Short reason (error message, "busy", "missed"…). Never shown as HTML. */
  note?: string;
  /** The user entry the run started with, in the routine's chat. */
  entryId?: string;
  /** theOovi's error code when it couldn't run (no_credits, daily_limit…). */
  code?: string;
};

export type Routine = {
  id: string;
  name: string;
  /** The bot that runs it. */
  botId: string;
  prompt: string;
  schedule: RoutineSchedule;
  /** IANA time zone the schedule is read in (the user's machine when it was created). */
  timezone: string;
  enabled: boolean;
  notifyTelegram: boolean;
  createdAt: number;
  updatedAt: number;
  /** Its own chat: every run happens there, so history stays small and runs are comparable. */
  chatId: string;
  lastRun?: RoutineRun;
  /** When the last run started (scheduled or Run now), for the 15-minute floor. */
  lastStartedAt?: number;
  /** Consecutive failed runs; 3 pauses the routine. */
  failures: number;
  /** Next scheduled time (ms), or null when paused. */
  nextRunAt: number | null;
  /** Why the routine was paused automatically ("failures", "bot"). Cleared when it's switched back on. */
  pausedReason?: string;
};

/** A routine as the Routines page sees it. */
export type RoutineView = Routine & { running: boolean };

export type ChatEvent =
  | { type: "entry"; entry: Entry }
  | { type: "status"; entryId: string; text: string }
  | { type: "approval"; approval: Approval }
  | { type: "error"; error: string }
  | { type: "done" };
