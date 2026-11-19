// Zapier's apps on oovi's own Zapier page: which of the user's apps are ready, a link to add one, and one
// click to turn on everything already connected in Zapier. Zapier's tools are called directly (no bot, no
// credits). Their inputs are read from the schemas the server gives, so a renamed field still works.
// Pure: tests/unit/zapier.test.mts.

/** Apps people ask for most (names as Zapier writes them). */
export const POPULAR = ["Gmail", "Google Calendar", "Google Drive", "Google Sheets", "Google Docs", "Google Tasks", "Microsoft Outlook", "Microsoft Teams", "Slack", "Notion", "Trello", "HubSpot", "Facebook Pages", "Instagram for Business", "LinkedIn", "WhatsApp Notifications", "Calendly", "Shopify"];

export type Schema = { properties?: Record<string, { type?: string; enum?: unknown[]; description?: string }>; required?: string[] };

/** The inputs for a Zapier tool that names an app: the app goes in the field that is about the app. */
export function appArgs(schema: Schema | undefined, app: string, extra: Record<string, unknown> = {}): Record<string, unknown> | string {
  const props = schema?.properties ?? {};
  const names = Object.keys(props);
  const field = names.find((n) => /^(app|app_name|app_display_name|selected_api|application|service)$/i.test(n)) ?? names.find((n) => /app|service/i.test(n));
  const args: Record<string, unknown> = { ...extra };
  if (field) args[field] = app;
  for (const r of schema?.required ?? []) {
    if (r in args) continue;
    const p = props[r];
    if (p?.enum?.length) args[r] = p.enum.find((v) => /add|new|create|connect/i.test(String(v))) ?? p.enum[0];
    else return `Zapier asks for "${r}", which oovi can't fill in by itself.`;
  }
  return args;
}

/** The first web link in a text (Zapier answers with a link to open). */
export function firstLink(text: string): string | null {
  const m = /https:\/\/[^\s"'<>)\]]+/.exec(String(text ?? ""));
  return m ? m[0].replace(/[.,;]+$/, "") : null;
}

/** Which of the given apps a Zapier answer mentions (enabled actions, connections). Case and spacing ignored. */
export function appsIn(text: string, apps: readonly string[]): string[] {
  const t = String(text ?? "").toLowerCase().replace(/[_-]+/g, " ");
  return apps.filter((a) => {
    const k = a.toLowerCase();
    // "Google Calendar" also matches "googlecalendar"; "Gmail" never matches inside "Google Mail…" by mistake.
    return t.includes(k) || t.includes(k.replace(/\s+/g, ""));
  });
}

/** The tools that tell which mode the Zapier server is in. */
export function zapierMode(tools: readonly string[]): "agentic" | "classic" | "none" {
  if (tools.some((t) => /^(inspect_zapier_actions|list_enabled_zapier_actions|discover_zapier_actions)$/.test(t))) return "agentic";
  if (tools.includes("get_configuration_url")) return "classic";
  return "none";
}

/** A Zapier action call with its required plain-words fields filled when the bot left them out (Zapier refuses the call otherwise). */
export function completeZapierRun(tool: string, input: Record<string, unknown>, timeZone?: string): Record<string, unknown> {
  if (!/execute_zapier_(read|write)_action$/.test(tool) || !input || typeof input !== "object") return input;
  const out = { ...input };
  if (typeof out.params === "string" && out.params.trim().startsWith("{")) {
    try {
      const j: unknown = JSON.parse(out.params);
      if (j && typeof j === "object" && !Array.isArray(j)) out.params = j;
    } catch {
      /* left as it was: Zapier says what's wrong */
    }
  }
  const has = (k: string) => typeof out[k] === "string" && (out[k] as string).trim() !== "";
  if (!has("instructions")) {
    const p = out.params && typeof out.params === "object" ? Object.entries(out.params as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("; ") : "";
    out.instructions = `Run the ${String(out.action ?? "action")} action in ${String(out.app ?? "the app")}${p ? ` with ${p}` : ""}.`;
  }
  // A write's times are the user's local times (Zapier otherwise reads "15:30" in its own zone, often UTC).
  if (timeZone && /write_action$/.test(tool) && !String(out.instructions).includes(timeZone)) out.instructions = `${String(out.instructions).trim()} Times are in ${timeZone}.`;
  if (!has("output")) out.output = "All the useful fields of the results (titles, dates, people, links, ids).";
  return out;
}
