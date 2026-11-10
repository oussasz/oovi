// oovi_help: short, accurate how-to text about oovi itself, by topic. Bots call it
// when the user asks how oovi works or how to connect or do something, instead of
// guessing. "/help" in the composer answers from the same text without a model call.
//
// Keep every name and path in sync with the real UI (lib/i18n/en.ts, components/*).

import type { ToolSpec } from "./llm";

export const HELP_TOPICS = {
  overview: "What oovi is, and the list of help topics",
  marketplace: "Connectors, skills and plugins: add, turn on per bot, remove",
  connectors: "Setting up a connector (Zapier and others): sign in, choose what oovi may do, test, which bots; fixing 0 tools or sign-in problems",
  files: "Files on this computer: finding, reading and sending your files (also on Telegram), approvals, allowed folders",
  skills: "Create, install and use skills",
  groups: "Groups, @mentions, the team leader and leader mode, the main bot",
  effort: "Effort levels and Deep work",
  credits: "theOovi credits, the daily safety limit, using your own API keys and models",
  folders: "Project folders and approvals",
  computer: "The cloud computer",
  desktop: "Desktop control (Beta): letting bots see the screen and use the mouse and keyboard in desktop apps, safety, Stop",
  telegram: "Using your main bot from Telegram",
  routines: "Routines: tasks a bot runs on a schedule (every morning, every Monday, every few hours), notifications, running in the background",
  memory: "Memory, lessons and self-learning",
  settings: "Where every setting lives, and links into the app",
  commands: "Slash commands in the message box",
} as const;

export type HelpTopic = keyof typeof HELP_TOPICS;

