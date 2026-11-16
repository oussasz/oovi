import type { Notes, NotesMap } from "./release-notes";

// The "What's new" text for the versions released so far, rewritten to one format (see release-notes.ts):
// what a person can do or will notice, no code words, no install steps, no one's feedback.
// The owner can change any of it in Admin > Release notes; a saved change wins over this file.
// Versions 0.8.3 and 0.8.4 had exactly the same notes as 0.8.5, so they are hidden here (they can be shown again in the console).

type Parts = { new?: string[]; improved?: string[]; fixed?: string[]; know?: string[] };
function n(headline: string | null, p: Parts): Notes {
  const sections: Notes["sections"] = [];
  if (p.new?.length) sections.push({ title: "New", items: p.new });
  if (p.improved?.length) sections.push({ title: "Improved", items: p.improved });
  if (p.fixed?.length) sections.push({ title: "Fixed", items: p.fixed });
  if (p.know?.length) sections.push({ title: "Good to know", items: p.know });
  return { ...(headline ? { headline } : {}), sections };
}

export const SEED_NOTES: NotesMap = {
  "0.10.13": n("The same work for fewer credits", {
    improved: [
      "**Lower AI cost, same work.** Bots re-send less of the conversation and reuse more of what is already stored, so the same job uses fewer credits.",
      "**Shorter web reads.** Web pages are read in shorter parts first, and the bot asks for more only when it needs it.",
      "**Lighter thinking for routine steps.** Reading a page, saving a row or a click use a lighter level. The first step of each message, where the bot plans, keeps the full level, and so do Deep work and any effort level you choose.",
    ],
  }),
  "0.10.12": n("Questions as cards", {
    new: [
      "**Questions as cards.** Bots ask their questions as cards: tap an answer or write your own. One question at a time, and you can go back or let the bot decide.",
      "**One file per list or report.** When a bot changes something it already gave you, it updates the same file instead of making copies.",
      "**YouTube plays by itself.** The bot opens the video directly and it starts without a click.",
    ],
    improved: [
      "**Long lists.** Bots no longer lose rows, and they report the real counts.",
      "**Faster computer use,** with fewer waits between steps.",
      "**Visible progress.** While the bot thinks, its pointer moves gently, so you can see it is working.",
    ],
    fixed: ["The colored screen edges no longer appear in what the bot sees."],
  }),
  "0.10.11": n(null, {
    improved: ["**New versions are found faster.** oovi checks every 30 minutes and whenever you come back to it, so the update bar appears at the top by itself, without opening Settings."],
  }),
  "0.10.10": n("A livelier screen glow", {
    improved: [
      "**Moving screen edges.** When a bot uses your computer, the glowing edges move and wave, fit the size of your screen, and redraw if you plug in a screen or change the resolution.",
      "**A new bot pointer.** A soft rounded arrow in the same colors as the edges, so you can see where the bot is working.",
    ],
  }),
  "0.10.9": n("See the details before you add", {
    new: [
      "**Marketplace details.** Click any bot, team, connector or skill to see everything about it before adding it: its bots, abilities, instructions, skills and the fields it needs.",
    ],
    improved: ["**Glow on every screen.** When a bot uses your computer, the screen edges glow with soft, moving waves of color."],
  }),
  "0.10.8": n("Several screens, connector details and Setups", {
    new: [
      "**Several screens.** The bot works on the screen of the window it uses, sees it clearly, and can switch screens.",
      "**Connector details.** Each connector shows what it does, how it connects and its tools, and has a Disconnect button.",
      "**Setups.** “Plugins” are now called “Setups” in the app.",
    ],
    improved: [
      "**A glow while a bot is in control,** in oovi’s colors on every screen.",
      "**One OK is enough.** Bringing a window to the front or opening an app also allows the rest of the task.",
      "**Sign-in pages** show oovi’s website instead of “localhost”.",
    ],
    fixed: ["“This conversation is too long” no longer repeats on every message. Big connector results are made smaller, huge old results are shortened, and if a request still can’t fit, oovi tells you what is too big and what to turn off."],
  }),
  "0.10.7": n("Auto mode and smarter bots", {
    new: [
      "**Auto mode.** A new Auto button under the message box (and in Settings › Safety): bots stop asking before each step and work until the task is done. Deleting files, running commands, routines and team changes still ask, and Stop works at any time.",
      "**Email confirmation at sign-up.** New accounts confirm their email with a 6-digit code while signing up.",
      "**Send a screenshot (Windows).** A bot can send you a real picture of your screen.",
      "**Choose where bots save files:** Settings › Safety › Files on this computer.",
    ],
    improved: [
      "**Typing on your computer (Windows)** works in every language and keyboard: Arabic, French, English and emoji.",
      "**Smarter bots.** They stop repeating the same answer, ask you when there is a real choice, understand common Darija words (such as كابتير for screenshot), and save only the lessons you clearly said. When your message has no clear language, they answer in the language you were using.",
      "**Research and lists.** Pages that refused to load (business sites, Facebook pages, apps) are read automatically. Documentation chapters lead to their sub-pages. Paper search finds the right field. Tables accept new columns such as Status. Google Maps is read better. A task for a busy group waits its turn instead of being refused.",
      "**Complete reports.** Long reports are written in parts, so they are always complete.",
      "**Code in your project folder.** Code files go in the project folder you name, and the bot asks for that folder once.",
      "**Redesigned infographics:** timelines, big numbers and icons.",
      "**More room for bots.** A longer role, a new “Role description”, and shared knowledge up to 5,000 characters.",
      "**Cleaner work on your computer (Windows).** oovi moves its own window out of the way by itself again, and numbers read on screen are written down at once and checked again before they are sent.",
    ],
  }),
  "0.10.6": n("Bots finish what you ask", {
    new: [
      "**Bots finish what you ask.** After each piece of work, oovi checks whether what you asked is really done. If something is missing and the bot can do it alone, it goes on by itself, whatever the task is. It stops only when the work is done or when it truly needs you.",
      "**One plan, approved once.** For tasks on your computer or your accounts, the bot first shows the whole plan. You approve it once, and it carries out every step, adapting when something on screen is different.",
    ],
    improved: [
      "**Use your mouse freely.** Moving your mouse no longer stops the bot. To stop it, press Stop on the banner at the top of the screen.",
      "**Answers in your language,** even when the bot’s sources are in another language.",
      "**Faster lists.** When a page is a list (a directory, a catalogue), the bot takes the whole list in one step, and every bot that can search the web can do it. Finding businesses in an area now goes through oovi’s server, which works on slow connections.",
      "**Honest counts.** Rows marked “to confirm” no longer count toward the number you asked for, and bots never fill a list with weak rows just to reach it.",
    ],
    fixed: [
      "A click was refused after you had approved it, when oovi’s window was in front.",
      "Mac: files in your temporary folder are no longer refused.",
    ],
  }),
  "0.10.5": n("Web search that just works", {
    new: [
      "**Web search with no setup.** Bots always search the web, even if you never opened the search settings. If the search service you chose doesn’t answer, oovi uses its built-in search instead.",
      "**Window control (Windows).** A bot that controls your computer can see every open window, bring one to the front, minimize, maximize or close it, and open Microsoft Store apps such as WhatsApp.",
    ],
    improved: [
      "**“Retry” means retry.** When a long job stops before its goal, “retry”, “continue” or “do it” picks it up again with its goal and what is already found.",
      "**Cleaner directory lists.** A directory’s rank number (“01”, “02”) is no longer taken for a business name.",
    ],
    fixed: ["An error that could stop a bot in the middle of a long job."],
  }),
  "0.10.4": n("Collect hundreds of results in one step", {
    new: [
      "**Find businesses in one step.** Ask for “the cafés in Hydra, Algiers” and a bot gets them at once from open map data: name, address, phone number, email and website or Facebook page. It works for cities and districts anywhere, needs no account or key, and costs nothing per search.",
      "**Find scientific publications in one step.** Ask what research says about a topic and a bot gets up to hundreds of publications from open catalogues (Crossref, Europe PMC, arXiv): title, authors, year, journal, citations, abstract and a link to the free full text when there is one.",
      "**A whole website’s list in one go.** A bot can go through every page of a directory or catalogue, open each item for its phone number, email and address, and save everything, without anyone writing a script.",
    ],
    improved: [
      "**No invented phone numbers.** A phone number or an email is saved only if the bot really read it somewhere (a page, a search result, a file or your message).",
      "**Forms filled properly.** Bots see what a dropdown offers, know which boxes are ticked, and understand why a button doesn’t answer.",
      "**A long job ends with a report.** When a job can’t go further, the bot tells you where it stands, what it tried and what is missing.",
    ],
    know: [
      "Place data comes from Overture Maps (open data built from business pages). A business can be missing or have an old number; such numbers are marked “to confirm”.",
      "A catalogue record shows that a paper exists, not what it proves. Bots read a paper before reporting its findings.",
      "Some websites refuse automated visits. oovi tells you when that happens instead of pretending.",
    ],
  }),
  "0.10.3": n("Whole lists, in one table", {
    new: [
      "**A whole list in one step.** A bot takes every item of a list on a web page (a directory, search results, a table, a map) straight into its work table: name, phone, email, link and where it was found. It can scroll to load more first.",
      "**Bots can scroll.** Pages that show more as you scroll are no longer cut at the first screen.",
    ],
    improved: [
      "**One table for the whole job.** A team given a job works in the same table as your main bot and sees what is already found.",
      "**Bots keep what they find.** A phone number found on a directory goes into the list with its source, marked “to confirm”. Bots no longer ask you to copy numbers by hand.",
    ],
    fixed: ["Two errors that could stop a team in the middle of a long job."],
  }),
  "0.10.2": n("Your assistant does what you ask", {
    new: [
      "**It does what you ask.** Ask a bot to send a message, reply to an email or post something for you, and it does it in your own browser, where you are signed in. No more “I can’t”, and no “shall I go ahead?” for something you just asked.",
      "**Your own browser (Windows).** Bots can open a page in your default browser (Chrome, Edge, Firefox, Brave, Opera…) and work there with your OK.",
      "**Bots attach files for you.** A bot can put a file into an email or an upload field on a website. Files outside Downloads/oovi always ask you first.",
      "**See what the bot is doing (Windows).** While a bot controls your computer, the screen edges glow and a large pointer moves smoothly to where it clicks.",
    ],
    improved: [
      "**Answers in the chat you are in.** When a team needs your OK, the request appears in your chat with Allow and Deny.",
      "**The main bot does the job itself.** Simple requests are no longer passed to a team. When a team is needed, it gets your own words.",
    ],
    fixed: ["oovi can no longer “learn” that you don’t want it to use your computer or browser. Lessons of that kind saved before are removed."],
  }),
  "0.10.1": n("Linux, and computer control from full screen", {
    new: [
      "**Linux.** oovi is also available for Linux (Ubuntu, Debian, Mint and others) from the download page.",
      "**Bots can open an app for you (Windows).** Ask a bot to work in Excel or another installed app and it starts it after you approve a card. Terminals, system tools and password managers are never opened.",
    ],
    improved: [
      "**Computer control from a full-screen oovi (Windows).** oovi moves out of the way so the bot sees your desktop, not a black screen, and comes back when the task ends or when the bot needs your OK.",
      "**Honest about what they can do.** Bots no longer say “I can’t” for things they can do, they use the browser for websites like ChatGPT, and they tell you when an image is designed from a free photo instead of generated.",
      "**Learning that matters.** oovi remembers only what is about your work: what you asked for, where your things are, how you want a job done. Technical details no longer fill the “Learned” card.",
      "**Fewer repeated checks.** After you solve a website’s “are you human?” check, the bot continues on the page instead of asking you again and again.",
    ],
    know: ["“Send crash reports” now also covers short notes about a problem with one of oovi’s tools (which tool, on which website), never your chats, files or keys. You can turn it off in Settings."],
  }),
  "0.10.0": n("Big jobs, finished", {
    new: [
      "**Big jobs, finished.** Ask for something heavy (“find me 100 prospects with phone numbers”, a long study, a big document) and your team keeps working until the goal is reached, without stopping to ask “shall I continue?”.",
      "**Teammates work at the same time.** When the leader hands out parts, the teammates work on them together, so team jobs finish much sooner. If two of them need your OK, you get one question at a time.",
      "**You decide what oovi remembers.** Each line of the green “Learned” card has Correct and Forget.",
      "**Every file on Telegram.** Exports, downloads and files from routines are also sent to your Telegram chat.",
    ],
    improved: [
      "**Short messages, long work.** Lists and long texts go into shared work files that every bot on the team adds to. Nothing is listed twice, the team always knows the count, and you get the result as a real Excel, Word or PDF file.",
      "**Better at finding contacts.** Bots read the phone numbers, emails and addresses that websites keep in buttons and side panels, and they open pages themselves instead of asking you to check them.",
      "**No duplicate lessons.** oovi updates what it already knows instead of saving the same thing twice.",
    ],
  }),
  "0.9.0": n("Teams that work better together", {
    new: ["**Routines in your words.** Ask any bot “every day at 10, tell me good morning”, in Darija, Arabic, French or English, and it sets up the routine for you."],
    improved: [
      "**Teams work better together.** When you give a group a job, your main bot sees everything the members said, not just the last message, so links and figures are never lost.",
      "**Less chatter.** Bots no longer pass the turn back and forth just to agree or say thanks, and their messages are shorter: the answer first, then only what is new.",
      "**Slow pages aren’t broken pages.** Bots wait for slow websites and dashboards to load, and don’t conclude a site is down just because it was slow.",
      "**Your language, everywhere.** Group reports and Telegram notices follow your app language, and your main bot talks to your groups in the language you write in.",
    ],
    fixed: ["oovi no longer opens a hidden command window when you visit the Marketplace, which some antivirus programs flagged."],
  }),
  "0.8.9": n(null, {
    improved: [
      "**Updates and “What’s new” in one place.** Both now come straight from the oovi website.",
      "**A sharper icon.** In the Microsoft Store version, the oovi icon fills its space in the Windows taskbar, Start menu and title bar.",
    ],
  }),
  "0.8.8": n("A real team", {
    new: [
      "**A real team.** Oovi, your main bot, answers simple things itself. For bigger jobs it checks the team and gives each part to the best teammate. If nobody fits, it suggests a new specialist: you see its face, its job and why it is needed, then click Create or Not now.",
      "**A new Home screen.** Type what you need, or pick one of the ideas. Sign-in opens on “Create account” on a new computer and has a language picker, and the last setup step offers to connect your phone (Telegram).",
      "**Pictures and charts.** Bots can design images (posts, posters, quote cards and simple infographics, Arabic included), add native charts to Excel and PowerPoint, and add free photos to slides with their credits.",
      "**See what things cost.** The credits panel says how many tasks your credits are enough for, and a team task shows its total cost.",
    ],
    improved: [
      "**Fewer bots in the way.** Specialists made this way work in their group but stay out of your bots list. “Show hidden bots” brings them back, and any bot can be hidden from its settings.",
      "**Answers in your language.** oovi replies in the language of your last message, even if you switch between French, English and Arabic.",
      "**Better Arabic.** Every line in a chat is laid out right-to-left on its own, list numbers sit on the right, headings look like headings, and chat previews show the start of the message.",
      "**Your files stay private.** Bots ask before looking through a folder on your computer, unless you allowed that folder.",
      "**Routines** tell you when Telegram isn’t connected instead of promising to send there.",
    ],
  }),
  "0.8.7": n("Faster and lighter", {
    improved: [
      "**Opens about 3 times faster.** oovi shows its window right away and is ready in about 2 seconds (it took about 6 before).",
      "**Much smaller.** The download is about 30% smaller and oovi takes about half the disk space, so installing and updating is quicker.",
      "**Safer updates.** Updates still download by themselves, but they are installed only when you click “Restart now”. oovi no longer installs an update in the background when you close it or shut down your computer. On Windows a small progress window shows the update and oovi opens again by itself.",
      "**A new look.** The real oovi logo on the sign-in screen.",
    ],
    know: [
      "Updating from 0.7.0 to this version still works the old way: after “Restart now”, wait a minute before opening oovi again.",
      "If you installed oovi “for all users” (in Program Files), install this version from the website once.",
    ],
  }),
  "0.8.6": n("Telegram groups and paid plans", {
    new: [
      "**Telegram groups for your teams (optional).** Link a Telegram chat, such as a Telegram group, to one of your oovi groups: add your bot to the Telegram group, open Settings › Telegram › Advanced, and one click links it. Messages there go to that oovi group and its leader answers in the same chat. Files and approvals come back to the same chat, and in a Telegram group only you can answer approvals. In a group, the bot answers when you mention it, reply to it, or use /ask, /yes or /no. Advanced is closed by default, so the simple setup stays as before.",
      "**Paid plans.** Starter, Pro and Advanced are available on [the pricing page](/pricing), with theOovi credits added every month. You can manage or cancel your plan from your account page.",
    ],
  }),
  "0.8.5": n("Attach files, and your files with your OK", {
    new: [
      "**Attach files.** Use the paperclip, drag files onto the chat, or paste a screenshot. Bots see images and read PDF, Word, Excel, PowerPoint, text and code. They can read any part of a long file and make edited copies (“fix the typos in this Word file”, “add a total column to this sheet”). Your original is never changed.",
      "**Your files, with your OK.** Bots can find, read and send you files from your computer (Desktop, Documents, Downloads, Pictures…), also from Telegram when you are away: “send me last month’s report”. They ask first: Allow once, Always allow this folder, or Deny. You choose how it works in Settings › Safety. System folders, passwords and keys are always off limits.",
      "**Connectors that just work.** After connecting Zapier or any other connector, a short guide shows what to set up, tests the connection and lets you pick which bots use it. New connectors work for your Chief right away.",
      "**Memory and soul.** A new Settings tab to edit what bots know about you, their lessons, each bot’s personality, and the knowledge every bot should always have.",
      "**Your Chief.** The main bot you created first is pinned at the top with a Chief title. It runs your groups and talks to you on Telegram.",
    ],
    improved: [
      "**A fresh look.** Bot faces are now flat and minimal.",
      "**Smoother updates on Windows.** oovi shows that it is updating, a small window shows the progress, and oovi reopens by itself with your shortcuts kept.",
    ],
    fixed: ["Zapier said you were signed in but its tools never loaded. oovi now moves it to Zapier’s current address: sign in to Zapier once more and it works."],
  }),
  "0.8.4": { sections: [], hidden: true },
  "0.8.3": { sections: [], hidden: true },
  "0.8.2": n("Bots that know your setup", {
    new: [
      "**Slash commands.** Type `/` in the message box: `/zapier`, `/notion`… use one of your connectors for this message, `/your-skill` uses one of your skills, `/deep` and `/effort high` are for harder tasks, and `/help` gives quick answers about oovi.",
      "**Confirm your email from the app** with one click (“Resend email”) and unlock your free credits.",
      "**“Forgot password?”** on the sign-in screen.",
    ],
    improved: [
      "**Bots that know your setup.** Every bot knows which connectors, skills and plugins you have added, which ones it can use and which belong to a teammate. Instead of saying “I can’t”, it tells you how to turn something on, or hands the task to a teammate who can do it.",
      "**Helpful suggestions, one click away.** When a connector or skill from the Marketplace would help, the bot suggests it with a button that opens it right where you need it. Questions like “how do I add a skill?” now get accurate answers about oovi itself.",
    ],
  }),
  "0.8.1": n(null, {
    improved: ["**See your team leader at a glance.** The leader of each group has a gold ring and a crown. It stands in front and bigger in every group picture, comes first in the names above the message box, and its replies show the framed face."],
    fixed: ["Usage numbers for your own API keys no longer include theOovi calls."],
  }),
  "0.8.0": n("Start free with theOovi", {
    new: [
      "**Start free with theOovi 1.1, no API key needed.** Your bots run on theOovi, the AI model included with your oovi account. New accounts get free credits to start. If you prefer your own provider, add your own API key in Settings › AI models at any time; it stays free.",
      "**Credits you can see.** Your balance sits at the bottom of the sidebar. Click it for your plan, today’s usage and when the daily safety limit resets (midnight UTC). Every reply shows how many credits it used. If credits run out, the reply tells you clearly and offers to subscribe or switch to your own key.",
      "**Send feedback** about problems or ideas straight from the app (Send feedback in the sidebar).",
    ],
    improved: [
      "**Long chats stay fast and affordable, without forgetting.** Long conversations are summarized automatically, keeping goals, decisions, numbers, files and open tasks. Bots can search the full saved history whenever they need an exact detail.",
      "**Better when things go wrong.** A clear banner when you are offline (your chats stay safe on your computer), and clear messages when you are signed out or a service is busy.",
    ],
  }),
  "0.7.0": n("Updates without losing anything", {
    new: [
      "**Updates without losing anything.** oovi tells you when a new version is out and can update itself (on Windows: one click, or automatically when you quit). Your bots, chats, keys and settings are kept.",
      "**Real files.** Bots create Word, Excel (with formulas), PowerPoint, PDF and CSV files, with Open and Show in folder buttons.",
      "**Deep research.** Bots search several sources at once, read the full pages and cite them. It works without a search key.",
      "**A cloud computer.** Give your bots their own Linux machine (with your own E2B key) to run code, analyze data and build apps: Settings › Cloud computer.",
      "**Think harder when it matters.** An effort level on every message (Auto, Low, Medium, High or Max), and a Deep work mode where the bots plan with a live checklist, work longer and check their results.",
      "**Bots that learn.** After real work, or when you correct them, bots save short lessons and your preferences and use them next time. Rate any reply with a thumbs up or down; a thumbs down with a note becomes a lesson. See and delete what they learned in Marketplace › Memory.",
      "**A Marketplace that grows.** It gets new connectors, skills and teams from oovi without an app update.",
    ],
    know: ["oovi sends anonymous daily usage counts to help us improve it (never your chats, files or keys). You can turn it off in Settings › About & privacy."],
  }),
  "0.6.0": n("Work inside a project folder", {
    new: [
      "**Project folder.** Pick a folder for any chat (the folder button at the top). Bots in that chat can read its files, create and edit files, and run commands such as `npm install` or tests. They can’t reach anything outside the folder.",
    ],
    know: [
      "Reading and searching files never asks. Creating or editing a file asks first and shows the exact content or change: Allow once, Always allow edits here, or Deny. Untick the box in the folder panel to take “always” back.",
      "Deleting files and running commands always ask. Deleted files go to oovi’s trash, so they can be recovered. Commands stop at a time limit, so a stuck one can’t hang the bot.",
      "Whole drives, your user folder, system folders and `.git` internals are off limits.",
    ],
  }),
  "0.5.0": n("Your oovi account", {
    new: [
      "**oovi account.** Sign in or create an account. Each account has its own data on your computer.",
      "**Onboarding.** Your name and photo, connect an AI model, and meet and customize your team leader.",
      "**Settings window** floating over a blurred background, with Profile, Language, Data & backup and About & privacy.",
      "**Memory.** Bots keep notes about you and your work and use them in every chat.",
      "**Web search with no setup** (it uses your Claude or Gemini key).",
      "**A model dropdown per bot,** with the provider’s real model list.",
      "**Zoom into a bot’s screen** (full screen, zoom and pan).",
      "**New slime avatars** with live statuses: online, thinking, reading, on the web, asking, done, stuck, sleeping.",
      "**6 languages:** English, Arabic (right-to-left), French, Spanish, German and Turkish.",
      "**Backup and restore,** and optional crash reports.",
    ],
    improved: ["**Lower AI cost.** Long chats are summarized automatically and repeated text is reused, so the same work costs less."],
  }),
  "0.4.1": n("The first version", {
    new: [
      "**Bots with moods and groups.** Slime avatars with moods, and groups where bots hand work to each other, with a team leader (Oovi) that plans, delegates and writes the final answer.",
      "**Skills.** Bots learn skills from repeated requests, and you can install shared `SKILL.md` skills.",
      "**Tools (MCP).** Search the official registry, use presets, give tools to individual bots, and approve every call.",
      "**Free models and automatic switching.** One-click Gemini and OpenRouter setup, and backup models.",
      "**Your accounts.** Bots can post, reply and download on sites you signed in to, asking before every click.",
    ],
    improved: ["Settings are organized into sections."],
  }),
};
