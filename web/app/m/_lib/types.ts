// What the phone app reads from the website (contract: docs/CLOUD-BUILD.md, API under /api/v1/cloud).
// Copied from the desktop app's lib/types.ts (only what the phone shows) and from the contract: no imports
// across the app/web boundary. When part W adds web/lib/cloud-types.ts, keep these in step with it.

export type Face = {
  color: number;
  shape: number;
  hair: number;
  eyes: number;
  nose: number;
  mouth: number;
  cheeks: number;
  top: number;
  wear: number;
  image?: string;
};

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };
export type ToolResult = { id: string; name: string; content: string; isError?: boolean };
export type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export type Attachment = { id: string; name: string; mime: string; size: number; kind: string };

export type UserEntry = {
  id: string;
  kind: "user";
  text: string;
  at: number;
  via?: string;
  attachments?: Attachment[];
  routine?: string;
  replyTo?: { id: string; who: string; text: string };
};

export type AskItem = { question: string; options: string[] };
export type PlanItem = { text: string; status: "pending" | "doing" | "done" };

export type BotEntry = {
  id: string;
  kind: "bot";
  botId: string;
  at: number;
  steps?: Msg[];
  text: string;
  held?: boolean;
  status: "running" | "waiting" | "done" | "error" | "stopped";
  error?: string;
  /** Why a reply couldn't run. "needs_computer": the cloud runner could not do this step (contract, Who runs a job). */
  errorCode?: string;
  note?: string;
  credits?: number;
  plan?: PlanItem[];
  planReview?: "waiting" | "approved" | "cancelled";
  questions?: { intro?: string; items: AskItem[]; state: "waiting" | "answered" | "skipped" | "replaced"; answers?: string[] };
  unconfirmed?: string;
};

export type Entry = UserEntry | BotEntry;

export type ApprovalItem = {
  call: ToolCall;
  summary: string;
  detail?: string;
  desktop?: "grant" | "action";
  scope?: { key: string; kind: "site" | "tool"; label: string };
};
export type Approval = { entryId: string; botId: string; items: ApprovalItem[]; at?: number };

export type Pending = {
  approval?: Approval;
  planReview?: { entryId: string; botId: string };
  questions?: { entryId: string; botId: string };
};

export type Chat = {
  id: string;
  kind: "group" | "direct";
  name: string;
  memberIds: string[];
  leadId?: string;
  createdAt: number;
  updatedAt: number;
  entries: Entry[];
  pending?: Pending;
  routine?: string;
  /** Pinned on the computer (ChatWithState.pinned), when the desktop sends it. */
  pinned?: boolean;
};

// ---------- the cloud API (docs/CLOUD-BUILD.md) ----------

export type DeviceKind = "desktop" | "phone" | "runner";
export type CloudDevice = { deviceId: string; kind: DeviceKind; lastSeen: string; online: boolean; name?: string };
export type CloudStatus = {
  enabled: boolean;
  bytes: number;
  limit: number;
  chats: number;
  lastSync: string | null;
  devices: CloudDevice[];
};
export type ChatListItem = { chatId: string; version: number; updatedAt: string; deleted: boolean; bytes: number };
export type JobKind = "message" | "decision" | "stop";
export type JobStatus = "queued" | "claimed" | "done" | "needs_computer" | "failed";
export type JobInfo = { jobId: string; kind: JobKind; status: JobStatus; error?: string | null; updatedAt?: string };

/** What the phone sends with POST /jobs (mirrors the desktop's POST /api/chats/<id>/run body). */
export type JobPayload =
  | { kind: "message"; payload: { text: string; entryId: string } }
  | { kind: "decision"; payload: { decisions: Record<string, boolean> } | { answers: string[] | null } | { planDecision: { approve: boolean; items: string[] } } }
  | { kind: "stop"; payload: Record<string, never> };

// ---------- the account's setup (GET /api/v1/setup, items written by the desktop's lib/setup-sync.ts) ----------

export type SetupBot = { id: string; name: string; role: string; face: Face | Record<string, unknown>; hidden?: boolean; createdAt?: number; local?: boolean };
export type SetupGroup = { id: string; name: string; memberIds: string[]; leadId?: string };
/** A connector as the phone shows it: name and on/off only (never its address, command or keys). */
export type SetupConnector = { id: string; name: string; enabled: boolean; kind: "remote" | "local" };
export type PhoneSetup = { bots: SetupBot[]; groups: SetupGroup[]; connectors: SetupConnector[]; mainId: string | null };

/** GET /api/v1/ai/status (web/lib/credits.ts CreditStatus), the parts the phone shows. */
export type Credits = {
  state: string;
  message: string | null;
  displayName: string;
  balance: number;
  dailyLimit: number;
  dailyUsed: number;
  resetsAt: string;
  plan: { id: string; name: string };
  planUntil: string | null;
  links: { subscribe: string; pricing: string };
};

export type Me = { id: string; name: string; email: string; image: string | null };
