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
  category: "dev" | "data" | "search" | "productivity" | "docs" | "business";
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  fields?: CatalogField[];
  /** stdio servers started with npx need Node.js on the computer. */
  needsNode?: boolean;
  docs?: string;
};

export const CONNECTORS: CatalogConnector[] = [
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
  {
    id: "context7",
    name: "Context7",
    by: "Upstash",
    verified: true,
    category: "docs",
    description: "Up-to-date docs and code examples for thousands of libraries, so coding bots don't guess APIs.",
    transport: "http",
    url: "https://mcp.context7.com/mcp",
    docs: "https://github.com/upstash/context7",
  },
  {
    id: "mslearn",
    name: "Microsoft Learn",
    by: "Microsoft",
    verified: true,
    category: "docs",
    description: "Search official Microsoft and Azure documentation.",
    transport: "http",
    url: "https://learn.microsoft.com/api/mcp",
    docs: "https://learn.microsoft.com/training/support/mcp",
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    by: "Cognition",
    verified: true,
    category: "docs",
    description: "Ask questions about any public GitHub repository and get answers from its code and docs.",
    transport: "http",
    url: "https://mcp.deepwiki.com/mcp",
    docs: "https://docs.devin.ai/work-with-devin/deepwiki-mcp",
  },
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
  {
    id: "stripe",
    name: "Stripe",
    by: "Stripe",
    verified: true,
    category: "business",
    description: "Look up customers, payments and invoices. Use a restricted key with only the access you want to give.",
    transport: "http",
    url: "https://mcp.stripe.com",
    fields: [{ key: "key", label: "Stripe restricted key", secret: true, placeholder: "rk_live_…", help: "https://dashboard.stripe.com/apikeys", to: "header", name: "Authorization", template: "Bearer {value}" }],
    docs: "https://docs.stripe.com/mcp",
  },
  {
    id: "notion",
    name: "Notion",
    by: "Notion",
    verified: true,
    category: "productivity",
    description: "Search, read and update your Notion pages and databases.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    needsNode: true,
    fields: [{ key: "token", label: "Notion integration token", secret: true, placeholder: "ntn_…", help: "https://www.notion.so/profile/integrations", to: "env", name: "NOTION_TOKEN" }],
    docs: "https://github.com/makenotion/notion-mcp-server",
  },
  {
    id: "brave",
    name: "Brave Search",
    by: "Brave",
    verified: true,
    category: "search",
    description: "Web, news and local search through the Brave Search API.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@brave/brave-search-mcp-server"],
    needsNode: true,
    fields: [{ key: "key", label: "Brave Search API key", secret: true, help: "https://api-dashboard.search.brave.com/app/keys", to: "env", name: "BRAVE_API_KEY" }],
    docs: "https://github.com/brave/brave-search-mcp-server",
  },
  {
    id: "supabase",
    name: "Supabase",
    by: "Supabase",
    verified: true,
    category: "data",
    description: "Manage Supabase projects: tables, SQL, edge functions and logs (read-only).",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@supabase/mcp-server-supabase@latest", "--read-only"],
    needsNode: true,
    fields: [{ key: "token", label: "Supabase access token", secret: true, placeholder: "sbp_…", help: "https://supabase.com/dashboard/account/tokens", to: "env", name: "SUPABASE_ACCESS_TOKEN" }],
    docs: "https://supabase.com/docs/guides/getting-started/mcp",
  },
  {
    id: "filesystem",
    name: "Files",
    by: "MCP reference servers",
    category: "productivity",
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
    category: "productivity",
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
    category: "productivity",
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

export type PluginBot = { name: string; role: string; instructions: string; face: Face; tools: BotTools; lead?: boolean };
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

const f = (color: number, shape: number, hair: number, eyes: number, mouth: number, top = 0, wear = 0): Face => ({ color, shape, hair, eyes, nose: 0, mouth, cheeks: 1, top, wear });

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
];
