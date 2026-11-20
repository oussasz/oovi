// What kind of failure a connector or tool error is, from its structure first (JSON-RPC code, HTTP status in the
// JSON, the service's reason code, Node's network code) and only then from its words (English, French, Arabic).
// One place for every connector: the next step the bot is told (lib/zapier-core.ts, lib/tools.ts), what the
// user sees, and whether it's a problem worth reporting (lib/run-report.ts). Pure: tests/unit/tool-error.test.mts
// checks it against real error formats (Zapier, Google, Slack, Notion, HubSpot, GitHub, Microsoft Graph, MCP SDK,
// Node on Windows/macOS/Linux).

export type ErrKind =
  | "input" // the call's inputs were wrong: fix them and call again
  | "auth" // the sign-in or key was refused or expired: reconnect
  | "scope" // signed in, but without the access this needs: reconnect giving that access
  | "permission" // the account can't do this on this item (not a member, read-only)
  | "notfound" // the item doesn't exist (deleted, moved, wrong id, not shared)
  | "ratelimit" // too many requests: wait, don't loop
  | "transient" // the service had a passing problem: one more try at most
  | "maybe-ran" // no answer to an action: it may have happened; check before doing it again
  | "network" // the connection dropped or timed out
  | "dns" // the address couldn't be looked up: no internet, or DNS
  | "cert" // a secure connection was intercepted (company proxy, antivirus)
  | "refused" // nothing listens at that address (a local server that isn't running)
  | "install" // the program a connector needs isn't installed
  | "config" // the connector's address is wrong
  | "declined" // the user said no on the sign-in page
  | "unknown";

/** The JSON-RPC error code in "MCP error -32602: …" (or given), if any. */
export function rpcCodeOf(text: string): number | null {
  const m = /MCP error (-32\d{3})\b/.exec(text);
  return m ? Number(m[1]) : null;
}

/** The first JSON object in the text, parsed (services wrap their errors in it). */
function jsonOf(text: string): Record<string, unknown> | null {
  const i = text.indexOf("{");
  if (i < 0) return null;
  for (let end = text.lastIndexOf("}"); end > i; end = text.lastIndexOf("}", end - 1)) {
    try {
      const v: unknown = JSON.parse(text.slice(i, end + 1));
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* shorter */
    }
  }
  return null;
}

/** HTTP status and the service's reason code/message, from the shapes services use. */
export function structureOf(text: string): { status: number | null; reason: string; message: string } {
  const j = jsonOf(text);
  let status: number | null = null;
  const reasons: string[] = [];
  let message = "";
  const take = (o: Record<string, unknown> | null | undefined) => {
    if (!o) return;
    for (const k of ["status", "code", "statusCode"]) {
      const v = o[k];
      if (typeof v === "number" && v >= 100 && v < 600 && status === null) status = v;
      else if (typeof v === "string" && /^\d{3}$/.test(v) && status === null) status = Number(v);
      else if (typeof v === "string") reasons.push(v);
    }
    for (const k of ["error", "reason", "category", "errorType"]) if (typeof o[k] === "string") reasons.push(o[k] as string);
    if (typeof o.message === "string" && !message) message = o.message;
    if (typeof o.error_description === "string" && !message) message = o.error_description;
    if (Array.isArray(o.errors)) for (const x of o.errors.slice(0, 3)) if (x && typeof x === "object") take(x as Record<string, unknown>);
    if (o.error && typeof o.error === "object") take(o.error as Record<string, unknown>);
  };
  take(j);
  if (status === null) {
    const m = /(?:^|[\s:(])([1-5]\d\d)(?:[\s:)]|$)\s*(?:[A-Z][a-z]|Bad|Not|Internal|Unauthorized|Forbidden|Too)/.exec(text) ?? /\bstatus(?: code)? \(?(\d{3})\)?/i.exec(text) ?? /\b(?:returned|answered|responded with|HTTP)\s+([1-5]\d\d)\b/i.exec(text);
    if (m) status = Number(m[1]);
  }
  return { status, reason: reasons.join(" "), message };
}

const NET_CODE = /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|UND_ERR_\w+|CERT_\w+|UNABLE_TO_\w+|SELF_SIGNED_\w+|DEPTH_ZERO_SELF_SIGNED_CERT|ERR_TLS_\w+)\b/;

/**
 * The kind of a failure. write: the call was an action (send, create, update…) — a timeout or a server error may
 * then mean it happened. causeCode: Node's network code from the error's `cause` (fetch hides it in its message).
 */
