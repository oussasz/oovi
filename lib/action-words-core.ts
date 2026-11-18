// What a connector action is, in a person's words, for the approval card: "Send an email in Gmail", with the
// few facts that matter ("To: karim@…", "Subject: …"), instead of a tool name and its raw data (those go under
// Details). Works from the tool's name and inputs only, so it fits any connector. Pure: tests/unit/action-words.test.mts.

export type Verb = "send" | "reply" | "forward" | "post" | "comment" | "create" | "add" | "update" | "delete" | "schedule" | "book" | "upload" | "invite" | "share" | "pay" | "turnOn" | "do";
export type Obj = "email" | "message" | "event" | "task" | "file" | "contact" | "post" | "comment" | "page" | "row" | "deal" | "invoice" | "order" | "meeting";
export type Fact = "to" | "subject" | "title" | "when" | "text" | "amount" | "file";
export type Words = { verb: Verb; object?: Obj; app: string; facts: { label: Fact; value: string }[] };

const VERBS: [RegExp, Verb][] = [
  [/^(send|sends|email|mail|dm)$/, "send"],
  [/^reply$/, "reply"],
  [/^forward$/, "forward"],
  [/^(post|publish|tweet)$/, "post"],
  [/^comment$/, "comment"],
  [/^(create|new|make|insert|draft)$/, "create"],
  [/^(add|append|attach)$/, "add"],
  [/^(update|edit|modify|change|patch|set|move|rename)$/, "update"],
  [/^(delete|remove|destroy|erase|trash|archive|cancel)$/, "delete"],
  [/^schedule$/, "schedule"],
  [/^(book|reserve)$/, "book"],
  [/^upload$/, "upload"],
  [/^invite$/, "invite"],
  [/^share$/, "share"],
  [/^(pay|charge|transfer|refund)$/, "pay"],
  [/^(enable|connect|activate)$/, "turnOn"],
];
const OBJECTS: [RegExp, Obj][] = [
  [/^(email|emails|mail|gmail|draft|drafts)$/, "email"],
  [/^(message|messages|chat|dm|sms|whatsapp)$/, "message"],
  [/^(event|events|calendar)$/, "event"],
  [/^(meeting|meetings)$/, "meeting"],
  [/^(task|tasks|todo|todos|issue|issues|card|cards|ticket|tickets)$/, "task"],
  [/^(file|files|document|documents|doc|docs|folder|sheet|spreadsheet)$/, "file"],
  [/^(contact|contacts|person|people|lead|leads)$/, "contact"],
  [/^(post|posts|tweet|tweets|status)$/, "post"],
  [/^(comment|comments)$/, "comment"],
  [/^(page|pages|note|notes)$/, "page"],
  [/^(row|rows|record|records|entry|entries)$/, "row"],
  [/^(deal|deals|opportunity)$/, "deal"],
  [/^(invoice|invoices|payment|payments)$/, "invoice"],
  [/^(order|orders)$/, "order"],
];

const words = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);

/** "GoogleTasksCLIAPI" → "Google Tasks", "google_calendar" → "Google Calendar". */
export function appName(raw: string): string {
  const w = String(raw ?? "")
    .replace(/(CLI)?API$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((x) => (x.length <= 3 && x === x.toUpperCase() ? x : x[0]!.toUpperCase() + x.slice(1).toLowerCase()));
  return w.join(" ").trim();
}

const str = (v: unknown): string => {
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(", ");
  if (v && typeof v === "object") return "";
  return String(v ?? "").replace(/\s+/g, " ").trim();
};
const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The facts a person checks before saying yes, from common input names (any connector). */
function factsOf(input: Record<string, unknown>): Words["facts"] {
  const pick = (re: RegExp) => {
    for (const [k, v] of Object.entries(input)) if (re.test(k) && str(v)) return str(v);
    return "";
  };
  const out: Words["facts"] = [];
  const to = pick(/^(to|recipients?|emails?|email_address|attendees?|channel|chat_id|phone|user|assignee|invitees?)$/i);
  if (to) out.push({ label: "to", value: short(to, 160) });
  const subject = pick(/^(subject)$/i);
  if (subject) out.push({ label: "subject", value: short(subject) });
  const title = pick(/^(title|name|summary|task|event_name)$/i);
  if (title && !subject) out.push({ label: "title", value: short(title) });
  const when = pick(/^(start|start_time|start_date|date|due|due_date|when|time|datetime)$/i);
  if (when) out.push({ label: "when", value: short(when, 60) });
  const amount = pick(/^(amount|price|total)$/i);
  if (amount) out.push({ label: "amount", value: short(amount, 40) });
  const file = pick(/^(file|filename|file_name|path|attachment)$/i);
  if (file) out.push({ label: "file", value: short(file, 80) });
  const text = pick(/^(text|body|message|content|description|comment|instructions|notes?)$/i);
  if (text) out.push({ label: "text", value: short(text, 180) });
  return out.slice(0, 4);
}

/**
 * tool: the connector's own tool name (without oovi's "mcp_<server>_" prefix). server: the connector's name.
 * Zapier and Pipedream pass the real app and action in their inputs: those are used.
 */
export function describeConnector(tool: string, input: Record<string, unknown>, server: string): Words {
  const i = input ?? {};
  const appIn = str(i.app_display_name) || str(i.app_name) || str(i.app) || (str(i.selected_api) ? appName(str(i.selected_api)) : "");
  const app = appIn ? appName(appIn) : server;
  // Zapier: turning an app on for oovi, or running one of its actions.
  if (/enable_zapier_action|enable.*action/i.test(tool)) return { verb: "turnOn", app, facts: [] };
  const action = str(i.action) || str(i.action_key) || str(i.action_name) || "";
  const ws = words(action || tool);
  const verb = VERBS.find(([re]) => ws.some((w) => re.test(w)))?.[1] ?? "do";
  const object = OBJECTS.find(([re]) => ws.some((w) => re.test(w)))?.[1] ?? (verb === "send" && /mail/i.test(`${tool} ${app}`) ? "email" : undefined);
  const params = (i.params && typeof i.params === "object" ? (i.params as Record<string, unknown>) : i.inputs && typeof i.inputs === "object" ? (i.inputs as Record<string, unknown>) : {}) as Record<string, unknown>;
  return { verb, ...(object ? { object } : {}), app, facts: factsOf({ ...i, ...params }) };
}

/** The raw call, for Details only. */
export function technicalDetail(fullTool: string, input: unknown): string {
  let json = "";
  try {
    json = JSON.stringify(input, null, 2);
  } catch {
    json = String(input);
  }
  return `${fullTool}\n${json.length > 3000 ? `${json.slice(0, 3000)}…` : json}`;
}
