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

/** What a failed Zapier action tells the bot to do next (Zapier often gives no reason). */
export function zapierNextStep(tool: string, errorText: string): string {
  const said = errorText.trim() ? "" : " Zapier gave no reason.";
  return `${said} Next step: this usually means the app isn't connected in Zapier yet, or this action isn't turned on. Call inspect_zapier_actions to see what is on (or auto_provision_mcp to turn on the apps already connected in Zapier), then try again once. If the app is missing, tell the user in one short line to add it in oovi: Marketplace > Zapier > "Your apps" (one click per app); don't paste Zapier links unless they ask.`.trim();
}
