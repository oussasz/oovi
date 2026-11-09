// oovi_help: short, accurate how-to text about oovi itself, by topic. Bots call it
// when the user asks how oovi works or how to connect or do something, instead of
// guessing. "/help" in the composer answers from the same text without a model call.
//
// Keep every name and path in sync with the real UI (lib/i18n/en.ts, components/*).

import type { ToolSpec } from "./llm";

export const HELP_TOPICS = {
  overview: "What oovi is, and the list of help topics",
  marketplace: "Connectors, skills and plugins: add, turn on per bot, remove",
  skills: "Create, install and use skills",
  groups: "Groups, @mentions, the team leader and leader mode, the main bot",
  effort: "Effort levels and Deep work",
  credits: "theOovi credits, the daily safety limit, using your own API keys and models",
  folders: "Project folders and approvals",
  computer: "The cloud computer",
  telegram: "Using your main bot from Telegram",
  memory: "Memory, lessons and self-learning",
  settings: "Where every setting lives, and links into the app",
  commands: "Slash commands in the message box",
} as const;

export type HelpTopic = keyof typeof HELP_TOPICS;

const TEXT: Record<HelpTopic, string> = {
  overview: `oovi is a team of AI bots ("slimes") on the user's computer. Each bot has a name, a role, instructions, a look and abilities. Bots work alone in a 1:1 chat or together in groups.
- Sidebar: Home, "+ Group" and "+ Bot" buttons, your groups and bots, then Marketplace and Settings at the bottom, plus the credits chip when using theOovi.
- A chat's header has the project folder button, a pencil (Edit bot / Edit group), Clear conversation and the Live view panel.
- Under the message box: Effort and Deep work. Type @ to mention a bot, / for commands.
Topics: ${Object.keys(HELP_TOPICS).filter((k) => k !== "overview").join(", ")}.`,

  marketplace: `Marketplace (sidebar, bottom) has four tabs: Connectors, Skills, Plugins and Memory. Connectors, Skills and Plugins each have "Yours" (installed) and "Discover" (catalog), a search box and an "+ Add" menu.
Connectors (MCP servers) link bots to apps:
- Add: Connectors > Discover > press + on a card. Most connectors sign in through the browser (oovi connects once you approve). Some need a key or token (e.g. GitHub) or Node.js.
- Zapier (featured) and Pipedream connect thousands of apps: Gmail, Google Drive, Docs, Sheets, Calendar, Outlook, Teams, Slack, HubSpot… In Zapier you choose which apps and actions bots may use (zapier.com/mcp).
- Gmail, Google Drive, Google Calendar, Microsoft 365, Slack and HubSpot show "Coming soon": connect them through Zapier or Pipedream today.
- Typing in the search box also searches the official MCP registry (community listings, not checked by oovi). "+ Add > Custom connector" adds any MCP server by command or URL.
- Turn a connector on for a bot: open the bot (pencil in its chat header, "Edit bot") > Abilities > "Tools from MCP servers" > click the connector > Save. A connector is not available to a bot until this is done.
- Connectors > Yours: each one shows its status; "on" switches it off for every bot, "Always allow" lets bots use it without asking (otherwise every use asks you first), Connect / Sign in again, Test, and the bin icon removes it.
Skills: step-by-step procedures every bot can use (no per-bot switch). Skills > Discover: oovi skills and skills from Anthropic; press + to add. Skills > Yours: edit or delete. See topic "skills".
Plugins: ready-made bot teams. Plugins > Discover > "Add team" creates the bots, a group with leader mode on, and installs the team's skills. Plugins > Yours: Open the group, or the bin icon removes the team (its bots and group; skills stay).`,

  skills: `A skill is a step-by-step procedure (a SKILL.md file: name, when to use it, Markdown instructions). Every bot can use every skill; there's nothing to switch on per bot.
- Install: Marketplace > Skills > Discover > press + (oovi skills and skills from Anthropic).
- Write your own: Marketplace > Skills > "+ Add" > "Write a skill": a name, "When to use it" and "Instructions (Markdown)", then Save skill.
- From a link: "+ Add" > "Install a skill from a link": an https link to a raw SKILL.md file or a GitHub folder that contains one.
- Edit or delete: Marketplace > Skills > Yours (pencil / bin).
- Using: skills that match a request load by themselves; bots can also load one by name. To force one, start the message with /skill-name (type / to pick it).
- Learning: when you ask for the same kind of task again and again, bots offer to save it as a skill (you approve). After bigger tasks a "Learned" box may offer "Save as skill".`,

  groups: `Groups put bots together.
- Create: sidebar "+ Group". Pick members (or "Design one" for a new bot), name the group, choose the Team leader and Leader mode, then "Create group". Change it later with the pencil in the group's header ("Edit group").
- In a group, @mention a bot to choose who answers (@everyone or @all = all members). Nobody mentioned: the team leader answers.
- Leader mode (on by default): the leader plans, hands tasks to teammates with @mentions, checks their results and writes one final answer. Off: a free-form chat where anyone can hand off to anyone.
- Bots hand work to each other with @mentions. "Hand-offs per message" in Settings > Safety limits how many times.
- Main bot: Edit bot > Abilities > "Main bot". It runs all your groups (gives them tasks and reports back) and answers you on Telegram. Only one bot can be the main bot.
- New bot: sidebar "+ Bot". Abilities per bot: Web search, Browser, "Use my signed-in accounts", Tools from MCP servers. Brain: the model it uses.`,

  effort: `Under the message box:
- Effort (Auto, Low, Medium, High, Max): how hard the bots think for your messages. Low is fastest and cheapest; Max thinks deepest and costs the most. Auto uses each model's default. Your choice is remembered.
- Deep work: for big tasks. The bots write a plan (shown live as a checklist), work longer with more steps and hand-offs, use more tools, create real files and check their work before answering. It's remembered per chat and uses more credits.
- For one message only: start it with /deep or /effort low|medium|high|max.`,

  credits: `theOovi is the AI model included with an oovi account. It runs on credits, with no API key needed.
- The credits chip at the bottom of the sidebar shows the balance. Click it for details: the daily safety limit (resets at midnight UTC; it protects credits from a runaway task), Subscribe for more, and "Use my own API key".
- Bigger tasks, Deep work and higher effort use more credits. Each reply shows the credits it used.
- Own API keys: Settings > AI models. Choose "Use my own models", connect a provider, paste its key and switch on models. They're tried in order: if one fails, the next takes over. The theOovi card at the top of AI models switches back. Keys are encrypted and stay on this computer; you pay the provider per use. Google Gemini and OpenRouter have free tiers ("Add free models").
- One bot on a specific model: Edit bot > Brain > Model.`,

  folders: `Project folder: the folder button in a chat's header > "Choose folder…" (or paste a full path) > "Use this folder". The bots in that chat can then work with the files in it, and nothing outside it.
- Reading and searching files never asks. Creating and editing files asks you first, unless you tick "Let bots create and edit files without asking". Deleting files and running commands always ask. Files outside the folder: never.
- Approvals appear in the chat: Allow (or "Allow once"), "Always allow edits here", or Deny.
- Without a project folder, files bots make (Word, Excel, PowerPoint, PDF…) go to your Downloads/oovi folder.
- Other approvals live in Settings > Safety: asking before a bot types, downloads or clicks buttons on a web page; "Max steps per bot reply"; "Hand-offs per message". Bots using your signed-in accounts, saving a skill and connector (MCP) actions always ask, unless a connector is marked "Always allow" in Marketplace > Connectors > Yours.`,

  computer: `Cloud computer: Settings > Cloud computer. Paste an E2B API key (free sign-up at e2b.dev; "(get one)" link next to the field) and save. Then every bot can use it.
- Each chat gets its own private Linux machine with Python, Node.js and internet. It turns itself off after 20 idle minutes.
- Bots run code, analyze data, make charts, install tools and build apps there, hand you the results as files in the chat, and can share a public link to a web app they built.
- "Remove key" turns it off. Without it, bots can still run commands in a chat's project folder on this PC (you approve each one).`,

  telegram: `Telegram: Settings > Telegram. Talk to your main bot from your phone.
1. In Telegram, open @BotFather, send /newbot, choose a name and a username ending in "bot". BotFather replies with a token.
2. Paste the token in oovi.
3. Open the link oovi shows and press Start (a one-time code, so only you can connect).
Then: write to it like in oovi; when a bot needs your OK you get the details there (reply /yes or /no); results of long group jobs arrive there too. oovi must stay open on this computer. The main bot is chosen in Edit bot > Abilities > "Main bot".`,

  memory: `Memory: Marketplace > Memory. All bots share two small notebooks they update on their own: "About you (USER.md)" (your name, role, preferences, projects, people) and "Notes (MEMORY.md)" (lessons and facts). You can edit both there and Save; separate entries with a line containing only §.
- Lessons learned (same tab): bots write them after real work and when you rate a reply. Each request only brings in matching lessons. "Forget" removes one. "Learn from my chats" turns self-learning on or off (one small extra model call after bigger tasks).
- Under each reply: thumbs up / thumbs down; with thumbs down you can say what should be better and the bots learn from it.
- Your name and photo: Settings > Profile.`,

  settings: `Settings: the gear at the bottom of the sidebar. Tabs: Profile (name, photo, sign out), AI models (theOovi or your own keys and models, their order), Telegram, Sites you signed in to (oovi's own browser sign-ins, for bots with "Use my signed-in accounts"), Web search (search provider), Browser (local or Docker, local network), Cloud computer (E2B key), Safety (approvals, max steps, hand-offs), Language, Data & backup (download / restore a backup), About & privacy (version, updates, crash reports).
Elsewhere: per-bot settings in Edit bot (pencil in a bot's chat header): About, Look, Brain (model), Abilities (Main bot, Web search, Browser, signed-in accounts, Tools from MCP servers). Group settings: pencil in a group's header. Connectors, skills, plugins and memory: Marketplace.
Links into the app, written by bots, show as buttons in chat: \`[Label](oovi://marketplace/connector/ID)\`, \`oovi://marketplace/skill/ID\`, \`oovi://marketplace/plugin/ID\`, \`oovi://marketplace/memory\`, \`oovi://settings/TAB\` (profile, models, telegram, accounts, search, browser, computer, safety, language, data, about), \`oovi://bot/BOTNAME\` (opens that bot's Abilities).`,

  commands: `Type / at the start of a message to open the command menu (filter by typing; Enter or click to insert):
- /help: how to use oovi. /help TOPIC (e.g. /help marketplace) shows one topic.
- /deep: Deep work for this message.
- /effort low|medium|high|max: effort for this message.
- /SKILL-NAME: use that installed skill for this request.
- /CONNECTOR (e.g. /zapier): use that connected connector for this request. If it's installed and on, the bot that answers gets its tools for this message even if it isn't switched on for that bot.
Sending only /deep or /effort … sets the chip under the message box. The command shows as a small badge on your message.`,
};

