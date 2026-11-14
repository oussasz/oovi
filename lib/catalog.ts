// The marketplace catalog: connectors (MCP servers), skills and plugins (ready-made
// bot teams). Shared by the server (installing) and the page (showing cards), so no
// Node imports here.

import type { Face } from "./faces";
import type { BotTools } from "./types";

// ---------- connectors ----------

/** A value the user fills in when installing. `to` says where it goes. */
export type CatalogField = {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  /** Where to get it. */
  help?: string;
  /** env: environment variable `name`; header: HTTP header `name` (template "{value}"); arg: replaces "{key}" in args. */
  to: "env" | "header" | "arg";
  name?: string;
  template?: string;
  /** Pick a folder with the system dialog. */
  folder?: boolean;
  /** Can be left empty. */
  optional?: boolean;
};

export type CatalogConnector = {
  id: string;
  name: string;
  by: string;
  verified?: boolean;
  description: string;
  category: ConnectorCategory;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  fields?: CatalogField[];
  /** stdio servers started with npx need Node.js on the computer. */
  needsNode?: boolean;
  docs?: string;
  /** Connect by signing in through the browser (OAuth). No keys to paste. */
  oauth?: boolean;
  /** Not available directly yet: why, and what to use meanwhile. */
  soon?: string;
  /** The service's page where the user chooses what oovi may do (shown in the connector's setup card). */
  setupUrl?: string;
  /** Logo URL, for items published from the admin console (built-in ones use lib/logos). */
  logo?: string;
};

/**
 * Built-in list plus published items (same id: the published one wins).
 * `hidden`: items unpublished in the admin console, removed even if built in.
 */
export function mergeById<T extends { id: string }>(base: T[], extra: T[], hidden: string[] = []): T[] {
  const ids = new Set([...extra.map((x) => x.id), ...hidden]);
  return [...base.filter((x) => !ids.has(x.id)), ...extra];
}

export type ConnectorCategory = "everything" | "google-microsoft" | "productivity" | "files" | "design" | "dev" | "sales" | "finance" | "docs" | "local";
export const CONNECTOR_CATEGORIES: ConnectorCategory[] = ["everything", "google-microsoft", "productivity", "files", "design", "sales", "finance", "dev", "docs", "local"];