const TEXT: Record<HelpTopic, string> = {
  overview: `oovi is a team of AI bots ("slimes") on the user's computer. Each bot has a name, a role, instructions, a look and abilities. Bots work alone in a 1:1 chat or together in groups.
- Sidebar: Home, "+ Group" and "+ Bot" buttons, your groups and bots, then Routines, Marketplace and Settings at the bottom, plus the credits chip when using theOovi.
- A chat's header has the project folder button, a pencil (Edit bot / Edit group), Clear conversation and the Live view panel.
- Live view shows a bot's browser live while it works (one tab per bot). "Take control" lets you click and type in that browser yourself, e.g. to sign in or solve a CAPTCHA; the bot pauses and sees nothing until you press "Done — hand back". Bots ask for this themselves when a page needs a login ("needs you" banner). It works in the oovi app on your computer, not from Telegram.
- Under the message box: Effort and Deep work. Type @ to mention a bot, / for commands.
Topics: ${Object.keys(HELP_TOPICS).filter((k) => k !== "overview").join(", ")}.`,

  marketplace: `Marketplace (sidebar, bottom) has four tabs: Connectors, Skills, Plugins and Memory. Connectors, Skills and Plugins each have "Yours" (installed) and "Discover" (catalog), a search box and an "+ Add" menu.
Connectors (MCP servers) link bots to apps:
- Add: Connectors > Discover > press + on a card. Most connectors sign in through the browser (oovi connects once you approve). Some need a key or token (e.g. GitHub) or Node.js.
- Zapier (featured) and Pipedream connect thousands of apps: Gmail, Google Drive, Docs, Sheets, Calendar, Outlook, Teams, Slack, HubSpot… In Zapier you choose which apps and actions bots may use (zapier.com/mcp).
- Gmail, Google Drive, Google Calendar, Microsoft 365, Slack and HubSpot show "Coming soon": connect them through Zapier or Pipedream today.
- Typing in the search box also searches the official MCP registry (community listings, not checked by oovi). "+ Add > Custom connector" adds any MCP server by command or URL.
- A new connector is turned on for the main bot (the Chief) automatically. Other bots: Connectors > Yours > "Set up" > "Which bots can use it" ("All bots" in one click), or open the bot ("Edit bot") > Abilities > "Tools from MCP servers" > click the connector > Save. A connector is not available to a bot until this is done.
- Connectors > Yours: each one shows its status and how many tools it has; "on" switches it off for every bot, "Always allow" lets bots use it without asking (otherwise every use asks you first), Connect / Reconnect / Disconnect (sign out, keep the connector), "Set up" (the setup card: see topic "connectors"), and the bin icon removes it.
Skills: step-by-step procedures every bot can use (no per-bot switch). Skills > Discover: oovi skills and skills from Anthropic; press + to add. Skills > Yours: edit or delete. See topic "skills".
Plugins: ready-made bot teams. Plugins > Discover > "Add team" creates the bots, a group with leader mode on, and installs the team's skills. Plugins > Yours: Open the group, or the bin icon removes the team (its bots and group; skills stay).`,

  connectors: `Setting up a connector: Marketplace > Connectors > Yours > "Set up" opens its setup card (it also opens by itself right after connecting):
1. Signed in: press Connect, approve in the browser page that opens, then come back to oovi. "Reconnect" signs in again; "Disconnect" signs out.
2. Choose what oovi may do in the service (when it has such a page): the "Open…" button goes there.
3. "Test now" lists the tools oovi finds right now. Press it again after changing anything in the service.
4. "Which bots can use it": tick bots, or "All bots". The main bot gets new connectors automatically.
Zapier (verified with Zapier's docs, docs.zapier.com/mcp):
- oovi connects to https://mcp.zapier.com/api/v1/connect and you sign in with your Zapier account; Zapier creates your MCP server on first sign-in.
- Agentic mode (the default for new servers): oovi sees about 16 Zapier tools (discover_zapier_actions, enable_zapier_action, execute_zapier_read_action, execute_zapier_write_action, list_zapier_connections, get_configuration_url…). The bot finds and enables actions itself, e.g. Gmail: Find email, Send email; Google Drive: Find file. The app (Gmail, Drive…) must be connected in Zapier: get_configuration_url gives the link.
- Managed mode: each action you add is its own tool. With none added, oovi finds 0 tools. Fix: open mcp.zapier.com > your server > "+ Add tool", pick the app and its actions and connect your account; or switch the server to Agentic mode (Settings tab > Agentic mode > Save changes). Then press "Test now" in oovi.
- Every successful action uses 2 Zapier tasks from your Zapier plan.
Problems:
- 0 tools: nothing is enabled in the service yet (step 2), then "Test now".
- "Not signed in" or "needs you to sign in again": press Connect / Reconnect.
- The bot says it can't use the connector: it isn't turned on for that bot (step 4).
- An older Zapier connector that keeps failing: remove it (bin icon) and add Zapier again from Discover.`,

  files: `Files on this computer: bots can find, read and send you your own files (Desktop, Documents, Downloads, Pictures, Videos, Music, OneDrive, or any folder you name). Settings > Safety > "Files on this computer":
- "Ask me each time" (default): finding files by name never asks; reading, copying or sending a file asks you first: "Allow once", "Always allow this folder" or "Deny".
- "Allowed folders, no need to ask": add folders (Add folder…); bots read and send from them without asking. Everything else still asks.
- "Off": bots can't reach your files.
- Sending: the file shows in the chat (Open / Show in folder). When you write from Telegram, the file is uploaded there too (Telegram's limit is 50 MB).
- Never allowed, even with your OK: system folders, app data (browser profiles, passwords), hidden folders like .ssh, keys and secrets (.env, .key, .pem, .kdbx…), and oovi's own data. Bots never change or delete your files: edits are made on a copy in Downloads/oovi.`,

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
- Your other files (outside a project folder): see topic "files".
- Other approvals live in Settings > Safety: asking before a bot types, downloads or clicks buttons on a web page; "Max steps per bot reply"; "Hand-offs per message". Bots using your signed-in accounts, saving a skill and connector (MCP) actions always ask, unless a connector is marked "Always allow" in Marketplace > Connectors > Yours.`,

  computer: `Cloud computer: Settings > Cloud computer. Paste an E2B API key (free sign-up at e2b.dev; "(get one)" link next to the field) and save. Then every bot can use it.
- Each chat gets its own private Linux machine with Python, Node.js and internet. It turns itself off after 20 idle minutes.
- Bots run code, analyze data, make charts, install tools and build apps there, hand you the results as files in the chat, and can share a public link to a web app they built.
- "Remove key" turns it off. Without it, bots can still run commands in a chat's project folder on this PC (you approve each one).`,

  desktop: `Desktop control (Beta): bots can see your screen and use the mouse and keyboard to work in desktop apps (Windows only for now; coming to Mac once oovi is signed by Apple).
- Turn it on: Settings > Safety > "Control this computer (Beta)". Read the risks, tick the box to confirm, then switch on "Let bots control this computer". It's off by default.
- It works with theOovi, or your own Anthropic key with Claude Haiku 5.5, Sonnet 5.5 or Opus 5.5 as the bot's model. Other models: "Not available with this model".
- Every task asks first: "Let <bot> use your mouse and keyboard for this task?" > "Allow for this task" or Deny (on Telegram: /yes or /no). "Ask before every action" (on by default) also asks before every click, key press and typed text; only screenshots don't ask.
- While it works, a banner at the top of the screen says "oovi is controlling your computer" with a Stop button. Moving the mouse yourself also stops it at once, and so do locking the screen and 20 minutes without activity.
- Never use it for banking, payments or passwords. oovi refuses password managers (1Password, Bitwarden, KeePass, LastPass, Dashlane, Keeper…), Windows security prompts and banking or payment windows, and bots never type passwords. Windows running as administrator, User Account Control prompts and the lock screen can't be controlled.
- Screenshots are sent to the AI model while it works, show in the chat like browser screenshots, and stay on this computer for 30 days.`,

  telegram: `Telegram: Settings > Telegram. Talk to your main bot from your phone.
1. In Telegram, open @BotFather, send /newbot, choose a name and a username ending in "bot". BotFather replies with a token.
2. Paste the token in oovi.
3. Open the link oovi shows and press Start (a one-time code, so only you can connect).
Then: write to it like in oovi; when a bot needs your OK you get the details there (reply /yes, /no, or /yes always to also allow that folder or those edits from now on); results of long group jobs arrive there too. Ask for a file from your computer ("send me the report.pdf from my Documents") and it arrives in Telegram (up to 50 MB). oovi must stay open on this computer. The main bot is chosen in Edit bot > Abilities > "Main bot".
Advanced (optional, Settings > Telegram > Advanced, collapsed): link another Telegram chat, usually a Telegram group, to one oovi group. Add the bot to the Telegram group; oovi lists it under "Waiting to be linked" with its chat ID (groups are negative, e.g. -1001234567890); press "Link to group…". Messages there go to that group (its leader answers), approvals and files come back to the same chat, and only the paired owner can answer approvals in a group. In a Telegram group the bot answers replies to its messages, /ask@botname question, /yes and /no; to answer @mentions too, make the bot a group admin, or in @BotFather use /setprivacy > Disable and re-add the bot. Unlinked chats are ignored.`,

  routines: `Routines (sidebar, above Marketplace): a bot does a task on its own on a schedule, e.g. "every morning at 8, summarize my unread email".
- Add: Routines > "New routine": a name, the bot that runs it, what it should do (a complete request: nobody answers questions during a run), and how often: every day at a time, some days of the week at a time, or every N hours (1-24) from a start time. Times use this computer's time zone. Or ask the main bot in chat ("every Monday at 9, plan my week"): it proposes the routine and you click Allow to create it.
- Each routine runs in its own chat (Open chat), so runs are easy to compare. Messages it sends show a "Routine" badge.
- Results: a desktop notification (click it to open the chat), and on Telegram too if "Send results to Telegram" is on (pair Telegram first: topic "telegram").
- Safety: routines never approve anything themselves. If a step needs your OK (a connector action, a click on a web page…), the run waits, you're notified, and "Answer in chat" opens it. Plan mode is never used.
- Each routine has an on/off switch, Run now, Edit and Delete (deleting also deletes its chat). After 3 failed runs in a row a routine pauses itself and tells you; switch it back on once fixed. At most one run every 15 minutes.
- Routines need oovi open. If oovi was closed or the computer asleep at the scheduled time, the latest missed run happens when oovi is back within 12 hours; older ones are skipped ("Missed"). On Windows, closing the window quits oovi unless "Keep oovi running in the background (system tray)" is on (bottom of the Routines page); then quit from the tray icon. On a Mac, oovi keeps running when the window closes.
- Routines use the bot's own connectors: to read email or a calendar, connect Gmail, Outlook or Google Calendar (e.g. through Zapier) and turn it on for that bot (topic "marketplace").`,

  memory: `Memory: Settings > Memory & soul. All bots share two small notebooks they update on their own: "About you (USER.md)" (your name, role, preferences, projects, people) and "Notes (MEMORY.md)" (lessons and facts). You can edit both there and Save; separate entries with a line containing only §.
- Lessons learned (same tab): bots write them after real work and when you rate a reply. Each request only brings in matching lessons. "Forget" removes one. "Learn from my chats" turns self-learning on or off (one small extra model call after bigger tasks).
- Under each reply: thumbs up / thumbs down; with thumbs down you can say what should be better and the bots learn from it.
- Your name and photo: Settings > Profile.`,

  settings: `Settings: the gear at the bottom of the sidebar. Tabs: Profile (name, photo, sign out), AI models (theOovi or your own keys and models, their order), Telegram, Sites you signed in to (oovi's own browser sign-ins, for bots with "Use my signed-in accounts"), Web search (search provider), Browser (local or Docker, local network), Cloud computer (E2B key), Safety (approvals, max steps, hand-offs, Files on this computer, Control this computer), Language, Data & backup (download / restore a backup), About & privacy (version, updates, crash reports).
Elsewhere: per-bot settings in Edit bot (pencil in a bot's chat header): About, Look, Brain (model), Abilities (Main bot, Web search, Browser, signed-in accounts, Tools from MCP servers). Group settings: pencil in a group's header. Connectors, skills, plugins and memory: Marketplace.
Links into the app, written by bots, show as buttons in chat: \`[Label](oovi://marketplace/connector/ID)\`, \`oovi://marketplace/skill/ID\`, \`oovi://marketplace/plugin/ID\`, \`oovi://settings/TAB\` (profile, models, memory, telegram, accounts, search, browser, computer, safety, language, data, about), \`oovi://bot/BOTNAME\` (opens that bot's Abilities), \`oovi://routines\` (the Routines page).`,

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