export const HELP_SPEC: ToolSpec = {
  name: "oovi_help",
  description: "How oovi itself works: where things are and how to connect, enable or do something in the app. Use it when the user asks how oovi works or how to set something up, instead of guessing.",
  parameters: {
    type: "object",
    properties: { topic: { type: "string", enum: Object.keys(HELP_TOPICS), description: Object.entries(HELP_TOPICS).map(([k, v]) => `${k}: ${v}`).join("; ") } },
    required: ["topic"],
  },
};

export const isHelpTopic = (x: string): x is HelpTopic => Object.prototype.hasOwnProperty.call(HELP_TOPICS, x);

/** Help text for a topic (unknown topics get the overview). */
export function ooviHelp(topic: string): string {
  const k = topic.trim().toLowerCase();
  return isHelpTopic(k) ? TEXT[k] : `Unknown topic "${topic}". ${TEXT.overview}`;
}

/** "/help marketplace" → "marketplace"; only exact topic names count (anything else is a question). */
export function helpTopicOf(text: string): HelpTopic | null {
  const k = text.trim().toLowerCase();
  if (!k) return "overview";
  return isHelpTopic(k) ? k : null;
}

/** The answer to a bare "/help" (no model call). */
export function helpAnswer(topic: HelpTopic): string {
  if (topic !== "overview") return TEXT[topic];
  return `${TEXT.overview}\n\n[Open the Marketplace](oovi://marketplace) [Open Settings](oovi://settings)\n\nType /help followed by a topic (for example /help marketplace), or ask me anything about oovi.`;
}
