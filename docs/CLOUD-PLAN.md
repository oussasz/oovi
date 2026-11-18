# oovi in the cloud: plan (written 2026-11-18, nothing built yet)

Goal (owner): a phone app, everything in step between computer and phone (chats, keys, connectors), simple tasks
and routines that run while the computer is off. Tasks that need the computer or the bots' browser say "please
turn on your computer" and wait.

## Where we start (read in the code)
- Setup sync exists since 0.12 (`lib/setup-sync.ts`, `web/lib/account-setup.ts`, table `account_setup`): bots, groups,
  skills, routines, connectors WITHOUT keys, a few settings, the main bot, memory and lessons follow the account,
  every 4 minutes, for every signed-in account. No on/off switch was found.
- Not synced today: chats (`accounts/<id>/chats/*.json`), API keys (`settings.json`, encrypted with a key that
  lives on that computer), connector sign-ins (`mcp.json`, encrypted the same way), files.
- The privacy page says: "your chats, files and API keys are saved on your computer". This changes.

## The owner's decisions (asked 2026-11-18)
1. Cloud sync is optional: a switch in Settings, a question in the first-run screens, and ONE question after the
   update for people who already use oovi (Turn on / Stay local).
2. "Local only" concerns chats, keys and connector sign-ins. The existing setup sync stays as it is.
3. Each bot has a choice: on this computer only, or in the cloud. When sync is turned on, every bot is "cloud";
   the user moves the ones they want to "local" (their chats never leave the computer, they don't show on the phone).
4. Keys and connector sign-ins: encrypted, and oovi's server CAN use them, so tasks work with the computer off.
5. The admin console never shows chat content. It shows who syncs, how many chats, how much space, last sync.
6. For everyone (free and paid).
7. Text first; attached and generated files later.
8. Old chats are uploaded when sync is turned on. Turning it off asks, then deletes the server copy at once
   (the computer keeps its own).

## Honest consequences of these decisions
- Decision 4 means oovi's server holds what is needed to read the keys and the chats. "The admin never reads
  chats" is then a rule of the product (no screen, no tool, audit log), not a mathematical guarantee. The privacy
  page must say exactly that.
- oovi becomes the keeper of people's API keys and of their sign-ins to Gmail, Notion and the others. A leak
  would expose them. This needs: encryption with a key kept outside the database, access limited to the task
  runner, a way to revoke everything for one account, and a lawyer's read of the new privacy page and terms.
- "For everyone" has a monthly cost that is not known yet. A size limit per account is needed against abuse
  (number to be chosen by the owner after measuring real chat sizes).

## Stages (each one is released alone and is useful alone)
**1A. Chats in step (text).** App + website.
- Website: a table of chats per account (one row per chat, compressed and encrypted like `account_setup`, with a
  version so two devices can't overwrite each other), `GET/PUT /api/v1/chats`, deletion with the account and
  when sync is turned off, size limit.
- App: the switch (Settings > Sync), the first-run question, the one-time question after the update, the
  per-bot choice (Edit bot), upload of old chats in the background, merge of messages by their id.
- Admin > Users: "Syncs" yes/no, chats, size, last sync; a count on the overview. Never content.
- Privacy page and terms rewritten; in-app text that says plainly what is uploaded.
- Not yet: files (the phone shows the file's name and "on your computer").

**1B. Keys and connector sign-ins in step.**
- Keys re-encrypted for the account (today they can only be read on the computer that saved them).
- To check connector by connector BEFORE promising it: whether a sign-in made on the computer can be refreshed
  from the server (each service decides; not verified).

**2. The phone.** A web app that installs on the home screen (no store at first): read and write chats.
While the computer is on, it does the work; the phone shows it live.

**3. Tasks with the computer off.** A runner on a server: chat, web search, reading pages, routines, connectors.
A task that needs the computer, its files or the bots' browser is queued; the bot says "please turn on your
computer"; the desktop app picks it up when it opens. Tried first on the Azure student credit (about $43, ends
early February 2027: delete the whole resource group after each trial), then moved to a lasting server.

**4. Files in step**, with a size limit.

## Still to decide (owner)
- A group that mixes "local" and "cloud" bots: is its chat synced?
- The size limit per account.
- Whether tasks with the computer off use only theOovi credits at first, or the user's own key too (stage 1B first).