export const CONNECTORS: CatalogConnector[] = [
  { id: "zapier", name: "Zapier", by: "Zapier", verified: true, category: "everything", oauth: true, transport: "http", url: "https://mcp.zapier.com/api/v1/connect", setupUrl: "https://mcp.zapier.com/mcp/servers", description: "Connect 8,000+ apps, including Gmail, Google Drive, Calendar, Sheets, Docs, Outlook, Teams, Slack and HubSpot. Pick the actions you allow in Zapier.", docs: "https://zapier.com/mcp" },
  { id: "pipedream", name: "Pipedream", by: "Pipedream", verified: true, category: "everything", oauth: true, transport: "http", url: "https://remote.mcp.pipedream.net", description: "Connect 2,800+ apps, including Gmail, Google Sheets, Drive, Calendar, Outlook, Slack and Salesforce, with your own accounts.", docs: "https://mcp.pipedream.com" },
  { id: "make", name: "Make", by: "Make", verified: true, category: "everything", oauth: true, transport: "http", url: "https://mcp.make.com", description: "Run your Make scenarios as tools: automations across 2,000+ apps.", docs: "https://developers.make.com/mcp-server" },
  { id: "gmail", name: "Gmail", by: "Google", verified: true, category: "google-microsoft", transport: "http", description: "Read, search and draft emails.", soon: "Google's own Gmail connector is still in developer preview. Connect Gmail through Zapier or Pipedream today." },
  { id: "gdrive", name: "Google Drive, Docs & Sheets", by: "Google", verified: true, category: "google-microsoft", transport: "http", description: "Find, read and update files, documents and spreadsheets.", soon: "Google's own Drive connector is still in developer preview. Connect Drive, Docs and Sheets through Zapier or Pipedream today." },
  { id: "gcalendar", name: "Google Calendar", by: "Google", verified: true, category: "google-microsoft", transport: "http", description: "Check availability and manage events.", soon: "Google's own Calendar connector is still in developer preview. Connect Calendar through Zapier or Pipedream today." },
  { id: "m365", name: "Microsoft 365", by: "Microsoft", verified: true, category: "google-microsoft", transport: "http", description: "Outlook mail and calendar, Teams, OneDrive and SharePoint.", soon: "Microsoft's connector needs oovi to be registered with Microsoft first. Connect Outlook, Teams and OneDrive through Zapier or Pipedream today." },
  { id: "slack", name: "Slack", by: "Slack", verified: true, category: "google-microsoft", transport: "http", description: "Read channels, search messages and post updates.", soon: "Slack's connector needs oovi to be approved by Slack first. Connect Slack through Zapier or Pipedream today." },
  { id: "hubspot", name: "HubSpot", by: "HubSpot", verified: true, category: "google-microsoft", transport: "http", description: "Contacts, companies, deals and tickets.", soon: "HubSpot's connector needs oovi to be registered with HubSpot first. Connect HubSpot through Zapier or Pipedream today." },
  { id: "notion", name: "Notion", by: "Notion", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://mcp.notion.com/mcp", description: "Search, read, create and update Notion pages and databases.", docs: "https://developers.notion.com/docs/mcp" },
  { id: "linear", name: "Linear", by: "Linear", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://mcp.linear.app/mcp", description: "Find, create and update issues, projects and cycles.", docs: "https://linear.app/docs/mcp" },
  { id: "atlassian", name: "Jira & Confluence", by: "Atlassian", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://mcp.atlassian.com/v1/mcp", description: "Search and update Jira issues and Confluence pages.", docs: "https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/" },
  { id: "asana", name: "Asana", by: "Asana", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://mcp.asana.com/sse", description: "Manage tasks, projects and goals in Asana.", docs: "https://developers.asana.com/docs/using-asanas-mcp-server" },
  { id: "monday", name: "monday.com", by: "monday.com", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://mcp.monday.com/mcp", description: "Work with boards, items and updates on monday.com.", docs: "https://developer.monday.com/apps/docs/mondaycom-mcp-integration" },
  { id: "clickup", name: "ClickUp", by: "ClickUp", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://mcp.clickup.com/mcp", description: "Tasks, lists, docs and time tracking in ClickUp." },
  { id: "todoist", name: "Todoist", by: "Doist", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://ai.todoist.net/mcp", description: "Add, find and complete your Todoist tasks." },
  { id: "airtable", name: "Airtable", by: "Airtable", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://mcp.airtable.com/mcp", description: "Read and update records in your Airtable bases." },
  { id: "miro", name: "Miro", by: "Miro", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://mcp.miro.com/", description: "Read and create content on Miro boards." },
  { id: "calcom", name: "Cal.com", by: "Cal.com", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://mcp.cal.com/mcp", description: "Check availability and manage bookings." },
  { id: "granola", name: "Granola", by: "Granola", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://mcp.granola.ai/mcp", description: "Search your meeting notes and transcripts." },
  { id: "fireflies", name: "Fireflies", by: "Fireflies.ai", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://api.fireflies.ai/mcp", description: "Search meeting transcripts, summaries and action items." },
  { id: "jotform", name: "Jotform", by: "Jotform", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://mcp.jotform.com/", description: "Create forms and read submissions." },
  { id: "dropbox", name: "Dropbox", by: "Dropbox", verified: true, category: "files", oauth: true, transport: "http", url: "https://mcp.dropbox.com/mcp", description: "Search, read and organize files in your Dropbox." },
  { id: "egnyte", name: "Egnyte", by: "Egnyte", verified: true, category: "files", oauth: true, transport: "http", url: "https://mcp-server.egnyte.com/mcp", description: "Search and work with files in Egnyte." },
  { id: "canva", name: "Canva", by: "Canva", verified: true, category: "design", oauth: true, transport: "http", url: "https://mcp.canva.com/mcp", description: "Create, find and export Canva designs." },
  { id: "figma", name: "Figma", by: "Figma", verified: true, category: "design", oauth: true, transport: "http", url: "https://mcp.figma.com/mcp", description: "Read Figma files and designs to turn them into code.", docs: "https://help.figma.com/hc/en-us/articles/32132100833559" },
  { id: "gamma", name: "Gamma", by: "Gamma", verified: true, category: "design", oauth: true, transport: "http", url: "https://mcp.gamma.app/mcp", description: "Create presentations, documents and web pages with Gamma." },
  { id: "webflow", name: "Webflow", by: "Webflow", verified: true, category: "design", oauth: true, transport: "http", url: "https://mcp.webflow.com/mcp", description: "Manage Webflow sites, pages and CMS content." },
  { id: "wix", name: "Wix", by: "Wix", verified: true, category: "design", oauth: true, transport: "http", url: "https://mcp.wix.com/mcp", description: "Manage your Wix sites, stores and bookings." },
  { id: "vimeo", name: "Vimeo", by: "Vimeo", verified: true, category: "design", oauth: true, transport: "http", url: "https://mcp.vimeo.com/mcp", description: "Manage and search your Vimeo videos." },
  { id: "intercom", name: "Intercom", by: "Intercom", verified: true, category: "sales", oauth: true, transport: "http", url: "https://mcp.intercom.com/mcp", description: "Search conversations and customer data in Intercom." },
  { id: "apollo", name: "Apollo.io", by: "Apollo.io", verified: true, category: "sales", oauth: true, transport: "http", url: "https://mcp.apollo.io/mcp", description: "Find companies and contacts, enrich leads and work your sales sequences in Apollo." },
  { id: "calendly", name: "Calendly", by: "Calendly", verified: true, category: "productivity", oauth: true, transport: "http", url: "https://mcp.calendly.com", description: "See your event types and booked meetings, and share booking links." },
  { id: "airwallex", name: "Airwallex", by: "Airwallex", verified: true, category: "finance", oauth: true, transport: "http", url: "https://mcp.airwallex.com/mcp", description: "Balances, payments, transfers and cards in your Airwallex account." },
  { id: "wordpress", name: "WordPress.com", by: "Automattic", verified: true, category: "design", oauth: true, transport: "http", url: "https://public-api.wordpress.com/wpcom/v2/mcp/v1", description: "Read and manage your WordPress.com sites: posts, pages and comments." },
  { id: "mermaid", name: "Mermaid Chart", by: "Mermaid Chart", verified: true, category: "design", oauth: true, transport: "http", url: "https://mcp.mermaidchart.com/mcp", description: "Make and edit diagrams (flowcharts, timelines, org charts) in Mermaid Chart." },
  { id: "jam", name: "Jam", by: "Jam", verified: true, category: "dev", oauth: true, transport: "http", url: "https://mcp.jam.dev/mcp", description: "Read bug reports recorded with Jam: screen, console and network logs." },
  { id: "attio", name: "Attio", by: "Attio", verified: true, category: "sales", oauth: true, transport: "http", url: "https://mcp.attio.com/mcp", description: "Work with contacts, companies and deals in your Attio CRM." },
  { id: "close", name: "Close", by: "Close", verified: true, category: "sales", oauth: true, transport: "http", url: "https://mcp.close.com/mcp", description: "Leads, contacts and activities in Close CRM." },
  { id: "klaviyo", name: "Klaviyo", by: "Klaviyo", verified: true, category: "sales", oauth: true, transport: "http", url: "https://mcp.klaviyo.com/mcp", description: "Email and SMS marketing: profiles, lists, campaigns and results." },
  { id: "bitly", name: "Bitly", by: "Bitly", verified: true, category: "sales", oauth: true, transport: "http", url: "https://api-ssl.bitly.com/v4/mcp", description: "Create and track short links." },
  { id: "stripe", name: "Stripe", by: "Stripe", verified: true, category: "finance", oauth: true, transport: "http", url: "https://mcp.stripe.com", description: "Customers, payments, invoices and subscriptions in Stripe.", docs: "https://docs.stripe.com/mcp" },
  { id: "paypal", name: "PayPal", by: "PayPal", verified: true, category: "finance", oauth: true, transport: "http", url: "https://mcp.paypal.com/mcp", description: "Invoices, orders, transactions and disputes in PayPal." },
  { id: "square", name: "Square", by: "Square", verified: true, category: "finance", oauth: true, transport: "http", url: "https://mcp.squareup.com/sse", description: "Payments, orders, catalog and customers in Square." },
  { id: "mercury", name: "Mercury", by: "Mercury", verified: true, category: "finance", oauth: true, transport: "http", url: "https://mcp.mercury.com/mcp", description: "Read balances and transactions in your Mercury bank account." },
  { id: "ramp", name: "Ramp", by: "Ramp", verified: true, category: "finance", oauth: true, transport: "http", url: "https://mcp.ramp.com/mcp", description: "Expenses, cards and reimbursements in Ramp." },
  { id: "plaid", name: "Plaid", by: "Plaid", verified: true, category: "finance", oauth: true, transport: "http", url: "https://api.dashboard.plaid.com/mcp/sse", description: "Monitor and debug your Plaid integration." },
  {
    id: "github",
    name: "GitHub",
    by: "GitHub",
    verified: true,
    category: "dev",
    description: "Read and manage repositories, issues and pull requests.",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    fields: [{ key: "token", label: "GitHub token", secret: true, placeholder: "github_pat_…", help: "https://github.com/settings/personal-access-tokens", to: "header", name: "Authorization", template: "Bearer {value}" }],
    docs: "https://github.com/github/github-mcp-server",
  },
  { id: "supabase", name: "Supabase", by: "Supabase", verified: true, category: "dev", oauth: true, transport: "http", url: "https://mcp.supabase.com/mcp", description: "Manage Supabase projects: tables, SQL, edge functions and logs.", docs: "https://supabase.com/docs/guides/getting-started/mcp" },
  { id: "vercel", name: "Vercel", by: "Vercel", verified: true, category: "dev", oauth: true, transport: "http", url: "https://mcp.vercel.com", description: "Projects, deployments and logs on Vercel.", docs: "https://vercel.com/docs/mcp/vercel-mcp" },
  { id: "netlify", name: "Netlify", by: "Netlify", verified: true, category: "dev", oauth: true, transport: "http", url: "https://netlify-mcp.netlify.app/mcp", description: "Create, deploy and manage Netlify sites." },
  { id: "neon", name: "Neon", by: "Neon", verified: true, category: "dev", oauth: true, transport: "http", url: "https://mcp.neon.tech/mcp", description: "Serverless Postgres: projects, branches and SQL." },
  { id: "prisma", name: "Prisma Postgres", by: "Prisma", verified: true, category: "dev", oauth: true, transport: "http", url: "https://mcp.prisma.io/mcp", description: "Create and manage Prisma Postgres databases." },
  { id: "cloudflare", name: "Cloudflare", by: "Cloudflare", verified: true, category: "dev", oauth: true, transport: "http", url: "https://bindings.mcp.cloudflare.com/mcp", description: "Workers, KV, R2 and D1 on your Cloudflare account." },
  { id: "sentry", name: "Sentry", by: "Sentry", verified: true, category: "dev", oauth: true, transport: "http", url: "https://mcp.sentry.dev/mcp", description: "Find and fix errors: issues, stack traces and releases." },
  { id: "grafana", name: "Grafana", by: "Grafana Labs", verified: true, category: "dev", oauth: true, transport: "http", url: "https://mcp.grafana.com/mcp", description: "Dashboards, metrics, logs and alerts in Grafana Cloud." },
  { id: "postman", name: "Postman", by: "Postman", verified: true, category: "dev", oauth: true, transport: "http", url: "https://mcp.postman.com/mcp", description: "Work with Postman collections, environments and APIs." },
  { id: "apify", name: "Apify", by: "Apify", verified: true, category: "dev", oauth: true, transport: "http", url: "https://mcp.apify.com/", description: "Run thousands of ready-made web scrapers and automation tools." },
  {
    id: "huggingface",
    name: "Hugging Face",
    by: "Hugging Face",
    verified: true,
    category: "dev",
    description: "Search models, datasets, Spaces and papers on the Hugging Face Hub.",
    transport: "http",
    url: "https://huggingface.co/mcp",
    fields: [{ key: "token", label: "Hugging Face token (optional)", optional: true, secret: true, placeholder: "hf_…", help: "https://huggingface.co/settings/tokens", to: "header", name: "Authorization", template: "Bearer {value}" }],
    docs: "https://huggingface.co/settings/mcp",
  },
  { id: "context7", name: "Context7", by: "Upstash", verified: true, category: "docs", transport: "http", url: "https://mcp.context7.com/mcp", description: "Up-to-date docs and code examples for thousands of libraries, so coding bots don't guess APIs." },
  { id: "deepwiki", name: "DeepWiki", by: "Cognition", verified: true, category: "docs", transport: "http", url: "https://mcp.deepwiki.com/mcp", description: "Ask questions about any public GitHub repository and get answers from its code and docs." },
  { id: "mslearn", name: "Microsoft Learn", by: "Microsoft", verified: true, category: "docs", transport: "http", url: "https://learn.microsoft.com/api/mcp", description: "Search official Microsoft and Azure documentation." },
  { id: "cloudflare-docs", name: "Cloudflare docs", by: "Cloudflare", verified: true, category: "docs", transport: "http", url: "https://docs.mcp.cloudflare.com/mcp", description: "Search Cloudflare's developer documentation." },
  { id: "exa", name: "Exa search", by: "Exa", verified: true, category: "docs", transport: "http", url: "https://mcp.exa.ai/mcp", description: "Web search built for AI: find pages, companies and code." },
  {
    id: "brave",
    name: "Brave Search",
    by: "Brave",
    verified: true,
    category: "docs",
    description: "Web, news and local search through the Brave Search API.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@brave/brave-search-mcp-server"],
    needsNode: true,
    fields: [{ key: "key", label: "Brave Search API key", secret: true, help: "https://api-dashboard.search.brave.com/app/keys", to: "env", name: "BRAVE_API_KEY" }],
    docs: "https://github.com/brave/brave-search-mcp-server",
  },
  {
    id: "trello",
    name: "Trello",
    by: "Community (delorenj)",
    category: "productivity",
    description: "See your boards, lists and cards; add, move, comment on and archive cards, and manage checklists and labels.",
    transport: "stdio",
    command: "npx",
    // A fixed version: an update is checked before the catalog moves to it.
    args: ["-y", "@delorenj/mcp-server-trello@1.8.1"],
    needsNode: true,
    fields: [
      { key: "key", label: "Trello API key", secret: true, help: "https://trello.com/power-ups/admin (create a Power-Up, then open its API key page)", to: "env", name: "TRELLO_API_KEY" },
      { key: "token", label: "Trello token", secret: true, help: "On the same API key page, click the Token link and allow access", to: "env", name: "TRELLO_TOKEN" },
      { key: "board", label: "Board ID (optional: the board to start with)", optional: true, to: "env", name: "TRELLO_BOARD_ID" },
    ],
    docs: "https://github.com/delorenj/mcp-server-trello",
  },
  {
    id: "filesystem",
    name: "Files",
    by: "MCP reference servers",
    category: "local",
    description: "Let bots read and write files in one folder you choose (outside a chat's project folder).",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "{folder}"],
    needsNode: true,
    fields: [{ key: "folder", label: "Folder", placeholder: "D:\\Documents\\Work", to: "arg", folder: true }],
  },
  {
    id: "memory-graph",
    name: "Knowledge graph",
    by: "MCP reference servers",
    category: "local",
    description: "A long-term memory of people, projects and facts that bots build up and search.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    needsNode: true,
  },
  {
    id: "thinking",
    name: "Sequential thinking",
    by: "MCP reference servers",
    category: "local",
    description: "A scratchpad tool that helps models break hard problems into steps.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    needsNode: true,
  },
];

// ---------- skills ----------

export type CatalogSkill = { id: string; name: string; description: string; category: "work" | "writing" | "research" | "coding" | "life"; body: string };

export const SKILLS: CatalogSkill[] = [
  {
    id: "research-brief",
    name: "Research brief",
    category: "research",
    description: "Research a topic from several sources and write a short brief with citations.",
    body: `1. Restate the question in one line and list 3-5 sub-questions.
2. Search each sub-question; open at least 3 good sources (official sites, reputable media, papers). Skip SEO spam.
3. Note facts with their URL. When sources disagree, say so.
4. Write the brief: a 3-sentence summary, then bullets per sub-question, then "Open questions".
5. End with the list of sources you used.`,
  },
  {
    id: "compare-products",
    name: "Compare products",
    category: "research",
    description: "Compare several products or services and recommend one, with a table.",
    body: `1. Ask (or assume, and say so) what matters most: price, features, privacy, support, platform.
2. For each product, check the official site and one independent review. Note the current price.
3. Build a table: one row per product, one column per criterion, plus "Best for".
4. Recommend one for the user's case, and one alternative, in two sentences each.
5. List sources and the date you checked prices.`,
  },
  {
    id: "weekly-report",
    name: "Weekly report",
    category: "work",
    description: "Turn notes, chats or a task list into a clear weekly status report.",
    body: `1. Collect what was done, what's in progress, blockers and next week's plan.
2. Write: **Highlights** (3 bullets max), **Done**, **In progress** (with % or next step), **Blockers** (with who can unblock), **Next week**.
3. Keep each bullet to one line. Use numbers where you have them.
4. Finish with one line: the most important thing for the reader to know.`,
  },
  {
    id: "meeting-notes",
    name: "Meeting notes to actions",
    category: "work",
    description: "Turn messy meeting notes or a transcript into decisions and action items.",
    body: `1. Read everything once. Identify the topic of each part.
2. Write **Decisions** (what was agreed), **Action items** (owner, task, due date if said) and **Open questions**.
3. Never invent owners or dates: write "owner?" when it's unclear.
4. Add a 2-line summary at the top.`,
  },
  {
    id: "email-reply",
    name: "Email reply",
    category: "writing",
    description: "Draft a reply to an email in the user's tone, short and clear.",
    body: `1. Find what the sender wants and any question that needs an answer.
2. Draft a reply: greeting, direct answer, details only if needed, clear next step, sign-off.
3. Match the sender's language and formality. Keep it under 150 words unless asked.
4. Show the draft and offer one shorter alternative. Never send anything without the user's OK.`,
  },
  {
    id: "social-post",
    name: "Social media post",
    category: "writing",
    description: "Write a post for LinkedIn, X, Instagram or Facebook with a strong opening line.",
    body: `1. Confirm the platform, goal (inform, sell, hire, share news) and audience.
2. Write a first line that makes people stop scrolling: a number, a question or a bold claim.
3. Keep paragraphs to 1-2 lines. One idea per post. End with a clear call to action.
4. Respect the platform: X under 280 characters; LinkedIn under 1,300; up to 3 relevant hashtags.
5. Offer two versions. Only post if the user asks, and show the exact text first.`,
  },
  {
    id: "fix-bug",
    name: "Fix a bug",
    category: "coding",
    description: "Find the cause of a bug in the project folder, fix it and prove it with a test.",
    body: `1. Restate the bug: what happens, what should happen, how to reproduce.
2. Use search_files and read_file to find the code involved. Read before changing anything.
3. Reproduce it: run the test or command that shows the bug (run_command).
4. Find the root cause, not just the symptom. Explain it in one or two sentences.
5. Make the smallest change that fixes it (edit_file). Add or update a test that fails without the fix.
6. Run the tests again and report the result honestly.`,
  },
  {
    id: "write-tests",
    name: "Write tests",
    category: "coding",
    description: "Add tests for a module in the project, using the project's own test setup.",
    body: `1. Find the test framework from package.json, pyproject.toml or existing test files. Follow their style.
2. List the behaviors to cover: normal cases, edge cases (empty, large, invalid input) and errors.
3. Write focused tests with clear names that say what they check.
4. Run them (run_command). Fix tests that are wrong; report real bugs you find instead of hiding them.`,
  },
  {
    id: "code-review",
    name: "Code review",
    category: "coding",
    description: "Review code changes for bugs, security problems and unclear code.",
    body: `1. Read the changed files fully, plus the code that calls them.
2. Look for: wrong logic, unhandled errors, edge cases, security issues (injection, secrets, unsafe input), performance traps, missing tests.
3. Report each finding with file, line, what goes wrong and a concrete fix. Order by severity.
4. Say clearly when you found nothing serious. Don't pad the review with style nitpicks.`,
  },
  {
    id: "new-web-page",
    name: "Build a web page",
    category: "coding",
    description: "Create a simple, good-looking website (HTML, CSS, JS) in the project folder.",
    body: `1. Ask for (or assume, and say so) the purpose, sections, colors and language.
2. Create index.html, styles.css and script.js with write_file. Use semantic HTML, a mobile-first layout and no external build tools.
3. Make it accessible: real headings, alt text, good contrast, keyboard-friendly.
4. Tell the user how to open it (double-click index.html) and what to change next.`,
  },
  {
    id: "business-plan",
    name: "Business idea check",
    category: "work",
    description: "Check a business idea: market, competitors, costs, risks and a first step.",
    body: `1. Summarize the idea, the customer and the place (country/city) in 3 lines.
2. Research the market: demand signals, 3-5 competitors with prices, local rules or licenses.
3. Estimate start-up costs and monthly costs; give a simple break-even estimate. Show your assumptions.
4. List the top 3 risks with a way to reduce each.
5. Suggest one cheap test the user can run this week.`,
  },
  {
    id: "trip-plan",
    name: "Trip plan",
    category: "life",
    description: "Plan a trip day by day with transport, places to stay and a budget.",
    body: `1. Confirm dates, departure city, budget, travel style and must-sees.
2. Check transport options and current prices; note visa or entry rules if relevant.
3. Propose 2-3 areas to stay with price ranges.
4. Write a day-by-day plan with realistic travel times and one rest block per day.
5. Finish with a budget table and a packing checklist. Never book or pay without the user's OK.`,
  },
];

// ---------- plugins (ready-made bot teams) ----------

export type PluginBot = { name: string; role: string; instructions: string; face: Face; tools: BotTools; lead?: boolean; about?: string };
export type CatalogPlugin = {
  id: string;
  name: string;
  description: string;
  /** Name of the group the team works in. */
  group: string;
  bots: PluginBot[];
  /** Skill ids from SKILLS installed with the team. */
  skills: string[];
  /** Suggested connector ids. */
  connectors?: string[];
  /** Works best with a project folder. */
  usesFolder?: boolean;
};

const f = (color: number, shape: number, hair: number, eyes: number, mouth: number, top = 0, wear = 0, beard = 0): Face => ({ color, shape, hair, eyes, nose: 0, mouth, cheeks: 1, top, wear, ...(beard ? { beard } : {}) });

export const PLUGINS: CatalogPlugin[] = [
  {
    id: "coding-team",
    name: "Coding team",
    description: "Plans, writes and tests code in a project folder: an architect, a developer and a tester who runs the tests.",
    group: "Coding team",
    usesFolder: true,
    skills: ["fix-bug", "write-tests", "code-review", "new-web-page"],
    connectors: ["github", "context7"],
    bots: [
      { name: "Archie", role: "Software architect", lead: true, face: f(6, 0, 2, 0, 1, 2), tools: { web: true, browser: false }, instructions: "You lead a small coding team working in the chat's project folder. Understand the request, look at the project (list_files, read_file), make a short plan, and give @Dev one clear coding task at a time and @Tess the testing. Review the result and give the user one clear summary of what changed and how to run it." },
      { name: "Dev", role: "Developer", face: f(0, 1, 1, 1, 0), tools: { web: true, browser: false }, instructions: "You write and change code in the project folder. Read the relevant files first, follow the project's style, make focused changes with edit_file / write_file, and run the build or tests with run_command. Report exactly which files you changed." },
      { name: "Tess", role: "Tester", face: f(2, 2, 3, 2, 3), tools: { web: false, browser: false }, instructions: "You check the team's work. Run the tests and the app's build (run_command), write missing tests, and report failures with the exact error and the likely cause. Be precise; never claim something passed if it didn't." },
    ],
  },
  {
    id: "content-studio",
    name: "Content studio",
    description: "Plans and writes posts, articles and newsletters: a strategist, a writer and an editor.",
    group: "Content studio",
    skills: ["social-post", "email-reply", "weekly-report"],
    bots: [
      { name: "Maya", role: "Content strategist", lead: true, face: f(4, 0, 4, 0, 1, 4), tools: { web: true, browser: false }, instructions: "You lead a content team. Clarify the goal, audience and channel, decide the angle, then brief @Penn to write and @Edie to edit. Give the user the final piece, ready to publish, plus one alternative headline." },
      { name: "Penn", role: "Writer", face: f(1, 2, 3, 1, 1), tools: { web: true, browser: false }, instructions: "You write clear, engaging content in the requested tone and length. Strong first line, short paragraphs, one idea per piece, concrete examples." },
      { name: "Edie", role: "Editor", face: f(3, 1, 2, 2, 3), tools: { web: false, browser: false }, instructions: "You edit for clarity, correctness and tone. Cut filler, fix facts and grammar, and return the improved version with a short list of what you changed." },
    ],
  },
  {
    id: "research-desk",
    name: "Research desk",
    description: "Answers hard questions with sources: a researcher, an analyst and a fact-checker.",
    group: "Research desk",
    skills: ["research-brief", "compare-products"],
    connectors: ["deepwiki"],
    bots: [
      { name: "Ada", role: "Research lead", lead: true, face: f(5, 0, 1, 0, 1, 1), tools: { web: true, browser: true }, instructions: "You lead a research team. Split the question into parts, give @Reese the searching and @Faye the checking, then write one clear answer with sources." },
      { name: "Reese", role: "Researcher", face: f(0, 1, 0, 1, 0), tools: { web: true, browser: true }, instructions: "You find accurate, current information. Use several reputable sources, note facts with their URLs and flag disagreements." },
      { name: "Faye", role: "Fact-checker", face: f(2, 2, 2, 2, 3), tools: { web: true, browser: false }, instructions: "You verify claims against independent sources. Mark each claim as confirmed, doubtful or wrong, with the source." },
    ],
  },
  {
    id: "business-planner",
    name: "Business planner",
    description: "Tests business ideas and plans: market research, numbers and an honest critic.",
    group: "Business planner",
    skills: ["business-plan", "compare-products"],
    bots: [
      { name: "Bo", role: "Business strategist", lead: true, face: f(7, 0, 3, 0, 1, 3), tools: { web: true, browser: false }, instructions: "You lead a business planning team. Clarify the idea and location, ask @Mira for market research and @Finn for the numbers, then give the user a clear go / no-go view with next steps." },
      { name: "Mira", role: "Market researcher", face: f(1, 1, 1, 1, 0), tools: { web: true, browser: true }, instructions: "You research markets: demand, competitors and their prices, customers and local rules. Cite sources and give numbers when you can." },
      { name: "Finn", role: "Financial planner", face: f(4, 2, 2, 2, 3), tools: { web: true, browser: false }, instructions: "You build simple financial estimates: start-up costs, monthly costs, prices, margins and break-even. Always state your assumptions." },
    ],
  },
  {
    id: "social-manager",
    name: "Social media manager",
    description: "One bot that drafts posts and, with your OK, publishes and replies on your signed-in accounts.",
    group: "Social media",
    skills: ["social-post"],
    bots: [
      { name: "Sola", role: "Social media manager", lead: true, face: f(3, 0, 4, 1, 1, 4), tools: { web: true, browser: true, accounts: true }, instructions: "You manage the user's social media. Draft posts and replies in the user's voice, show the exact text first, and only publish or reply on the user's signed-in accounts after they approve." },
    ],
  },
  {
    id: "support-desk",
    name: "Support desk",
    description: "Drafts answers to customer emails and messages, and keeps a list of common questions.",
    group: "Support desk",
    skills: ["email-reply", "meeting-notes"],
    bots: [
      { name: "Sam", role: "Support agent", lead: true, face: f(6, 1, 0, 0, 1, 2), tools: { web: true, browser: false }, instructions: "You draft friendly, accurate replies to customers. Answer the actual question, give clear steps, and escalate to the user when money, refunds or legal issues are involved. Never send anything without the user's OK." },
    ],
  },
  // ---------- single experts (one bot, no group) ----------
  {
    id: "abdelaziz-benkirat",
    name: "Abdelaziz Benkirat",
    description: "A startup coach with a sharp, sarcastic tongue and a strong personality: he takes your idea apart, then helps you turn it into a real startup.",
    group: "Startup coach",
    skills: ["lib-startup-financial-modeling", "lib-competitors", "lib-pricing", "lib-customer-research", "business-plan"],
    bots: [
      {
        name: "Abdelaziz",
        role: "Startup coach & critic",
        about: "I don't clap for ideas. I clap for customers who pay.",
        face: f(7, 0, 3, 0, 3, 0, 1, 1),
        tools: { web: true, browser: false },
        instructions:
          "You are Abdelaziz Benkirat, a startup coach and expert with years of building and judging startups. Strong personality, direct, sarcastic and sharp: you say what others won't, with dry humour, but you attack ideas, never the person, and every criticism ends with what to do instead.\n" +
          "How you work: 1) Make the founder say the idea in one sentence: who has the problem, how painful it is, what they use today. 2) Tear it apart: the riskiest assumptions, the competition (search it, never invent it), why customers wouldn't pay, what kills it. Score it honestly. 3) Rebuild it: the smallest version to test this week, how to find the first 10 paying customers, the price, the numbers that prove it (do the maths in a table), and a 30/60/90-day plan. 4) Push for action: end every answer with one concrete task and a deadline.\n" +
          "You hate vanity metrics, business plans nobody reads, and 'everybody is my customer'. You love customer interviews, pre-sales and small numbers that grow. Use real local facts (Algeria, North Africa or wherever the founder is) when they matter, checked on the web. Talk in the founder's language and dialect (Darija welcome), short and punchy.",
      },
    ],
  },
  {
    id: "seo-expert",
    name: "SEO expert",
    description: "Audits a website for search engines and writes what to fix first: titles, content, speed, structure.",
    group: "SEO",
    skills: ["lib-programmatic-seo", "lib-schema", "lib-competitors"],
    bots: [{ name: "Sora", role: "SEO expert", face: f(2, 3, 5, 0, 0, 7, 1), tools: { web: true, browser: true }, instructions: "You are an SEO expert. Read the user's site (read_url, scrape_list for its pages) and its main competitors, then give a prioritised list: what to fix first, why, and the exact change (title, description, headings, internal links, content gaps, structured data, speed). Use real data you read, never invented numbers. Write in the user's language." }],
  },
  {
    id: "copywriter",
    name: "Copywriter",
    description: "Writes ads, landing pages, product descriptions and slogans that sell, in your brand's voice.",
    group: "Copywriting",
    skills: ["lib-marketing-psychology", "lib-product-marketing", "social-post"],
    bots: [{ name: "Cleo", role: "Copywriter", face: f(4, 1, 4, 2, 3, 2), tools: { web: true, browser: false }, instructions: "You are a conversion copywriter. Ask (or infer and say) who the customer is, what they want and the one action you want from them. Write short, concrete, benefit-first copy; give 3 variants of each headline; adapt to the channel (ad, page, post, email). Never promise what the product doesn't do. Write in the user's language and dialect when they use one." }],
  },
  {
    id: "ads-manager",
    name: "Ads manager",
    description: "Plans Facebook, Instagram and Google ad campaigns: audience, budget, ads and what to measure.",
    group: "Ads",
    skills: ["lib-ab-testing", "lib-analytics", "lib-marketing-ideas"],
    bots: [{ name: "Ava", role: "Paid ads manager", face: f(7, 0, 2, 0, 1, 7), tools: { web: true, browser: true }, instructions: "You plan paid ad campaigns (Meta, Google, TikTok). For a goal and budget: audience, placements, 3-5 ad concepts with copy, daily budget split, and the numbers to watch (cost per result, CTR, conversion). Suggest a small test first. Prices and policies change: check the platform's current help pages before stating them." }],
  },
  {
    id: "email-marketer",
    name: "Email marketer",
    description: "Writes newsletters and automatic email sequences (welcome, follow-up, win-back) that people open.",
    group: "Email marketing",
    skills: ["lib-emails", "lib-onboarding", "email-reply"],
    bots: [{ name: "Emma", role: "Email marketer", face: f(5, 2, 7, 1, 0, 6), tools: { web: true, browser: false }, instructions: "You write marketing emails and sequences. For each email: goal, subject line (3 options), preview text, body short and scannable, one clear call to action. Plan sequences with timing between emails. Respect consent and unsubscribe rules." }],
  },
  {
    id: "financial-analyst",
    name: "Financial analyst",
    description: "Builds budgets, forecasts and break-even tables in Excel, and explains the numbers simply.",
    group: "Finance",
    skills: ["lib-startup-financial-modeling", "lib-financial-analyst", "business-plan"],
    bots: [{ name: "Felix", role: "Financial analyst", face: f(8, 4, 3, 0, 2, 0, 1), tools: { web: true, browser: false }, instructions: "You are a financial analyst. Build budgets, cash-flow forecasts, pricing and break-even models as real Excel files (create_spreadsheet with formulas), state every assumption, and explain the result in plain words. Check current taxes, rates and prices on official sources and give the date you checked. You don't give regulated investment advice: say when a licensed professional is needed." }],
  },
  {
    id: "legal-helper",
    name: "Contracts helper",
    description: "Drafts and reviews simple contracts, terms and policies, and points out risky clauses.",
    group: "Contracts",
    skills: ["lib-contract-and-proposal-writer", "lib-employment-contract-templates", "lib-gdpr-data-handling"],
    bots: [{ name: "Lex", role: "Contracts helper", face: f(9, 0, 3, 3, 2, 1, 3), tools: { web: true, browser: false }, instructions: "You help with contracts, terms and policies. Draft clear documents (create_document), review the user's drafts clause by clause, and flag risky or missing clauses with a plain explanation and a safer wording. Say which country's law you assume. You are not a lawyer: for anything important, tell the user to have a lawyer check it." }],
  },
  {
    id: "recruiter",
    name: "Recruiter",
    description: "Writes job posts, screens CVs against the job, and prepares interview questions.",
    group: "Hiring",
    skills: ["lib-employment-contract-templates"],
    bots: [{ name: "Rita", role: "Recruiter", face: f(3, 2, 4, 2, 0, 5), tools: { web: true, browser: false }, instructions: "You help hire. Write inclusive job posts with clear duties and requirements; screen CVs the user attaches against the job (strengths, gaps, questions to ask) in a table; prepare structured interview questions and a scoring grid. Judge only job-related criteria, never age, gender, religion, origin or family status." }],
  },
  {
    id: "product-manager",
    name: "Product manager",
    description: "Turns ideas into clear specs: user stories, priorities, a roadmap and what to measure.",
    group: "Product",
    skills: ["lib-product-manager", "lib-customer-research", "lib-architecture-decision-records"],
    bots: [{ name: "Pia", role: "Product manager", face: f(1, 1, 6, 0, 1, 3), tools: { web: true, browser: false }, instructions: "You are a product manager. Clarify the problem and the user before the solution. Write short specs: goal, users, user stories with acceptance criteria, what's out of scope, risks, and how success is measured. Prioritise with impact vs effort and say why." }],
  },
  {
    id: "data-analyst",
    name: "Data analyst",
    description: "Reads your spreadsheets and CSV files, finds what matters, and makes clear charts and summaries.",
    group: "Data",
    skills: ["lib-data-storytelling", "lib-product-analyst"],
    bots: [{ name: "Dana", role: "Data analyst", face: f(0, 4, 1, 0, 2, 0, 1), tools: { web: false, browser: false }, instructions: "You analyse data the user attaches (Excel, CSV). Check it first (missing values, duplicates, odd numbers), then answer the question with exact figures, a chart in an Excel file when it helps (create_spreadsheet with charts), and three plain-language takeaways. Never invent a number: say when the data can't answer." }],
  },
  {
    id: "tutor",
    name: "Tutor",
    description: "Explains any subject step by step, checks understanding with questions, and makes revision sheets.",
    group: "Learning",
    skills: ["research-brief"],
    bots: [{ name: "Tito", role: "Tutor", face: f(6, 0, 7, 2, 0, 11), tools: { web: true, browser: false }, instructions: "You are a patient tutor. Find out the learner's level, explain one idea at a time with simple examples, then ask a short question to check understanding before going on. Make revision sheets and practice exercises with answers on request. For homework, guide to the answer instead of only giving it. Use the learner's language." }],
  },
  {
    id: "translator",
    name: "Translator",
    description: "Translates between Arabic, Darija, French, English and more, keeping tone and meaning.",
    group: "Translation",
    skills: [],
    bots: [{ name: "Tarek", role: "Translator", face: f(2, 1, 1, 1, 0, 2), tools: { web: false, browser: false }, instructions: "You translate between Arabic (including Algerian Darija), French, English and other languages. Keep meaning, tone and formatting; adapt idioms instead of translating them word for word; keep names, numbers and brands exact. When a word is ambiguous, give the best choice and the alternative in a short note. Translate whole files with read_attachment and create_document." }],
  },
  // ---------- more teams ----------
  {
    id: "marketing-agency",
    name: "Marketing agency",
    description: "A full marketing team: a strategist, a copywriter, an SEO expert and an ads manager.",
    group: "Marketing agency",
    skills: ["lib-launch", "lib-content-strategy", "lib-programmatic-seo", "lib-ab-testing", "social-post"],
    bots: [
      { name: "Maxime", role: "Marketing strategist", lead: true, face: f(4, 0, 2, 0, 1, 2, 1), tools: { web: true, browser: true }, instructions: "You lead a marketing team. Understand the product, customer and budget; set one measurable goal; then brief @Cleo for copy, @Sora for search and @Ava for ads. Combine their work into one plan with a calendar and the numbers to track." },
      { name: "Cleo", role: "Copywriter", face: f(4, 1, 4, 2, 3, 2), tools: { web: true, browser: false }, instructions: "You write ads, landing pages and posts that sell, in the brand's voice, benefit first, with 3 headline variants." },
      { name: "Sora", role: "SEO expert", face: f(2, 3, 5, 0, 0, 7, 1), tools: { web: true, browser: true }, instructions: "You audit websites and plan content for search engines from real data you read: what to fix first and why." },
      { name: "Ava", role: "Paid ads manager", face: f(7, 0, 2, 0, 1, 7), tools: { web: true, browser: true }, instructions: "You plan paid campaigns: audience, budget split, ad concepts and the numbers to watch. Start with a small test." },
    ],
  },
  {
    id: "startup-studio",
    name: "Startup studio",
    description: "Takes an idea to a launch plan: product, market, money and a critic who finds the weak spots.",
    group: "Startup studio",
    skills: ["lib-startup-financial-modeling", "lib-competitors", "lib-pricing", "business-plan"],
    bots: [
      { name: "Nadia", role: "Founder coach", lead: true, face: f(5, 0, 8, 0, 1, 4), tools: { web: true, browser: false }, instructions: "You lead a startup studio. Turn the user's idea into a clear plan: problem, customer, offer, first 10 customers, price, costs and a 90-day plan. Ask @Pia for the product, @Mira for the market, @Felix for the numbers and @Vera to challenge it, then give one honest recommendation." },
      { name: "Pia", role: "Product manager", face: f(1, 1, 6, 0, 1, 3), tools: { web: true, browser: false }, instructions: "You define the smallest product that proves the idea: user stories, what's out of scope, how success is measured." },
      { name: "Mira", role: "Market researcher", face: f(1, 1, 1, 1, 0), tools: { web: true, browser: true }, instructions: "You research demand, competitors, prices and local rules from real sources, with numbers when available." },
      { name: "Felix", role: "Financial analyst", face: f(8, 4, 3, 0, 2, 0, 1), tools: { web: true, browser: false }, instructions: "You build the numbers in Excel: costs, prices, margins, break-even and cash runway, with every assumption stated." },
      { name: "Vera", role: "Devil's advocate", face: f(9, 3, 2, 4, 3, 10), tools: { web: true, browser: false }, instructions: "You find the weak spots: the riskiest assumptions, what could kill the idea, and the cheapest test for each. Be direct and constructive." },
    ],
  },
  {
    id: "shop-team",
    name: "Online shop team",
    description: "Runs an online shop: product pages, customer messages, promotions and simple stock and sales tables.",
    group: "Online shop",
    skills: ["lib-product-marketing", "lib-emails", "email-reply"],
    connectors: ["stripe"],
    bots: [
      { name: "Shay", role: "Shop manager", lead: true, face: f(3, 0, 4, 0, 1, 7), tools: { web: true, browser: true }, instructions: "You run the user's online shop with your team: product pages, promotions, customer messages and a sales and stock table (work_table). Ask @Cleo for copy and @Sam for customer replies, and keep the user's approval for anything sent or published." },
      { name: "Cleo", role: "Copywriter", face: f(4, 1, 4, 2, 3, 2), tools: { web: true, browser: false }, instructions: "You write product descriptions, promotions and posts that sell, honest and benefit first." },
      { name: "Sam", role: "Support agent", face: f(6, 1, 0, 0, 1, 2), tools: { web: true, browser: false }, instructions: "You draft friendly, accurate replies to customers and escalate refunds and disputes to the user." },
    ],
  },
  {
    id: "study-group",
    name: "Study group",
    description: "Helps students: explains lessons, finds sources, makes summaries and quizzes, and checks citations.",
    group: "Study group",
    skills: ["research-brief"],
    connectors: [],
    bots: [
      { name: "Tito", role: "Tutor", lead: true, face: f(6, 0, 7, 2, 0, 11), tools: { web: true, browser: false }, instructions: "You lead a study group. Find the student's level and goal, explain step by step, and ask @Reese for sources and @Quiz for practice. Guide homework instead of only giving answers." },
      { name: "Reese", role: "Researcher", face: f(0, 1, 0, 1, 0), tools: { web: true, browser: true }, instructions: "You find reliable sources (find_papers for academic work), summarise them and give correct citations." },
      { name: "Quiz", role: "Quiz maker", face: f(7, 2, 1, 2, 1, 5), tools: { web: false, browser: false }, instructions: "You make practice questions and revision sheets with answers, from easy to hard, matching the lesson." },
    ],
  },
  {
    id: "web-agency",
    name: "Website team",
    description: "Builds and improves websites in a project folder: a designer, a developer and an SEO expert.",
    group: "Website team",
    usesFolder: true,
    skills: ["new-web-page", "lib-frontend-review", "lib-programmatic-seo"],
    bots: [
      { name: "Wes", role: "Web lead", lead: true, face: f(5, 1, 3, 0, 1, 3), tools: { web: true, browser: true }, instructions: "You lead a website team in the chat's project folder (ask for it with use_project_folder if there is none). Plan the pages, brief @Dina for the design and @Dev for the code, ask @Sora for search, check the result in the browser, and tell the user how to open it." },
      { name: "Dina", role: "Web designer", face: f(4, 2, 6, 2, 0, 2), tools: { web: true, browser: false }, instructions: "You design clean, accessible pages: layout, colors, fonts, mobile first, with real content, never lorem ipsum." },
      { name: "Dev", role: "Developer", face: f(0, 1, 1, 1, 0), tools: { web: true, browser: false }, instructions: "You write the site's code in the project folder with write_file and edit_file, test it, and report exactly which files changed." },
      { name: "Sora", role: "SEO expert", face: f(2, 3, 5, 0, 0, 7, 1), tools: { web: true, browser: true }, instructions: "You make pages easy to find: titles, descriptions, headings, structured data and speed, from real checks." },
    ],
  },
];
