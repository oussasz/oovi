// Brand logos in public/logos: each company's own app icon (from its website or
// official GitHub organisation), or its Simple Icons vector logo in the brand colour.
// Logos belong to their owners and are shown only to identify each service.

const FILES: Record<string, string> = {
  "airtable": "airtable.png",
  "anthropic": "anthropic.png",
  "apify": "apify.png",
  "asana": "asana.png",
  "atlassian": "atlassian.png",
  "attio": "attio.png",
  "bitly": "bitly.svg",
  "brave": "brave.png",
  "calcom": "calcom.png",
  "canva": "canva.png",
  "clickup": "clickup.png",
  "close": "close.png",
  "cloudflare": "cloudflare.png",
  "context7": "context7.png",
  "deepwiki": "deepwiki.png",
  "dropbox": "dropbox.png",
  "egnyte": "egnyte.png",
  "exa": "exa.png",
  "figma": "figma.png",
  "fireflies": "fireflies.png",
  "gamma": "gamma.png",
  "gcalendar": "gcalendar.png",
  "gdrive": "gdrive.png",
  "github": "github.svg",
  "gmail": "gmail.png",
  "grafana": "grafana.png",
  "granola": "granola.png",
  "hubspot": "hubspot.png",
  "huggingface": "huggingface.png",
  "intercom": "intercom.png",
  "jotform": "jotform.png",
  "klaviyo": "klaviyo.png",
  "linear": "linear.png",
  "m365": "m365.png",
  "make": "make.png",
  "mcp": "mcp.png",
  "mercury": "mercury.png",
  "miro": "miro.png",
  "monday": "monday.png",
  "mslearn": "mslearn.png",
  "neon": "neon.png",
  "netlify": "netlify.png",
  "notion": "notion.png",
  "paypal": "paypal.png",
  "pipedream": "pipedream.svg",
  "plaid": "plaid.png",
  "postman": "postman.png",
  "prisma": "prisma.png",
  "ramp": "ramp.png",
  "sentry": "sentry.png",
  "slack": "slack.png",
  "square": "square.svg",
  "stripe": "stripe.svg",
  "supabase": "supabase.png",
  "todoist": "todoist.svg",
  "vercel": "vercel.png",
  "vimeo": "vimeo.png",
  "webflow": "webflow.png",
  "wix": "wix.png",
  "zapier": "zapier.png",
};

/** Catalog ids that share another brand's logo. */
const ALIAS: Record<string, string> = {
  filesystem: "mcp",
  "memory-graph": "mcp",
  thinking: "mcp",
  "cloudflare-docs": "cloudflare",
};

/** Logo URL for a catalog id (connector) or brand key, if we have one. */
export function logoFor(id: string): string | undefined {
  const f = FILES[ALIAS[id] ?? id];
  return f ? `/logos/${f}` : undefined;
}

/** The MCP logo, for connectors that don't come from the catalog. */
export const MCP_LOGO = "/logos/mcp.png";
/** Publisher logos for skills. */
export const OOVI_LOGO = "/mark.png";
export const ANTHROPIC_LOGO = "/logos/anthropic.png";

/** A GitHub owner's avatar (official org logo) from a github.com URL. */
export function githubOwnerLogo(url: string | undefined): string | undefined {
  const m = url?.match(/^https:\/\/github\.com\/([\w.-]+)/i);
  return m ? `https://github.com/${m[1]}.png?size=96` : undefined;
}
