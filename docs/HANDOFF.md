# Hand-off: oovi 0.8.8 (released 2026-11-10)

## Status after the release (read this first)
- 0.8.8 is on `main`, released on GitHub (oussasz/oovi v0.8.8), copied to oussasz/oovi-downloads (website Mac buttons + in-app updates), and submitted to the Microsoft Store (in certification; the website's Windows button opens the Store).
- Website deployed to Vercel (project `oovi`, deployed from `web/`): Terms and Privacy now describe the paid plans and name Paddle as reseller / Merchant of Record (needed for Paddle's domain review).
- Paddle: checkout, webhook, credits per payment, refunds and plans (starter/pro/advanced) are live and checked with `web/scripts/test-paddle-webhook.cjs` (17 simulated signed events, local DB). Waiting on Paddle's own verification of the owner's account and domain approval (owner's dashboard).
- Releases now copy installers to the downloads repo by themselves (`.github/workflows/publish-downloads.yml`, secret DOWNLOADS_TOKEN = fine-grained token, oovi-downloads only, Contents read/write). To redo one by hand: Actions > Publish to downloads > tag.
- Cloud sessions can push code and run workflows but cannot create GitHub releases: the owner clicks Publish on a prefilled release page. The Store upload is done by the owner in Partner Center (download `oovi-Store-<version>.appx` from the release).

## 0.9.0 (2026-11-10): team conversations and sign-up protection
- From a real conversation (Chief said a teammate "didn't answer" though it had posted the link; two bots bounced agreement 5 times): group results carry every member's messages; only addressing/asking @mentions pass the turn (lib/mentions.ts handoffMentions); short-message rules; slow pages waited for (lib/tools.ts waitForContent); wrong "blank page = site down" lessons blocked (lib/lesson-rules.ts); language and Telegram identity fixes; 15 more same-type issues from an audit fixed.
- Tests: `tests/e2e/group-scenario.cjs` replays that conversation (fails 0/7 on the old code, 7/7 now). Run it with spec-scenario and phase1-scenario before every release.
- Bots know their real abilities (lib/abilities.ts, from each bot's own Web search / Browser / "Use my signed-in accounts" settings): they never claim or deny abilities wrongly, give the exact steps to turn one on (with the app's labels in the user's language), and name the user's bot or group that can do it now. The bot editor warns when the Chief has no browser. Tests: tests/unit/abilities.test.mts, group-scenario checks F.
- Team admin with the user's OK (lib/team-admin-core.ts rules, lib/team-admin.ts cards): any bot can ask to turn on an ability it lacks (request_abilities: a card with what it allows and why; its turn restarts with the new tools), and the Chief can build a team (propose_team: existing + new bots, never with signed-in accounts). The Chief sees every bot's role, abilities, groups and description (secrets hidden) to find information another bot holds. Bot editor: "Use my signed-in accounts" turns the browser on too; a "For all bots" block shows computer control and computer files with a link to Settings → Safety. Group lists are cached by revision (lib/store groupsRevision).
- Telegram (from the owner's Darija conversation): replies after /yes always arrive, one OK per folder per task, cards and notices in the user's language (lib/text-locale.ts + translatorFor), exact name, /stop, created files sent to Telegram, routines answerable with /yes, follow-up to Telegram when answered in the app. tests/e2e/telegram-scenario.cjs 7/7.
- Settings links: in-app links use components/SettingsLink.tsx (a <Link href="/settings"> landed on Home without opening the window).
- Known, not done yet: Telegram stays silent when oovi is signed out; group tasks older than 24 h can't be answered from Telegram; Marketplace connector descriptions, model/provider error texts and /help are English only.
- Website sign-up: Vercel BotID on the form (instrumentation-client.ts + app/api/auth/[...all]/route.ts), per-network limits in the database (lib/signup-guard.ts: 5/hour, 15/day), throwaway email services refused.

---

# Earlier hand-off: oovi next version (branch `next-version`)

Written 2026-11-10 by the Claude Code session that did this work on the owner's Windows PC, for the session that continues it. Read this first; it is self-contained.

## Not released yet (2026-11-11): heavy team work, learning card, Telegram files
Owner's words: "I want a real team that does heavy, dirty work and doesn't stop until it reaches the goal", no credit ceiling ("if the task is big, the user assumes"), chat messages stay short and the work goes into files, nothing may depend on a bot's role.
- **Big jobs** (`start_big_job`, `lib/orchestrator.ts`): the bot that answers the user decides a task is big. Hand-off and step limits are lifted; the owner of the job is sent back until the goal is reached (a row count in a work table when there is one); the job closes itself after 2 rounds that add nothing (`JOB_STALE`). One turn may take 400 model calls (`JOB_STEPS`, a loop guard).
- **Work files** (`lib/workfiles.ts`, `lib/workfiles-core.ts`): per chat, `work_table` (rows merged by name or phone), `work_notes`, `work_export` (Excel/CSV/Word/PDF/Markdown without retyping). Stored in `<data>/work/<chatId>.json`.
- **Reader** (`lib/contacts.ts`, `lib/reader.ts`): phones, emails, WhatsApp, addresses from tel: links, buttons, footers, JSON-LD. Checked on real pages (DzAdvisor, Glammy) that bots had reported as "no number".
- **Learning** (`lib/learning.ts`): the review sees saved lessons and the profile and returns `{text, replaces}`; the Learned card has Correct / Forget per line (`POST /api/chats/[id]/learn` with `change`).
- **Telegram**: every file a tool returns is sent (exports, downloads, copies, cloud-computer files), and a routine's files too.
- Tests: `tests/e2e/bigjob-scenario.cjs` (23 checks), `tests/e2e/telegram-scenario.cjs` (8), unit `contacts`, `workfiles`.
- **Not done**: teammates still work one after another, not at the same time (two bots asking for the user's OK at once needs a safe design first). The owner's Telegram file failure wasn't reproduced: ask what was requested when it failed.

## The product in two lines
oovi is a closed-source Electron 44 + Next.js 15 desktop AI assistant (this repo; the accounts website and theOovi model proxy live in `web/`, deployed to Vercel at oovi.conuron.com). Users create bots with roles, put them in groups led by a leader, talk to a main bot (the "Chief") in the app or from Telegram; the default model is theOovi (Claude Haiku via the proxy, on credits).

## Where things stand
- `main` (pushed, = 681349a): routines, live browser panel, editable plans (plan mode), desktop control (Windows beta, security-reviewed), and "Phase 1" reliability: group tasks saved to disk (`lib/delegations*.ts`), a Telegram outbox with retries, approvals answerable from Telegram (incl. plain yes/no words in Arabic/French), retries for brief theOovi errors, chats saved mid-run and repaired after a crash.
- `next-version` (this branch): everything below, NOT yet merged, released or deployed.
- Released app: 0.8.7. The next release would be 0.8.8.

## What this branch adds (owner's words: "Fix and improve everything... they must be addressed in the next version")
From a first-time-user test (6 personas, real model) and the owner's requests:

1. Collaborative team, specialists, hidden bots (owner's request)
   - Leader prompt (`LEADER` in `lib/orchestrator.ts`): simple things alone; anything bigger: check the team first, give each part to the best-fitting teammate, propose a missing specialist before starting.
   - New `propose_specialist` tool (`lib/specialists.ts`), offered to group leaders and the Chief (not in routine runs). It always shows a card (face, name, role, why, instructions) with **Create** / **Not now** (`components/ChatView.tsx`, `.specialist-card` in `app/globals.css`). On Create the bot is made with the card's face, joins the running group (so the leader can @mention it in the same run) and is hidden from the bots list. From the Chief's direct chat it joins the group the Chief leads (or one named). Duplicate roles or names are refused without asking the user.
   - `Bot.hidden` (`lib/types.ts`, kept by `validateBot` in `lib/store.ts`): hidden bots are left out of the sidebar and Home lists ("Show hidden bots (n)" toggle) but keep working in their groups; a "Hide from the bots list" switch in the bot editor.
2. Replies in the language of the current message (`LANGUAGE` line in the system prompt); memory and self-learning no longer store guesses like "Writes in French" (`lib/learning.ts`); correction detection understands French and Arabic (incl. Darija).
3. Arabic layout: chat bubbles use `unicode-bidi: plaintext` so every line gets its own direction (punctuation and list numbers on the right side); markdown `##` headings render bold instead of showing `#`.
4. File privacy: listing a folder or searching file names on the computer now asks first unless the folder is allowed; once folders are allowed, searches stay inside them (`lib/computer.ts`).
5. Task-first Home (`components/Home.tsx`): a message box to the Chief with 4 example tasks; hidden bots filtered.
6. Sign-in and onboarding (`components/AccountGate.tsx`): opens on "Create account" on a computer where nobody signed in before; one "Forgot password?"; language picker (saved to the account after sign-in); busy labels on buttons; the last step says to talk to the Chief and offers "Connect my phone (Telegram)"; the Chief's empty chat shows a friendly intro instead of its internal instructions.
7. Cost visibility: credits panel shows "enough for about N quick tasks or M team tasks" and a pricing link (`components/Credits.tsx`); a hand-off shows "≈ n more credits"; team tasks show their total under the last message.
8. Routines: the card and the bot say when Telegram isn't connected instead of promising delivery (`lib/routines-tools.ts`).
9. Documents and images (`lib/files.ts`, new `lib/charts.ts`, `lib/card.ts`, `lib/media.ts`, `lib/render.ts`): native editable Excel charts; native charts and pictures in PowerPoint (free photos from Openverse/Wikimedia Commons with credits, better design, Arabic RTL); new `create_image` tool that renders designed PNGs (post, poster, quote, infographic; Arabic shaping) with the local Chrome/Edge, network blocked; optional AI photo with the user's own OpenAI/Gemini key. `read_document` accepts `Downloads/oovi/x` paths (the leader couldn't find teammates' files before and rebuilt them).
10. Small: one file card per file (no duplicate "Created"/"Sent you").
11. Translations: 28 new keys in all six languages (`lib/i18n/*.ts`); English fallback exists for any missing key.

## Verified
- `npx tsc --noEmit` passes.
- Unit tests: `cd tests/unit && node --test` (48 pure tests: delegations, Telegram yes/no words, charts/cards/media, desktop-core, proxy tools). 16 more tests that need a compiled build were run locally and pass.
- End-to-end with stand-in servers (no network): `tests/e2e/phase1-scenario.cjs` (Telegram delivery: approval answered with "نعم", a >2-minute job with failed sends, kill + restart) passed 11/11 before this branch's changes. `tests/e2e/spec-scenario.cjs` (specialist flow: card, Create, hidden, joins group, same-run hand-off, duplicate refused, Not now, from the Chief's chat) was written for this branch; its first run was still going when this hand-off was written. Both need `npm run build` first (they start `.next/standalone/server.js` via `tests/e2e/server.cjs`; stand-ins use ports 3399/3398, servers 3301/3303).
- Sample documents were checked by unzipping (no Office installed): open one .xlsx with charts and one .pptx in real Excel/PowerPoint.

## Done in the cloud session (2026-11-10, Linux)
- `npm run build` passes; `spec-scenario.cjs` 14/14, `phase1-scenario.cjs` 11/11, unit tests 48/48.
- Screens checked in a browser, light and dark, with a local stand-in for the website (no real account): sign-in (opens on Create account, language picker), onboarding last step (talk to the Chief + Connect my phone), Home message box and ideas, hidden bots toggle, specialist card (Create / Not now), Arabic reply (lines right-to-left, list numbers on the right, bold heading), credits panel (estimate + pricing link), "Whole task: n credits (2 bots)".
- Fixed: Arabic chat previews in the sidebar and Home tiles showed the end of the message instead of the start (`dir="auto"`).
- Security re-read: `create_image` paths stay in the project folder or Downloads/oovi; `renderHtml` blocks every request except data:/about:; card text is escaped and colors are hex-checked; specialists get web search only (no browser, accounts or MCP) and Create reuses the exact card the user saw. Nothing to change.
- Tip: `tests/e2e/server.cjs` with `OOVI_TEST_DATA=... OOVI_CLOUD_URL=<local stand-in>` gives a signed-in app without a real account (without the stand-in, the page's session check reaches the real website, gets 401 and signs out).

## What's left (in order)
1. (done) build + both e2e scenarios.
2. (done) screens.
3. A short real-model check (it costs credits; keep it to a few messages): the leader delegates a bigger task and proposes a specialist when one is missing; an English message after French ones is answered in English.
4. Review the diff once more (security: `create_image` paths, `render.ts` network blocking, specialist creation), then commit, merge to `main` only with the owner's OK.
5. Not built (need the owner's accounts/decisions): local payment in Algeria (Edahabia/CIB via a gateway such as Chargily or SATIM; needs a merchant account), WhatsApp access (needs a Meta WhatsApp Business account and a public webhook, e.g. via the website), true AI image generation on theOovi (server cost decision).
6. Still pending from before: deploy the website (`cd web && npx vercel@latest --prod --yes`; it was blocked by a permission check on the PC, the owner can run it), live test on the owner's PC (Telegram groups, desktop control), then version 0.8.8 and the release (Microsoft Store + downloads repo) only with the owner's go-ahead.

## Rules the owner set (keep them)
- Verify, never assume: never state as fact anything about the owner's app, data or settings without checking it; say what is verified, seen or assumed; review every change as if it ships to millions of users (full rules in `CLAUDE.md`).
- Confirm before anything outward or hard to undo: pushing to `main`, deploying, publishing, store submissions, sending messages.
- Never ask the owner to paste passwords or keys into chat; never enter passwords or create accounts; test with stand-ins or a fresh data folder instead.
- Write for people: plain words, short; Arabic (incl. Algerian Darija), French and English users.
- "We win in the harness, not in the model": no automatic switch to a bigger model to fix quality; cost matters.
