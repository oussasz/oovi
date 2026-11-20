// What kind of action a connector (MCP) tool is: reading never needs the user's OK; acting (send, post,
// create, change, delete, pay) asks as before. From the server's own hints when it gives them, else from the
// verb in the tool's name. Pure: tests/unit/action-kind.test.mts.

const READ = /^(discover|get|list|search|read|find|fetch|query|describe|lookup|look_up|show|view|count|retrieve|check|preview|summarize|summarise|browse|inspect|whoami|me|info|status|ping|explain|validate|resolve|scan)(_|-|$|[A-Z])/;
const ACT = /(send|post|create|add|insert|update|edit|modify|patch|delete|remove|archive|move|copy|upload|publish|reply|forward|invite|share|pay|charge|refund|transfer|book|order|cancel|schedule|submit|set|write|put|merge|close|open|assign|comment|react|like|follow|subscribe|unsubscribe|approve|reject|trigger|run|execute|start|stop|enable|disable|import|export|sync|grant|revoke|rename|tag|label)/i;

export type ToolKind = "read" | "act";

/** The part of a tool name that says what it does ("gmail_send_email" → "send_email"; "listEvents" stays). */
export function verbPart(tool: string): string {
  return tool.replace(/^(mcp_[a-z0-9]+_)/i, "");
}

export function toolKind(tool: string, hints?: { readOnly?: boolean; destructive?: boolean }): ToolKind {
  if (hints?.destructive) return "act";
  if (hints?.readOnly) return "read";
  const v = verbPart(tool);
  // Zapier and Pipedream run any app's action through one tool, and say themselves which ones only read.
  if (/(^|_)read_action$/.test(v)) return "read";
  if (/(^|_)write_action$/.test(v)) return "act";
  // Getting an app ready in Zapier (turning its actions on, the page to connect an account, "use all my apps")
  // sends nothing and changes nothing outside Zapier's own list: a card for it only stood between the user
  // and the action they asked for, which has its own card.
  if (/^(enable_zapier_action|manage_zapier_connections|auto_provision_mcp)$/.test(v)) return "read";
  // A reading verb first, and no acting word anywhere after it ("get_and_delete" acts).
  if (READ.test(v) && !ACT.test(v.replace(READ, ""))) return "read";
  return "act";
}