export function classifyToolError(text: string, o: { write?: boolean; causeCode?: string | null; rpcCode?: number | null } = {}): ErrKind {
  const t = String(text ?? "").trim();
  const code = o.causeCode ?? NET_CODE.exec(t)?.[1] ?? null;
  const rpc = o.rpcCode ?? rpcCodeOf(t);
  if (!t && !code && rpc === null) return "unknown";

  // The protocol's own answers.
  if (rpc === -32001 || rpc === -32000) return "maybe-ran"; // request timed out / connection closed mid-call
  if (rpc === -32601 || rpc === -32602) return "input"; // no such method or tool / invalid params
  // The network, by Node's code.
  if (code) {
    if (/^(ENOTFOUND|EAI_AGAIN)$/.test(code)) return "dns";
    if (code === "ECONNREFUSED") return "refused";
    if (/^(CERT_|UNABLE_TO_|SELF_SIGNED|DEPTH_ZERO|ERR_TLS_)/.test(code)) return "cert";
    return o.write ? "maybe-ran" : "network";
  }
  if (/unable to (get|verify) (local )?(issuer )?(the first )?certificate|self[- ]signed certificate/i.test(t)) return "cert";
  if (/spawn \S+ ENOENT|is not recognized as an internal or external command|command not found|n'est pas reconnu en tant que commande/i.test(t)) return "install";

  const { status, reason, message } = structureOf(t);
  const all = `${reason} ${message} ${t}`;

  // Sign-in, access, rights — before inputs: "400 invalid_grant" and "Lifetime validation failed" are sign-ins.
  if (/\baccess_denied\b|user denied/i.test(all)) return "declined";
  if (/insufficient (authentication )?scopes?|missing_scope|MISSING_SCOPES|required scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|Insufficient privileges|Authorization_RequestDenied|upscoping|champs d'application|صلاحيات غير كافية/i.test(all)) return "scope";
  if (/invalid_grant|invalid_auth|invalid_client|token_revoked|token_expired|InvalidAuthenticationToken|\bunauthori[sz]ed\b|Bad credentials|(token|connection|session) (has )?(been )?(expired|revoked)|has expired|authentication (is required|credentials)|invalid authentication|API token is invalid|please reconnect|re-?authenticate|sign in again/i.test(all) || status === 401)
    return "auth";
  if (/rate[ _-]?limit|ratelimited|too many requests|quota exceeded|RESOURCE_EXHAUSTED|secondly limit|daily limit|TooManyRequests|retry after/i.test(all) || status === 429) return "ratelimit";
  if (/\b(Tool|Method) [\w-]+ (is )?not found|Method not found/i.test(t)) return "input";
  if (/not_in_channel|writer access|write access|Resource not accessible|permission denied|access denied|not allowed to|forbidden|requiredAccessLevel/i.test(all) || status === 403) return "permission";
  if (/object_not_found|channel_not_found|ErrorItemNotFound|OBJECT_NOT_FOUND|notFound|\bnot found\b|has been deleted|no longer exists|Could not find/i.test(all) || status === 404 || status === 410)
    return /Non-200 status code \(404\)/.test(t) ? "config" : "notfound";
  if (status === 409 || /conflict_error|Conflict occurred/i.test(all)) return "transient";

  // The call's inputs.
  if (
    /invalid (input|param|argument|value|type)|invalid_type|INVALID_ARGUMENT|validation[_ ]?(error|failed)|body failed validation|expected (record|object|string|number|array|boolean)|received (string|undefined|null)|required (field|param|propert(y|ies))|is required|missing (required|field|param|argument|values?)|dynamic enum|must be (an? )?(object|string|number|array|valid)|unrecognized key|unable to parse|unprocessable|was halted by the platform|obligatoire|est requis|manquant|مطلوب|مفقود/i.test(all) ||
    status === 400 ||
    status === 422
  )
    return "input";

  // The service failed or didn't answer in time.
  if (/timed? ?out|did not respond|didn't respond|no response|socket hang up|other side closed|connection (was )?(closed|reset)|Connect Timeout/i.test(all)) return o.write ? "maybe-ran" : /Connect Timeout|other side closed|socket hang up/i.test(all) ? "network" : "transient";
  if ((status !== null && status >= 500) || /internal server error|backend error|service unavailable|bad gateway|may be having issues|something went wrong|Failed to call tool/i.test(all)) return o.write ? "maybe-ran" : "transient";
  if (/^fetch failed$|^Unauthorized$/i.test(t)) return t.toLowerCase() === "unauthorized" ? "auth" : "network";
  return "unknown";
}

/** Whether a call of this tool acts (sends, creates, changes) rather than only reads. Connector tools by name. */
export const WRITE_TOOL = /(write|send|create|post|publish|reply|book|pay|submit|update|add|insert|delete|remove|move|upload|schedule|invite|order|set|edit|archive|complete|assign)/i;

/** The bot's next step for a kind (short; only ever sent inside a failed tool result). */
export function nextStepFor(kind: ErrKind, app = "the service"): string | null {
  switch (kind) {
    case "auth":
      return `Next step: ${app}'s sign-in was refused or has expired. Don't retry. Tell the user in one short line to reconnect ${app} (for Zapier: in Zapier, or Marketplace > Zapier > "Your apps"), then do what you can without it.`;
    case "scope":
      return `Next step: ${app} is connected but without the access this needs. Don't retry. Tell the user in one line to reconnect ${app} and allow that access.`;
    case "permission":
      return `Next step: the account has no right to do this on that item (not a member, read-only, admin only). Don't retry the same way; say so in one line, or pick an item the account can use.`;
    case "notfound":
      return `Next step: that item doesn't exist (deleted, moved, a wrong id, or not shared with this connection). The connection is fine. Look it up again with a search/list action and use the right one; if it's gone, say so.`;
    case "ratelimit":
      return `Next step: ${app} says too many requests just now. Don't loop: wait, try once more later in this turn at most, or say it will work in a few minutes.`;
    case "transient":
      return `Next step: ${app} had a passing problem. Try once more at most; if it fails again, say ${app} isn't answering properly right now.`;
    case "maybe-ran":
      return `Next step: no answer in time: this action may have run. Don't run it again; check with a read action first (find the email, event or row it should have made), or tell the user to check.`;
    case "network":
      return `Next step: the connection to ${app} dropped. Try once more; if it fails again, say ${app} can't be reached right now.`;
    case "dns":
      return `Next step: ${app}'s address couldn't be looked up: this computer seems offline (or its DNS is failing). Say so in one line; don't retry in a loop.`;
    case "cert":
      return `Next step: the secure connection to ${app} was blocked by something on this computer's network (a company proxy or an antivirus that inspects secure connections). Retrying won't help; tell the user in one line.`;
    case "refused":
      return `Next step: nothing answers at that address: the program behind this connector isn't running. Tell the user to start it (or check the connector's address).`;
    case "install":
      return `Next step: a program this connector needs isn't installed on this computer (npx needs Node.js from nodejs.org; uvx needs uv). Tell the user in one line.`;
    case "config":
      return `Next step: the connector's address seems wrong (the server said it has nothing there). Tell the user to check it in Marketplace > Connectors.`;
    case "declined":
      return `Next step: the sign-in was declined on ${app}'s page. Don't retry; tell the user they can connect it again when they want.`;
    default:
      return null;
  }
}

/** Kinds that are the user's or the service's state, not oovi's bug: never filed as problems. */
export const NOT_A_BUG = new Set<ErrKind>(["notfound", "ratelimit", "permission", "declined", "dns", "cert", "refused", "install"]);

/** A JSON error made readable for a report or the user: "403 insufficientPermissions: Request had insufficient…". */
export function readableError(text: string): string {
  const t = String(text ?? "").trim();
  if (!t.includes("{")) return t;
  const { status, reason, message } = structureOf(t);
  if (!status && !reason && !message) return t;
  const head = [status, reason.split(" ")[0]].filter(Boolean).join(" ");
  return [head, message].filter(Boolean).join(": ") || t;
}

/** What a failed Zapier action tells the bot to do next, from what the error says (Zapier often gives no reason). */
export function zapierNextStep(tool: string, errorText: string): string {
  const e = errorText.trim();
  const isRun = /execute_zapier_(read|write)_action/.test(tool);
  const write = /execute_zapier_write_action/.test(tool);
  // What the error is, by its structure first (lib/tool-error-core.ts): a sign-in, access, a missing item, a rate
  // limit, an outage or an action that may have run are never answered with "the inputs were wrong" or "not connected".
  const kind = e ? classifyToolError(e, { write }) : "unknown";
  if (kind !== "input" && kind !== "unknown") return nextStepFor(kind, "the app in Zapier")!;
  // The inputs were wrong (a field missing, params sent as text, a date in the wrong form).
  if (kind === "input")
    return `Next step: the inputs were wrong, not the connection. Call inspect_zapier_actions with this app and action to get its exact fields, then call ${isRun ? "it" : tool} again once with: app, action, instructions (in plain words with exact dates, e.g. "find the events in my main calendar on <YYYY-MM-DD> from 00:00 to 23:59"), output (what you want back), and params only as an object with the field names inspect showed (never as JSON text). When unsure of a field, leave it out of params and say it in instructions: Zapier fills it in. If Zapier's error names a field with choices (a list to pick from, e.g. a task list or a calendar) and what to call to get them, do that first and use one of its values. If it fails again the same way, stop and tell the user what you could not get.`;
  // A write with no reason: it may have gone through. Trying again blindly can add the event or send the email twice.
  if (!e && /execute_zapier_write_action/.test(tool))
    return `Zapier gave no reason. Next step: this action may have run anyway. Don't run it again before checking with a read action (find the event, email or row it should have made). If it isn't there, the app may not be connected or the action not turned on: call inspect_zapier_actions to see what is on, then try once more. If the app's account isn't connected, call connect_app with the app's name when you have that tool; without it, tell the user in one short line to add it in oovi: Marketplace > Zapier > "Your apps" (one click per app). Don't paste Zapier links.`;
  // The app or the action isn't connected / turned on.
  return `${e ? "" : "Zapier gave no reason. "}Next step: this usually means the app isn't connected in Zapier yet, or this action isn't turned on. Call inspect_zapier_actions to see what is on (or auto_provision_mcp to turn on the apps already connected in Zapier), then try again once. If the app's account isn't connected, call connect_app with the app's name when you have that tool; without it, tell the user in one short line to add it in oovi: Marketplace > Zapier > "Your apps" (one click per app). Don't paste Zapier links.`;
}
