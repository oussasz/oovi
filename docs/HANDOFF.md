## Cloud server (the Azure runner) and the phone: checked and fixed (2026-11-20, `harness-v2`; WEBSITE DEPLOYED, runner image and desktop app NOT)
The owner: "the phone app says the computer must be on even for simple messages: what is the VPS for? Check it,
audit it against best practice, make sure it syncs right."

**Checked live (signed in as the owner, built-in browser):** the runner is up; a phone-style message ("7 x 8", computer
off) was answered "56" by the cloud in about 15 s, job `done`, 4.69 credits; the morning routine ran in the cloud the
same day with two connectors. The VM itself can't be inspected from the Linux machine (no Azure CLI, no SSH): what
follows is from the code, the live API and tests.

**Why the phone said "computer":** (verified in code) while a message waited, the phone showed "Your computer is off.
Your message waits until it's picked up" (web/app/m/_lib/core.ts `chatBlocker`), with no idea the server existed, and
an idle runner looked for work only every 30 s (plus a 5 s wait): 7 to 35 s under that banner. The empty chat said
"While your computer is on, oovi on it does the work". Not reproduced: a refusal of a simple request by the released
engine (0.14.1 in cloud mode: 7 of 7 computer-off scenarios right). Found on `harness-v2` before this fix: a list
built on the server ended "this needs your computer" at `read_rows` (6 of 7).

**Changed (all with tests; contract in docs/CLOUD-BUILD.md, "Since 2026-11-20"):**
- Phone: `server: {online, lastSeen}` in `/status`; "oovi's cloud server is taking your message" (or, if neither
  answers, that plainly); a message whose job failed shows "Not sent. Tap to try again" instead of hanging; a reply
  the server couldn't finish shows as an error (`cloud_failed`), not as a bot at work for ever.
- Speed: runner waits 2 s (was 5), idle look every 5 s at most (was up to 30).
- Engine on the server: only tools that run there are offered, plus `hand_to_computer`; a request is left for the
  computer whole and first, or not at all (`handOver`): no second email when the computer runs it again. `read_rows`
  on a work table runs there. The routine confirmation no longer says "only while oovi is open on this computer".
- Stop from the phone reaches a job running on the server (it never did: the runner asks for no new job while busy).
- A final save the website refuses no longer ends as `done`; a chat deleted mid-job is not saved back; a routine whose
  run died keeps its next time; a job that kills its runner is given up after 3 tries (`attempts`).
- Security: the runner's key opens an account only while a runner holds a live job of it (`runnerFor`); page reads
  check DNS answers and each redirect before asking (lib/net-guard-core.ts), on the server and on computers.
- Operations: Admin > Overview "Cloud server: Up/Down, waiting, failed in the last day"; a job's memory fits the
  container (600 MB on the 800 MB server, was 768); a runner whose claim loop is stuck exits so Docker restarts it.

**Measured (real model, computer off, 7 scenarios, tests/evals/run.cjs `cloud-*`):** released 0.14.1: 7/7, 14.9
credits. `harness-v2` before this fix: 6/7, 7.9. After: 7/7, 5.6 (cold first call 0.96 credits against 2.72).
Scripted: unit 533, runner scenario A to G, website cloud test 150/150 on a real PostgreSQL, website + app + runner
together (cloud-integration), cloud-sync 40/40, sync 15/15, phone scenario 185/185.

**To test the cloud parts on this machine:** a throwaway PostgreSQL lives in `/home/oussasz/dev online/oovi/lab/pg`
(`node start.mjs`, port 55432, user/password postgres); `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/oovi_test`.
The phone scenario needs `NODE_PATH=/home/oussasz/dev online/oovi/lab/pw-shim/node_modules` (playwright-core + Brave).

**Website deployed (2026-11-20 22:35 UTC, owner: "انشر الموقع"):** production is `harness-v2` at 0b80bfd (Vercel
deployment dpl_A4iPDUi8LhkWgwM2bzmJgoKLgmX5; the one before, 0.14.1 from `main`, is dpl_2JQjEwhxzAKUdV5huxKgPLkKvE6r and
can be rolled back to). Deployed from GitHub through the Vercel connector, not the CLI: `create_deployment` with
`gitSource {type: github, org: oussasz, repo: oovi, ref, sha}`, `projectSettings {rootDirectory: "web", framework:
"nextjs"}`, `target: "production"` (a preview first, without `target`, to see the build pass). Not checked: whether
that left "web" as the project's root folder for later CLI deploys from `web/`. Checked live after it: `/status` has
`server {online: true}` (the old runner's claims filled `cloud_runner`: the tables migrated themselves); a phone-style
message with the computer off was answered by the old runner ("54", job `done`, 4.71 credits), so the key's new
scope doesn't lock the live runner out; the phone bundle carries the new wording and not the old sentence; Admin >
Overview shows "Cloud server: Up"; no runtime errors in the hour after. Still slow until the runner image is
rebuilt: the old runner took that message about 35 s after it was sent (its 30 s idle look). The Windows, Mac and
Linux run on 0b80bfd passed (Actions run 44826736090).

**Still to deploy (each needs the owner's yes):** 1) website: done, above; 2) runner image from `harness-v2` (built where Docker and the Azure CLI are:
not this machine), better once through the "Runner image" workflow to ghcr.io with `RUNNER_IMAGE` switched on the
VM, so the 6-hour update works from then on; 3) the desktop release.

**Not done:**
- A leaked runner key can still claim waiting jobs and so reach those accounts: per-job tokens and an allow-list of
  the VM's address would close it.
- A job re-run after a crash (lease ran out) starts its message over: connector writes done before the crash can
  repeat (now at most 3 tries). Needs a synced ledger of outward actions per job.
- Sign-in refresh written back only at job end (a crash loses a rotated token); vault sealing has one key with no key
  id or rotation; rate limits are per server instance; "newer wins" for chat-level fields uses device clocks.
- One server, one job at a time, first come first served: a long job of one account makes the others wait (up to the
  15-minute limit). No alert is sent when the server is down (the admin card shows it).
- Files don't travel: making or reading documents from the phone waits for the computer.
- The update path of the VM (above) and anything on the VM itself: not reachable from here.

## Harness v2, second part: every kind of task, and the price of a cold start (2026-11-20, `harness-v2`, NOT RELEASED, not pushed)
Owner: check that the fix is a root one, for every kind of task and not only email; cut the 3.4 credits every new
conversation starts with; look at four competitors and take what they do better; everything on the real model.
- **Evals for work that needs no connector** (`tests/evals/run.cjs`, 12 new scenarios, 17 in all): a plain question,
  counting per group in a 1,001-line workbook, a part of it delivered as Excel, a chart, an edited workbook, a
  summary of a Word report, an offer as a Word file, a budget as Excel, a five-slide deck, research with sources, a
  list from public data, a routine. Each is graded on the deliverable itself (the file is opened and its numbers,
  rows, slides and words checked). First run on part one's build: 10 of 12 right; research answered from memory
  without searching, counting per group took 5 calls and 7.4 credits, a part of a workbook was retyped row by row
  (4 credits), a list of 10 came back as 30.
- **Fixed from that**: `read_rows` counts and sums per group (`group_by`, `values`; `lib/table-core.ts summarize`) and
  copies a part of a table into a work table exactly (`save_to_table`, `putTable`), so a file made from a workbook
  never passes through the model. The contract says to look things up when asked to search, to deliver what was
  asked in the form asked, to ask which one when a name fits several, and "all" only when every item was checked.
  A declined card: "don't do it, or anything equivalent, by another way".
- **The fixed part of every request, from about 61,000 characters to about 28,000** (22,000 tokens to about 11,000 for a
  bot with no connector):
  - 27 long tools go in one line each inside `use_tool` and are called in ONE step (`DIRECT` in `lib/tool-defer.ts`): the
    line names their parameters, and the first result brings the tool's full guide in front of it
    (`withFirstGuide`), so nothing is paid to learn it. A tool whose first call is the deliverable (a deck, a
    designed image, a workbook with charts) still gets its guide first (`DEFERRED`).
  - Guidance about the browser, the work files, routines and images left the instructions and comes with the
    first result of those tools (`guideExtra` in `lib/orchestrator.ts`). A guide in front of a result is never cut
    when old results are shortened.
  - The instructions are two blocks (`SYSTEM_SPLIT` in `lib/llm.ts`): the rules, word for word the same for every bot
    with the same abilities whoever the user is, then the bot's own part (who it is, the user's name, memory, team,
    this chat's files and mode). With the tool list the same in every conversation (attachment and row tools are
    always offered), another chat, another bot or another user reads the first block from the cache: a first
    message with a file went from 14,300 tokens written to 9,900 read and 2,900 written.
  - `tests/e2e/cost-scenario.cjs`: 170,000 weighted tokens to 138,000; the limit is now 145,000, and the fixed part must
    stay under 40,000 characters.
- **One-hour cache, prepared and OFF** (`OOVI_CACHE_1H=1` on the website; `web/lib/ai-tools.ts`, `web/lib/credits.ts`
  bills one-hour writes at twice the input price; the app marks the tools and the shared rules for an hour when the
  status says `cache1h`). NOT tried against the provider: the gateway strips the mark until the site is deployed with
  the switch on. Try it on a quiet day and watch /admin/ai.
- **A file is not made a third time in one turn** (`remadeRefusal`, `lib/loop-guard-core.ts`): a deck was made four
  times in a row, 17 credits. A file a bot made is the user's and in the chat: not sent again, changed under the
  same name (both came back as regressions when the old paragraphs moved, caught by the evals).
- **The scripted scenarios** read a request as the real model does after `use_tool` (`tests/e2e/all-tools.cjs asModel`).
- **Competitors read in code** (dusk bot, Rakazo, OpenMausBot, OpenBot; the last one's server is NOT in its repo,
  so what `COMPETITORS-2026-11.md` says about its tool search, approvals and evals is unverified). Taken: counting
  and adding up in the table tool, a stable shared prefix with the volatile parts after it, guidance chosen by use
  instead of sent always, the decline wording, the ambiguous-name rule, "all only if checked". None of them hides
  tools for free (dusk measured no saving, Rakazo pays a round trip): oovi's one-step list does. Not taken yet:
  local SQL on files (DuckDB) and charts from a query, dated memory with expiry and per-message recall, observed
  evidence and `doneWhen` in the done-check, prompt probes, parallel read-only calls, a cold-cache trim of old turns.
Measured on the real model (`../lab/gen-1` = part one's build, `../lab/gen-7` = this one; one run each):
| | part one's build | now |
|---|---|---|
| the 12 tasks without a connector | 10 of 12 right, 35.9 credits | 12 of 12 deliverables right (the deck took one call more than its limit), 19.4 credits |
| the 5 connector scenarios | all right, 20.3 credits | all right, 10.2 credits |
| "what is 15% of 2400?", nothing cached | 2.72 credits (22,000 tokens written) | 1.46 credits (11,700 tokens written) |
| the same, when oovi was used in the last 5 minutes (any chat) | 2.72 | 0.15 (11,570 of 11,755 tokens read from the cache) |
| a first message with a 1,001-line workbook | 3.28 | 0.49 |
| counting per group in that workbook | 5 calls, 7.4 credits | 3 calls, 1.5 credits |
| a part of it as an Excel file | 4 calls, 7.0 credits, rows retyped by the model | 4 calls, 2.0 credits, rows copied by oovi |
| the 34-step research job of `cost-scenario.cjs` (scripted) | 170,092 weighted tokens | 138,847 |
519 unit tests, the 17 scripted scenarios and `tsc` pass on the last build.
Not done: the one-hour cache is untested (needs a site deploy); memory is still inside the bot's own block (a memory
write rewrites it and the conversation after it); the done-check can still send a finished job back (a deck with
6 slides for 5 asked: right, but 12 credits); research sometimes adds a well-known link it did not read; the
evals run each scenario once or twice (a direction, not statistics); no real-Zapier check; nothing pushed.

## Harness v2: act first, data stays data (2026-11-20, branch `harness-v2`, NOT RELEASED, not pushed)
Owner's report (a Windows user, 0.14.1): "send an email to everyone in the list" with a 1,001-line workbook cost about
540 credits over 9 replies and sent nothing: questions, a plan, a lecture on the law, a refusal, three invented
addresses, the connect link twice. Owner: no patching, a root fix, a report first (`../تقرير-الهارنس-2026-11-20.md`),
tested on the real model.
- **Reproduced on the real model first** (hosted, claude-haiku-5-5; stand-in Zapier, nothing sent): 0.14.1 spent 55.2
  credits in 14 calls and sent nothing. The same model with a short action-first prompt, a file digest and a batch tool
  acted at once 3/3 for under 1 credit; today's prompt with the same tools: 0/3; today's harness plus a batch tool: 0/3.
  So the instructions themselves made the bot ask, and the tools made the job impossible.
- **Tables stay data** (`lib/table-core.ts`, `lib/rows.ts`): a long Excel/CSV attachment is in the conversation as a
  digest (size, columns with fill counts and short value lists, 3 rows), never as text (was 40,000 characters, then
  30,000-character reads cut to 800). `read_rows` looks at chosen rows (structured filters). `read_attachment` on a long
  table returns the digest.
- **One action per row, run by oovi** (`for_each_row`, `lib/batch-core.ts`): the bot gives a connector tool and its
  input once with {Column} placeholders; oovi fills it from the file for every row (an address that isn't in the file
  can't be sent to), skips empty values and repeats, shows ONE card (count, the bot's note, three filled-in examples),
  runs every row through the normal tool path with no model call in between, keeps a ledger (`chats/<id>/batches.jsonl`,
  hashes only) so a row is never done twice, and stops after 5 failures in a row (a daily limit): the same call again
  finishes the batch. A batch always shows its card, in Auto mode and for a trusted connector too.
- **The contract** (`HOW_YOU_WORK` in `lib/orchestrator.ts`) replaces FOR_THE_USER, the old SAFETY block and the plan
  forced before any action (ACT_PLAN now only covers several steps with the mouse/keyboard or the signed-in browser):
  act when you can; the card is the user's consent, also for what can't be undone; the user's words set the scope; a
  concern is one line beside the action; data is never rebuilt from memory; the latest message is the task.
- **Connectors**: `connect_app` (`lib/connect.ts`): one card, the connection page opens in the user's browser, oovi
  polls the service until the connection changes and the bot goes on in the same turn (no link in the chat, no
  "tell me when it's done"). Zapier's state (apps on, account connected) is asked by oovi at each user message and
  given with it (`zapierNow`). Connector tools on demand are called in one step (`use_tool` lists their parameters;
  the guide comes only with an error): it was 8 of the 14 model calls behind one email. Searching an app and turning
  its actions on no longer ask (`lib/action-kind-core.ts`): the action itself has its card.
- **Money**: request sizes are measured, not guessed (`lib/budget-core.ts`: the service's own token count calibrates
  each chat; 3 characters a token was 2.12 with Arabic and tables, so calls went over 100,000 tokens, five times the
  price). The tool list is fixed for the turn (it changed with the budget and rewrote 27,000 cached tokens). A tool's
  guide is never cut by the budget guard.
- **Memory**: the summary is background ("Past requests" with how each ended, "Still waiting" at most 3 lines; no more
  "Open items" kept forever) and says so where the bot reads it. A job that stopped is taken up again only by a short
  go-on message (`lib/resume-core.ts`), not by any message within 24 hours.
- **Cards that settle things**: a batch whose filter leaves rows out says so on its card ("163 rows are left out by the
  filter (Statut ≠ Refusé)") and, when the card holds that one batch, offers "All N, nothing left out" (the bot's filter
  is dropped; `Approval.batchAll`, refused by the server for a card with several batches: found by the evals, where it
  sent two different texts to everyone). The bot's own doubt goes in the batch's `note`, shown on the card. An address
  that appears nowhere (the user's messages and files, what was read, memory) always shows its card with a warning
  and no "allow for this chat", in Auto mode too (`lib/recipients-core.ts`); the user's attached files count as read.
- **Evals on the real model** (`tests/evals/run.cjs`, results in its output folder): graded on what happened (who got
  the email, cards, questions, model calls, credits), with the owner's session behind a proxy that lets only model
  calls through and a stand-in Zapier (nothing is sent). Scenarios: bulk-all, bulk-all-refused, bulk-filter,
  old-topics (a seeded history with an old "Open items" summary and an unfinished job), single-connect.
  `EVAL_SERVER=<another build's .next/standalone>` runs them against another build (how 0.14.1 was measured).
  The scripted e2e scenarios stay for the plumbing; the ones that matched prompt wording were updated.
Measured on the real model with the same scripted user (2026-11-20; `../lab/evals-final3*` and `../lab/evals-0141*`):
| scenario | 0.14.1 | harness-v2 |
|---|---|---|
| bulk-all (923 addresses) | 0 sent, 4 questions, a lecture, 13 calls, 61 credits (stopped there), one request of 109,136 tokens | 923/923 in 3 runs of 3, 0 invented, 0 twice, 0 questions, 1 card, 2-4 calls, 2.3-5.1 credits (4.0 on average), largest request 30,145 tokens |
| bulk-all-refused | not run | 923/923 in 3 of 3, 1 card, 2 calls, 1.8-2.8 credits |
| bulk-filter (151) | not run | 151/151, 1 card, 3 calls, 2.3 credits |
| old-topics | 0 sent, 6 questions, 19.6 credits; no old topic in its words either | 923/923, 1 card, 2 calls, 5.3 credits, no old topic |
| single-connect | sent after a link in the chat and "connecté": 3 cards, 13 calls, 8.7 credits | sent with no second message: 2 cards (connect, send), 5 calls, 5.0 credits |
The first call of a cold conversation is still about 3.4 credits (27,000 tokens of instructions and tools written to
the cache): most of what a run costs now. Unit tests 510/510, the 17 scripted scenarios pass, `tsc` clean.
Not done: the prompt's fixed part is still about 27,000 tokens (3.4 credits each time the cache is cold: the next thing
to cut, with evals for research/list/team jobs first); for_each_row runs connector tools only (not browser or desktop
actions); a batch stops at a daily limit and is finished by asking again (no automatic next-day run); the connect card
and Zapier's state note were checked against the stand-in, not against Zapier itself (its real answers may read
differently: check once with a real account before release); "old topics coming back" was not reproduced on 0.14.1
with a seeded history, so that fix is by construction (summary, resume rule), not by measurement; website/hosted
server unchanged; nothing pushed or released.

## Error handling sweep after 0.14.0 (2026-11-19, on next-version, NOT RELEASED)
Owner's report: Zapier "Missing argument values for required properties" (Google Tasks) got "the app isn't connected"
advice and a useless problem email. Owner: look for the same kind of problem on Windows/Mac/Linux, every connector,
every scenario. Three read-only audits (connectors with 73 real error formats, platforms, reports/scenarios), then fixes:
- lib/tool-error-core.ts: one classifier for every connector (JSON-RPC code, HTTP status, service reason codes, Node's
  network code from `cause`, then words EN/FR/AR) + next step per kind; zapierNextStep moved here. Unit test table:
  tests/unit/fixtures/tool-errors.json. tsconfig: allowImportingTsExtensions (pure modules import each other with .ts).
- Connectors: no blind retry of a write that timed out/5xx; refused calls aren't "may have run"; key refused vs sign-in;
  real network reason; install hint only for program connectors; no browser hint on connector errors; no pointless retry.
- Reports: fixed-later = same tool+app+site (never an action to another target); connector user-side states not filed;
  JSON readable; Not confirmed counts; more Darija/French "couldn't"; paths hidden on all systems; reviews mark fixed
  errors; Telegram 400 refusals reported; Problems group the same error across sites, HTTP codes kept apart.
- Platforms (lib/platform-errors-core.ts): certificate/antivirus = "tls" (translated, no retry, system CA store trusted
  at start), real browser launch reason, cmd.exe UTF-8, locked files on delete, .git case, CRLF edits, XDG folders,
  service 400/500 reported (busy only for 429/502/503/504/529); test harness fails fast on EADDRINUSE.
- Cloud send_telegram works; missing tools explained without "enable"; help says how problem reports work.
Not done: cloud runs don't send problem reports (proxy has no feedback route); lib/hosted.ts status-check "offline".
All scenarios + CI 3 OS green (run 44592238362), cost 169,983.

## Fixes from the owner's 2026-11-19 problem list (on `next-version`, NOT RELEASED; website deployed with the web removal)
Owner: "yes, push to main and deploy the website" (done: download-only website live, checked with curl). Then: fix the
Zapier / morning check / Telegram problems "from the root" before 0.14.
- **Connectors never vanish silently** (`lib/mcp.ts` connectSure + mcpToolsFor `down`, `lib/orchestrator.ts` downLine /
  missingToolText): a connection that fails is tried once more; a sign-in the service refused first takes the account's
  newer copy. If it still fails the bot is told "<name> couldn't be reached just now (<reason>)", not to call it, and to
  say so in one line with an [Open/Reconnect] button; a call made anyway answers the same (was: "The tool isn't enabled
  for Oovi", which made the bot tell the owner to enable Zapier). No OK card for a tool that can't run. The note on the
  message no longer says "use its tools" for a connector that didn't answer (`lib/capabilities.ts`).
  Test: zapier-scenario G (stand-in Zapier answering 503).
- **Shared sign-in (computer + cloud server)**: before opening a sign-in connector, the computer takes the account's
  newer sign-in (`pullSignIn`, lib/cloud-sync.ts), and again when the service refuses it. Why: the cloud server renewed
  Zapier's sign-in at 10:54 (its log: one job, 2 connectors) while the computer was off; at 12:51 the computer answered
  Telegram with the old key before its regular sync. The hook lives on globalThis (each Next.js route bundle has its own
  copy of lib/mcp.ts; a module variable was invisible to the bots: found by the test). Test: cloud-sync-scenario
  "a sign-in renewed elsewhere" (fails without the fix, checked).
- **Telegram and the app show the same**: everything sent with sendToMainChat (send_telegram, routine results,
  reminders) is also written in the main bot's chat unless it is already there (`mirrorInApp`, lib/telegram.ts).
  send_telegram isn't offered while the user writes from Telegram to the main bot (the reply goes there anyway: no
  double messages). Tests: telegram-scenario (copy once; reminder once).
  NOT FOUND: why the 12:51 long reply in Telegram is missing in the app chat; asked the owner for a screenshot.
- **Time zone on the cloud server**: runner/index.mjs read `job.timezone`, which nothing set (every cloud job ran in
  UTC: the 15:30 meeting first went in at a wrong hour). The phone sends its zone with every job (web/app/m/_lib/api.ts
  postJob); the runner uses `job.payload.timeZone`. The bot's "Today is" date is the local date.
- **"Not confirmed" on a real connector action**: lib/receipts-core.ts counted only connector tools named with
  send/post/create…; Zapier's `execute_zapier_write_action` wasn't. Now any connector tool counts unless its name says it
  only reads (list/get/search/read/inspect…). Unit test added.
- **Routines run on the cloud server while the computer is off** (owner: "نعم، خلي السيرفر يخدم الروتينات كي الحاسوب طافي").
  Contract in docs/CLOUD-BUILD.md "Changes". The computer publishes its cloud-able routines (on, clock-started, not a
  watched page, chat travels) with their next time and time zone at every routine check (`syncCloudRoutines`,
  lib/cloud-sync.ts; PUT /api/v1/cloud/routines), uploading its setup first for a new one. With no desktop seen for 60 s,
  `queueDueRoutines` (web/lib/cloud.ts, run before each runner claim) turns a due routine (≤ 3 h late) into a runner-only
  `routine` job; the runner runs it with `runRoutineInCloud` (lib/routines-scheduler.ts, the same code as on the
  computer) in the computer's routine chat (`useRoutineChat`), Telegram through the website (sendToMainChat on the
  runner → /api/v1/cloud/runner/telegram, `sendToOwner`), then reports ran/next with `done`. The computer, back on,
  marks those runs done before its catch-up (cloud sync now starts before routines, instrumentation.ts). A run that needs
  the computer is left to the computer's catch-up. Tables: `cloud_routine`, `cloud_job.kind` gains 'routine' (migrated
  in place). Test: cloud-integration-scenario section 5 (real website + Postgres + runner + desktop).
  NEEDS: website deploy + runner image update + desktop release, together.
- **Pre-launch gap review (2026-11-19, owner: "look at every gap, UX and result quality, deeply")**: 3 audits (competitors,
  UX, harness) then two fix teams. Harness: routine runs dated (no stale data as today's), "Not confirmed" covers
  send_telegram/desktop/file actions and teammates' work, the done-check sees FAILED tool calls, a connector write with
  no answer is never retried blindly, Zapier writes carry the time zone, routines reply in the language they were asked
  in (synced). UX: credit/limit/sign-in errors translated with the next step on Telegram, phone and routine notices;
  Telegram photo captions answered; desktop sign-in errors translated; Zapier page "didn't answer" state; connector errors
  in plain words with Details; Telegram texts translated; RTL and onboarding fixes. Routines page: where each runs while
  the computer is off; Telegram notice at its time when it waits for the computer. Cost still 169,983. All scenarios and
  CI on 3 OS green (run 44558396550).
  Not done yet (from the audits): phone Settings credits text is the website's English; spend-limit/busy errors keep the
  bot's text; de/es/tr fall back to English for new keys; streaming replies on Telegram (sendMessageDraft).

## 0.13.1 (released 2026-11-19, owner: "yes, deploy the website and release 0.13.1")
Bot pictures made with "Your picture" go to the account (POST /api/v1/avatars) so the phone, web and other computers show them. Website deployed: sign-in lands in /app, the account page is in /app Settings (real-auth check 12/12 on a throwaway database).

## 0.13.0 (released 2026-11-19, owner: "yes, deploy the website and release 0.13")
Website deployed with the phone app (/m) and the web app (/app); desktop 0.13 = cloud sync (off by default), desktop visual refresh, Markdown tables in chat, phone jobs for new or never-opened bots. See the Cloud sections below.

## Android app (branch `android-app`, 2026-11-19, NOT RELEASED, nothing published, website NOT deployed)
Owner: "an APK app and an iOS app; the APK downloadable from the website, iOS soon; not a web app".
- **What:** `mobile/`, a Capacitor 8 native shell around the phone app the website already serves
  (https://oovi.conuron.com/m), so the two never drift: a website deploy updates the app's screens too. App id
  `app.oovi.mobile`, name "oovi", Android 7+ (minSdk 24, target 36). The iPhone project is generated
  (`mobile/ios/App`) but never built: steps in `mobile/IOS.md`.
- **Native parts (Android, `mobile/android/app/src/main/java/app/oovi/mobile/`):**
  - Links (`NavPolicy.java`, unit-tested): the phone app (`/m`, `/app`) and the account pages it needs (`/login`,
    `/signup`, `/forgot-password`, `/reset-password`, `/verified`, `/api`) stay in the app; every other page,
    other sites and connector sign-in pages open in the phone's browser as a Custom Tab (Google refuses sign-ins
    inside an app's WebView); mail/phone/maps links go to their app; `javascript:`, `file:`, `content:`, `intent:`
    are refused. Works with the website as deployed today (no web change needed).
  - Connector sign-in: the service opens in a Custom Tab; it comes back there without the app's session, so the
    website shows its "Yes, it's my account" page (held flow); back in the app, the app re-checks at once (it sends
    "focus" on resume) and `/oauth/finish` completes it. Same flow as an iPhone Home Screen app; NOT tried on a phone.
  - Offline (fixed after the first emulator run showed Android's own "Webpage not available": Capacitor's errorPath
    points at https://localhost and isn't served; now the app loads the page itself with `loadDataWithBaseURL` at
    https://oovi.conuron.com/offline.html, `ACCESS_NETWORK_STATE` lets the page see the connection come back):
    no network on a page load → the page built into the app (`mobile/src/offline.html` → `www/offline.html`,
    logo inlined, ar/fr/en from the app's saved language or the phone's, light/dark), "Try again" and automatic retry
    when the connection is back, to the page that failed (app pages only). The website's own error pages (404...)
    show as they are. After the first visit the phone app's offline worker shows saved chats instead.
  - Back button: closes an open sheet or menu first (event `ooviback`, needs the website deploy), then back in the
    app; from the chat list or the sign-in screen the app goes to the background.
  - Microphone: the first time, a short explanation (en/fr/ar, `res/values*/strings.xml`), then Android's question;
    only oovi's own pages may use it. File picker: Capacitor's (photos and files say "coming soon" on the phone
    anyway). No camera, location or contacts permission.
  - Sign-in kept: WebView cookies, saved on pause. No backup of app data (the sign-in must not move to another phone).
  - App Links: `https://oovi.conuron.com/m` and `/m/...` open the app once `web/public/.well-known/assetlinks.json`
    lists the signing key (written by the workflow the first time, see below; needs a website deploy after).
  - Status bar and safe areas: Capacitor's SystemBars (edge to edge; the page's own `env(safe-area-inset-*)`).
  - Icons: adaptive icon (logo on white), splash = logo on paper (dark paper in dark mode). `node mobile/scripts/native-icons.cjs`.
  - User agent ends with `ooviApp/1.0` (`web/lib/app-detect.ts`).
- **Store-ready from day one (owner, via the main session: the APK is temporary until Google Play and the App
  Store):** same app id and key will be Play's (Play App Signing with our key, steps in `mobile/STORES.md`), AAB built
  each release, target SDK 36, only internet, network state and microphone permissions, Privacy policy and Terms links at the bottom of
  the phone app's Settings, no APK/Android text inside oovi's app (so none in the iPhone app), iPhone usage texts for
  microphone, camera and photos. When oovi is on Play: set `NEXT_PUBLIC_PLAY_STORE_URL` in Vercel and the website
  switches to "Get it on Google Play" (`?apk=1` keeps the APK). `mobile/STORES.md`: Play Console listing, Data safety
  answers, internal → closed → production; App Store Connect privacy answers.
- **Website (needs a deploy, owner says "deploy"):** `/download/android` (same proxy as the desktop files; if the newest
  release has no APK yet, the newest release that has one, `web/lib/releases.ts`); the download page has an
  "On your phone" card in the visitor's language (ar/fr/en): "Direct download for now: oovi will be on Google Play
  soon", 3 install steps incl. "Install unknown apps", "Download for Android (APK)", "iPhone: coming soon"; first on
  Android phones, not shown inside oovi's app; on
  /m in a browser on Android: "Get the Android app" card in the chat list (in place of the desktop card, hideable)
  and in Settings (in place of "Add to Home Screen"); inside the app, no "Add to Home Screen"; Admin download charts
  count Android. Screenshots: `docs/android/`.
- **Builds (`.github/workflows/android.yml`):** on a published release (or Run workflow with a tag): signed
  `oovi-<version>.apk` + `oovi-<version>.aab` attached to the release (versionCode = major×1,000,000 + minor×1,000 +
  patch, `mobile/scripts/version.mjs`), also copied to the downloads repo; Run workflow without a tag = test build
  under Artifacts. On every push to `android-app` that touches `mobile/`: debug build, unit tests, and the app opened
  on an Android 14 emulator with screenshots (Artifacts "android-screens").
- **Signing (no key ever in chat):** the owner adds one secret, `ANDROID_KEYSTORE_PASSWORD`. The first release run
  creates the key (RSA 4096, 30 years), checks it, encrypts it with that password (AES-256, PBKDF2 600,000 rounds) as
  `mobile/android/release.keystore.enc`, commits it with `assetlinks.json` to the release's branch, and only then
  signs. Later runs decrypt it; a wrong password stops with the exact fix. The run log and summary print the
  certificate's SHA-256. **If the password or that file is lost, phones can't update the app** (they must uninstall
  first and lose the app's saved data): keep the password in a password manager.
- **Push notifications: prepared, OFF.** The workflow adds `google-services.json` only when the secret
  `GOOGLE_SERVICES_JSON` exists AND `@capacitor/push-notifications` is installed in `mobile/`. Still to build: the
  plugin install + token registration on the phone, a website table for device tokens, and sending through Firebase
  (FCM HTTP v1, a service-account key in Vercel) when a bot answers or needs an OK.
- **Verified here:** Android SDK 36 installed in a scratch folder; debug build OK (4.4 MB); `NavPolicyTest` 6/6
  (JUnit); a full release build signed with a THROWAWAY stand-in key exactly like the workflow (keytool → openssl
  encrypt → decrypt identical; wrong password refused; `apksigner` shows the key's SHA-256; versionCode 13000 /
  0.13.0; permissions: internet, microphone (+ audio settings) (network state added after, see below); release APK 3.3 MB, AAB 3.2 MB); `npx tsc --noEmit`
  root and web clean; unit tests 425 (424 pass, 1 skipped: the live YouTube test; new `mobile-native.test.mts` 5/5);
  `npm run build` in web OK; `node tests/e2e/mobile-scenario.cjs` 127/127; new `node tests/e2e/native-web-scenario.cjs`
  59/59 (download page on computer and phone, the Android card and its hiding, Settings, no install hints inside the
  app, Back closes a sheet, /download/android, the offline page in 3 languages × light/dark, its retry never leaves
  the app's pages, nothing loaded from the network). Suggest adding it to the release checks in CLAUDE.md (owner's file, not changed).
- **Verified on an Android 14 emulator (GitHub, job "check", run 4 on 6c7580f):** the app opens the live sign-in
  screen (light and dark, status bar and gesture bar right), Back on sign-in sends it to the background, a link to
  https://oovi.conuron.com/m/settings opens the app (signed out → sign-in), with no network a fresh install shows the
  built-in offline page (light and dark), and when the network comes back it reopens oovi by itself; no crash.
  Screenshots: `docs/android/emulator-*.jpg`. Run 1 found the offline bug (fixed above); in run 1 the link shot
  showed the home screen, in run 4 the app stayed in front at 2 s and 12 s (likely a timing fluke; watch it).
  App Links verification on that emulator: "Error hosts: oovi.conuron.com" (expected: no assetlinks.json yet).
- **NOT verified:** this machine has no emulator (no hardware acceleration). Not tried: a real phone, a connector sign-in round
  trip in a Custom Tab, the microphone in the app, App Links verification (needs the real key + deploy), the release
  workflow itself (needs the secret), the iPhone project.
- **Not built:** share-to-oovi (sharing text or a photo from another app into a chat): it needs a "pick a chat"
  screen on the website first; push notifications (above).

### Owner steps (exact clicks)
1. **Add the password (once):** https://github.com/oussasz/oovi/settings/secrets/actions → **New repository secret** →
   Name `ANDROID_KEYSTORE_PASSWORD` → Secret: a long password you invent (16+ characters) → **Add secret**. Save the
   same password in your password manager. Never paste it anywhere else.
2. **Merge `android-app`** into your main branch when you're happy (the "Run workflow" button only appears for
   workflows on the default branch).
3. **First build (creates the key):** Actions → **Android app** → **Run workflow** → Use workflow from: `main`, tag
   empty → **Run workflow**. When it's green: the run's page shows "Signing certificate SHA-256"; the key and
   `assetlinks.json` are committed to main; the test APK is under **Artifacts** to try on your phone.
4. **Each release:** publishing a release (or "Make a release") builds the APK by itself and attaches it. Then say
   "deploy" so the website gets `/download/android` and `assetlinks.json`.
5. **Try it on your phone:** on Android, open https://oovi.conuron.com/download → **Download for Android** → open the
   file → allow your browser to install apps → **Install** → open oovi and sign in.

# Hand-off: oovi 0.10.0 (released 2026-11-11)

## Desktop visual refresh (branch `desktop-refresh`, 2026-11-19, NOT RELEASED, nothing published)
The desktop app now uses the phone/web app's look (web/app/m/m.css). No behaviour, texts or bot instructions changed.
- **Found:** all Latin text was drawn in Noto Sans Arabic, not Nunito (next/font declares every subset of a face,
  and Noto was first in the font stack). Now Nunito first; Tajawal (the phone app's Arabic face) first only when the
  app is in Arabic (`html[lang="ar"]`, app/globals.css). Tajawal's Arabic letters are self-hosted in `app/fonts`
  (SIL OFL, `Tajawal-OFL.txt`) with tuned line metrics (app/layout.tsx): with its own, Arabic words sat ~3 px high in
  buttons and pills. Latin and digits come from Nunito in every language.
- **Look:** colors, shadows and 22 px corners from the phone app (tokens at the top of app/globals.css; dark paper
  #151513); your messages in ink; each bot's replies washed in its own face color (`--bot`, set per message in
  components/ChatView.tsx); approval card as a white card with the actions in a paper box and 44 px pill buttons;
  pill composer; heavy Nunito headings; section labels without capitals; settings icons on pebbles; hopping
  pebbles while a bot types; focus ring #4A63D6 (light) / #A9BCF7 (dark).
- **Fixed on the way:** the bot editor page (`/bots/<id>`) had its Back button as a grid item, which pushed the form
  into the narrow column under the preview; it now takes its own row.
- **Screenshots** (1440x900; en/ar x light/dark): `docs/desktop-refresh/before-*.jpg` and `after-*.jpg` for home,
  chat-approval, group, canvas, settings, marketplace, bot-editor. Made by `node tests/e2e/desktop-shots.cjs <prefix>`
  (needs a build; seeds a throwaway data folder, stand-in website).
- **Checked:** tsc; unit tests 415 pass, 1 skipped; npm run build; chatbasics 23/23, upload 10/10, list 64/64,
  onboarding 12/12, approvals 16/16, form 25/25, group 34/34, spec 37/37, phase1 11/11, cost 11/11 (weighted
  169,901, unchanged). Contrast with axe-core on home, both chats, Marketplace, bot editor and Settings in en/ar x
  light/dark: 0 violations (a planted low-contrast line was caught, so the check works). Focus rings seen in both
  themes. Muted text passes 4.5:1 on paper, side bar, cards and fills.
- **Not checked:** on Windows/Mac (fonts render differently; run the CI workflow), screens not in the list above
  (routines, group editor, onboarding visuals were only covered by their scenarios, not looked at), small windows.
- **Noticed, not changed:** Markdown tables in a bot's reply show as raw `|` lines on the desktop (components/Rich.tsx
  has no table rendering); the phone app draws them as tables.

## Cloud LIVE state (2026-11-19, owner said "deploy" and approved adding RUNNER_SECRET to Vercel)
- Website deployed from branch cloud-integration (W + A + R + integration fixes): /api/v1/cloud live; RUNNER_SECRET set in
  Vercel production (generated on the build machine, never shown). Checked: signed out 401, wrong runner secret 403,
  real secret claim → {"job":null}.
- Azure for Students: resource group oovi-runner-rg, VM oovi-runner-1, Sweden Central, Standard_B2ats_v2 (2 vCPU, 1 GiB +
  2 GB swap), public IP 51.12.81.178, NO inbound port open (NSG allows SSH only from 127.0.0.1/32). Managed with
  `az vm run-command invoke … --command-id RunShellScript` (the build machine can't reach port 22). ≈ $13.40/month.
- The runner image was built on the build machine and loaded on the VM through a temporary storage account (deleted
  after): RUNNER_IMAGE=oovi-runner:local in /opt/oovi-runner/.env, RUNNER_MEM_LIMIT=800m, RUNNER_CONCURRENCY=1. The
  6-hour auto-update can't pull a local image (it fails harmlessly): to update, rebuild and load again the same way,
  or run the "Runner image" workflow to ghcr.io and switch RUNNER_IMAGE (needs the workflow on the default branch and
  the package public, or a read-only token on the server).
- Status checked: container healthy, "0 job(s) running", log line {"ev":"start"}.
- Users see nothing yet: the desktop app with sync is not released; the phone/web app (part M) is still being built.

## Cloud integration: W + A + R together, for real (branch `cloud-integration`, 2026-11-18, nothing deployed)
Tested with the REAL website (web/, built, `next start`) on a throwaway local PostgreSQL, the real desktop app
(built) and the real runner (as Node and as the Docker image); stand-ins only for theOovi's upstream model and for a
connector (a real MCP server on this machine that needs its key). `tests/e2e/cloud-integration-scenario.cjs`
(needs TEST_DATABASE_URL to a database on this machine; it refuses any other): 28/28 twice with the runner as
Node; with the runner as the Docker image it passed before the last 5 checks (runner API probes) were added.
- **Checked end to end:** the desktop turns sync on; its chat, setup and a connector with its key reach the website
  (the key sealed in the database, never in clear); a phone message (POST /api/v1/cloud/jobs) is claimed and answered
  by the desktop while it is on; with the desktop off, the runner claims it, pulls the setup, installs the connector
  from the vault exactly as the desktop wrote it, calls it with its key (MCP-RESULT-42), answers, pushes, and GET
  /chats shows it; theOovi calls are billed to the account; a step that needs the computer: the runner answers in
  French and leaves the job `needs_computer`; the desktop, opened again, claims it and runs it, and the message shows
  once with the real answer; the runner API's exclude and release work; a wrong runner secret is refused; the
  runner's logs carry no chat text, keys or tokens.
- **Found and fixed:**
  1. Runner vs W's real API: a claimed job is `jobId` (not `id`), and heartbeat/done need `{runnerId}` in the body.
     The runner now sends both (runner/web.mjs); a tombstoned chat ends the job (chat_not_found).
  2. The website had no runner `release` and no runner `setup` route, and ignored `exclude` (all in the contract note
     of part R). Added `POST /runner/jobs/<id>/release`, `GET/PUT /runner/setup/<userId>` (only for accounts that
     sync), and `exclude` in `claimForRunner` (web/lib/cloud.ts, web/app/api/v1/cloud/runner/…); types noted in
     web/lib/cloud-types.ts.
  3. Desktop: a job the runner left as needs_computer was run as a NEW message: the chat showed the message twice
     with the cloud's "needs your computer" reply between them (proved by running the scenario without the fix).
     Now the message gets the job's id (same rule as the runner: lib/cloud-sync-core.ts `jobEntryId`) and, if the
     chat already holds it, it and its answers are taken out first (`withoutJobEntry`) (lib/cloud-sync.ts runJob).
  4. Vault shape: A's `vaultConnectors` and the runner's `installVaultConnector` match (name, transport, url,
     headers, auth, oauth {clientInfo, tokens, signedInAt}, enabled, trusted); nothing to change. Connectors that run
     as a program (stdio) are in the vault too but the runner never runs them.
  5. Test-only: `OOVI_CLOUD_TEST_HOSTS` (lib/mcp.ts) lets the cloud runner reach the stand-in connector on 127.0.0.1;
     the runner passes it to a job only from RUNNER_TEST_HOSTS, never set on a server.
- **Rerun, all pass:** tsc (root and web); unit tests 378 (1 skipped, as before; new: cloud-job-entry); npm run build
  (root and web); runner scenario 22/22; A's cloud-sync scenario 38/38; W's scripts/test-cloud.cjs 136/136; cost
  scenario weighted 169,901 (unchanged), 11/11.
- **Not checked:** a real theOovi, a real OAuth connector refreshed by the runner (the vault write-back path ran only
  against stand-ins), the phone app (part M) itself, the image on arm64, a real server or Azure.

## Pay in app (branch `pay-in-app`, 2026-11-19, NOT DEPLOYED, NOT RELEASED)
The owner removed the website account (contract 2026-11-19), so people pay from inside the app, like other desktop
apps: the app asks the website for a single-use link tied to the signed-in account and opens it in the browser.
- Website: `POST /api/v1/billing/link` (`web/app/api/v1/billing/link/route.ts`): `{kind:"checkout", plan?, cycle?}`
  or `{kind:"portal"}` → `{url}` = `<site>/pay/<token>`. Signed-in session only (the desktop's Bearer token, or the
  phone app's cookie from the site itself); the account comes from the session, never the body. Token: 32 random
  bytes, only its SHA-256 stored (table `pay_links`, `web/lib/pay-links.ts`, also in `scripts/migrate.mjs`), works
  once, 10 minutes, at most 10 per account per 10 minutes. Portal for an account without a subscription: 404
  `no_subscription`. Plans checked against `web/lib/pricing-tiers.ts` (`web/lib/pay-core.ts`, pure).
- `/pay/<token>` (`web/app/pay/[token]/page.tsx`, no sign-in, not indexed, no referrer): checkout = the plans with
  Paddle's checkout for exactly that account (`customData.userId`, its email prefilled; a plan chosen in the app opens
  by itself; after paying → `/pay/done`); portal = straight to that account's Paddle customer portal. Used or expired
  link → a page in Arabic, French or English: "Open oovi and press Subscribe again".
- Webhook: the account comes from the checkout's user id; it now also replaces a Paddle customer's link that
  customer.created guessed from the typed email (`ensureCustomer` in `web/lib/billing.ts`). So a buyer who types
  someone else's email can't credit them or open their billing portal.
- `/api/v1/ai/status` adds `billing: {inApp: true, subscriber}`. `links.subscribe` and `links.pricing` still point to
  `/pricing` for older apps; `/pricing` no longer sends anyone to sign in (it says to subscribe from the app; its free
  card says "Download oovi"). NOT changed: `links.pilot` and `links.feedback` still open `/pilot` and `/feedback`,
  which ask for a website sign-in (removed by the owner): to fix with the website removal work.
- Desktop: `app/api/billing/link/route.ts` asks the website (`cloud()` with the account) and only accepts a link to
  `<site>/pay/`; `PayButton` in `components/Credits.tsx` (credits popover, "out of credits" notice; subscribers get
  "Manage subscription") opens it in the normal browser and reads the credits again when the window gets focus (and
  15 s later). Settings > Profile shows "Manage subscription" for subscribers. 4 new texts in the 6 languages. Older
  servers without `billing.inApp`: the old subscribe link, as before.
- Phone (`web/app/m/_ui/SettingsScreen.tsx`, separate commit): Get more credits, Plans and Manage subscription call
  the same API and open the link with `window.open` (falls back to the same tab); credits and billing read again on
  return. The Android app must send that link to the system browser / Custom Tabs: NOT checked in the Android app.
- Checked: `tests/unit/pay.test.mts` (3; it found a bug: a plan named `toString` passed, fixed with `Object.hasOwn`),
  unit suite 422 pass / 1 skipped, tsc root and web clean, root app build and web build OK,
  `web/scripts/test-pay.cjs` 33/33 on a throwaway PostgreSQL with the built site, a stand-in Paddle API
  (`OOVI_PADDLE_API_TEST_BASE`, only a local http address is accepted) and signed webhooks: single use, expiry, made-up
  token, the session's account only, another person's link never pays for the one who opens it, portal for a
  non-subscriber, portal redirect with the subscriptions, ar/fr/en pages, credits land on the link's account and not
  on the typed email, 10-links limit, no link in the server's logs.
- NOT checked: the real Paddle checkout opening in a browser (needs Paddle's script and account), the buttons clicked in
  the running desktop app or the Android app, Safari/Firefox. Store rules for later: `mobile/STORES.md`.

## Cloud W: website storage and API for cloud sync (branch `cloud-web`, 2026-11-18, NOT DEPLOYED, NOT RELEASED)
Part W of `docs/CLOUD-BUILD.md` (the contract; what had to change is listed at its bottom). Nothing uses it until
the desktop app (part A), the phone app (M) and the runner (R) are built. Deploying it alone changes nothing for
users EXCEPT the privacy page and terms (see the last point): don't deploy before the owner decides when that text
goes live.
- Tables `cloud_sync`, `cloud_chat`, `cloud_vault`, `cloud_job`, `cloud_device`: `web/lib/cloud.ts:30` (made on first
  use) and `web/scripts/migrate.mjs` (same text). Everything stored is gzip + `sealSecret` (`sealJson`, cloud.ts:98);
  the key stays in the website's environment (AI_KEY_SECRET or BETTER_AUTH_SECRET). Deleted with the account (CASCADE).
- Chats: versions, 409 with the server copy to merge (`putChat` cloud.ts:241), 100 MB compressed per account
  (`quotaAfter` `web/lib/cloud-core.ts:100`; shrinking is always allowed), 4 MB per chat (Vercel's body limit),
  delete = tombstone without content for 30 days (`deleteChat` cloud.ts:267, purged in `listChats` cloud.ts:205).
- Jobs: atomic claim with `FOR UPDATE SKIP LOCKED`, 120 s leases, one claimer per chat (advisory lock per chat; Stop
  still reaches the holder) (`claim` cloud.ts:360). Runner: only jobs older than 5 s with no desktop seen in 60 s,
  never `needs_computer` (cloud.ts:427). Finished jobs lose their payload at once, rows go after a day.
- Routes `web/app/api/v1/cloud/...`: status, chats, chats/[chatId], vault, vault/[connectorId], jobs, jobs/claim,
  jobs/[jobId]/heartbeat, jobs/[jobId]/done, events (long-poll 25 s), runner/claim, runner/jobs/[jobId]/heartbeat|done,
  runner/chats/[userId]/[chatId], runner/vault/[userId]/[connectorId], runner/ai/[userId]. Account id from the
  session only (`signedIn` `web/lib/cloud-route.ts:32`: rate limits, blocked accounts, cross-site writes refused).
  Runner routes: header `x-oovi-runner` vs env `RUNNER_SECRET` in constant time; unset or under 32 characters = the
  runner API answers 404 (`runnerAuth` cloud-core.ts:117, `runnerOnly` cloud-route.ts:50). Logs carry only an error
  code, never text (`logCode`).
- theOovi for the runner: the request handling moved from `web/app/api/v1/ai/messages/route.ts` to
  `web/lib/ai-messages.ts:238` (`aiMessages`, unchanged except who pays); the old route is now 10 lines and still
  passes. The runner's calls skip the app-signal update and the welcome-credit network check; `/runner/ai` needs sync
  on and an existing credit account (`POST /jobs` creates it from the person's own address).
- Connectors from the phone (owner's decision, contract 1f0f147): sign-in started on the phone finishes on the
  website (`web/lib/cloud-oauth.ts`, the MCP SDK's `auth()` like the desktop's `lib/mcp-oauth.ts`; routes
  `connectors/[connectorId]/oauth/start` and `connectors/oauth/callback`). State: only its hash stored, once, 10
  minutes, same account and session; verifier sealed in table `cloud_oauth_flow`. The website calls only public
  https addresses (every request and redirect checked after DNS, `guardedFetch`). Vault refuses AI model keys,
  accepts a connector's own key. `@modelcontextprotocol/sdk` 1.32.2 and `zod` 4.6.7 added to web (same versions as
  the app). Tested with a stand-in OAuth service on this machine, NOT with a real service (Notion, Linear…).
  Back in ANOTHER browser (an iPhone home-screen app opens Safari, another session): the code is kept sealed and a
  small page (ar/fr/en) shows the account masked with "Yes, it's my account"; then the app finishes it
  (`POST connectors/oauth/finish`, same session only; `GET /vault` lists `pending`). The tap was added on purpose:
  without it, a sign-in link sent to someone else would quietly hand their connector to the sender. NOT checked on
  a real iPhone.
- Admin: Users list has a "Syncs" column ("Yes · 12 chats · 3.4 MB"), a user's page a "Cloud sync" section (chats,
  size of limit, last sync, devices), Overview a "Cloud sync" count. Never content.
- NEEDS A LAWYER'S READ: privacy page section "3. Optional cloud sync" (`web/app/privacy/page.tsx:85`; later sections
  renumbered 4-15, summary and sections 2, 4, 8, 9, 10 adjusted) and terms section 7 "Optional cloud sync"
  (`web/app/terms/page.tsx:117`). LEGAL_LAST_UPDATED set to 2026-11-18; TERMS_VERSION NOT changed (changing it asks
  people to accept again: owner's call). The text describes the feature as built by the contract (phone, runner,
  connector sign-ins used by the server, admin never reads chats as a rule, not a guarantee): publish it only with it.
- Verified: `npx tsc --noEmit` (web and root) clean; unit tests 343 (342 pass, 1 skipped: the existing live YouTube
  test), `tests/unit/cloud.test.mts` 14/14; `npm run build` in web OK; `web/scripts/test-cloud.cjs` 136/136 (connector sign-ins included) against a
  throwaway PostgreSQL 16 on this machine and the BUILT site (`next start`) with a stand-in AI provider: sync off/on,
  versions and 409, isolation between accounts, 100 MB and 4 MB limits, tombstones, vault, jobs and leases, 16
  claimers at once (each job once), runner gating, needs_computer back to the desktop, runner AI billing, long-poll,
  admin pages (no content), privacy page, turn off and account deletion wipe everything, no marker text in the
  database or the server's logs. How to run it: top of `web/scripts/test-cloud.cjs` (it refuses non-local databases).
- NOT verified: on Vercel or Neon (only local), under real load, real Azure runner, the desktop and phone clients
  (not built yet), Safari/Firefox for the admin pages, the in-memory rate limits across several server instances (same
  weakness as the rest of the site). The CI workflow doesn't run the PostgreSQL test (no Postgres there).
- Open questions for the owner: when to publish the new privacy text and whether to bump TERMS_VERSION; whether
  "cloud-only" chats need a flag (contract mentioned it, nothing marks them); the 100 MB limit; sealed rows are not
  bound to their account (someone with database write access could copy one account's sealed row to another; a
  per-account key would fix it); a long chat over 4 MB can't sync until the app trims or splits it.
## Cloud A: desktop sync and worker (built 2026-11-18 on branch `cloud-app`, NOT RELEASED, nothing published)
Part A of `docs/CLOUD-BUILD.md`. Needs the website API (part W, branch `cloud-web`) live before release: without
it, "Turn on" says "Sync isn't available on oovi's server yet" and nothing else changes.
- **What the user sees.** Settings > Sync (new tab): one switch, off by default; plain words on what is uploaded
  (chats as text, connectors with their sign-ins) and what never leaves (model keys, search keys, website
  passwords, local-only bots' chats, files); then the status (last sync, chats in sync / kept here, space used,
  devices, problems in plain words, "Sync now"). Turning off asks first, then deletes the server copy at once.
  First run: a third screen asks "Keep your chats on your phone too?" (Turn on / Stay local). Existing users: the
  same question once, as a window in the app (`components/CloudAsk.tsx`). Edit bot: "Where this bot's chats live":
  In the cloud (default) / On this computer only (`Bot.local`). Settings > Data's old "coming soon · paid" card now
  points to Sync. Texts in en, ar, fr, es, de, tr.
- **Where.** Rules (pure, unit-tested): `lib/cloud-sync-core.ts`. Service and worker: `lib/cloud-sync.ts` (started
  in `instrumentation.ts`). App route: `app/api/cloud/route.ts`. Hooks: `lib/store.ts` (`onChatChange`, quiet
  saves/deletes for copies from the account, a bot switched local/cloud marks its chats), `lib/mcp.ts`
  (`vaultConnectors`, `applyVaultConnector`). State per account: `cloud-sync.json` + `cloud-sync/<chatId>.json`
  (version, fingerprint, entries agreed at the last sync). Device id: `<data>/.device-id`.
- **How it syncs.** On: old chats upload in the background (newest first, progress in Settings). Each saved change
  is pushed 1.5 s later (every 0.8 s while bots work, so the phone sees it live). Every 15 s (and when the window
  gets the focus): pull what changed (`GET /chats?since`), push what changed here; every 5 min a full look at all
  chats. Entries merge three-way by id (entries have no `updatedAt`, so each side's entry fingerprints at the last
  sync are kept); 409 = merge and send again; 413 = new chats stay here, Settings says the space is full. A chat
  travels only if all its bots are "cloud" (a group with one local bot stays local; routine chats the same).
  Deleting a chat sends a tombstone; a tombstone from the account deletes it here. A bot moved to local takes its
  chats off the account at once.
- **Security.** Every request is scrubbed of the model keys, search keys, E2B key, saved website passwords and the
  session token (`scrubSecrets`), even inside a connector. A chat's project folder and "allowed for this chat"
  rules are never uploaded and never taken from another device (no device can grant itself rights here). From
  the phone the desktop takes only: message, approval yes/no (+ "allow in this chat"), plan answer, question
  answers, Stop; never "always allow folders/edits". No chat content in logs.
- **Connectors managed on the phone** (owner's decision of 2026-11-18, contract change merged from `next-version`):
  on each sync, a connector added or signed in elsewhere is saved here (tokens encrypted with this computer's
  key), its on/off and its bots (`bots` in the vault item) follow, and one removed from the vault is removed here
  without a question (Settings > Sync shows "Removed on another device…" for a week). A connector changed here
  since the last sync is kept and sent back instead of being removed.
- **Desktop worker.** While oovi runs, signed in and sync on: `POST /jobs/claim` every 3 s (this is also what
  registers the device as online: the contract has no other device call, noted at the bottom of
  `docs/CLOUD-BUILD.md`), pulls the chat first, runs the job with the normal runner (`startRun`, `steerRun` if the
  bots are already working, `stopRun` for Stop), heartbeats every 30 s, pushes the chat at the end, then `done`.
  Up to 3 jobs at once (different chats).
- **Verified** (on this branch's final build): `npx tsc --noEmit` clean; unit tests 343 pass, 0 fail (1 skipped: the existing test that needs a real YouTube page);
  `npm run build` OK; `node tests/e2e/cloud-sync-scenario.cjs` 38/38 against a stand-in website with the exact shapes of part W (`web/lib/cloud-types.ts`, branch `cloud-web`) (off until yes;
  old chats uploaded; local-only bot and its group never sent; keys/passwords/session never in any sync request;
  a key typed in a chat is "[hidden]" in the uploaded copy; connector with its key in the vault; a change from
  another device merged and shown; another device can't set the project folder or allowed actions here; two
  devices at once (409) keep both; a phone message run here and pushed while running; Stop; unknown and
  local-only jobs refused; tombstones both ways; full account; turning off deletes the server copy, keeps local,
  and stops all calls; a connector added and signed in on the phone appears here ready for the bots chosen there, its on/off and bots follow, its sign-in is stored encrypted, and removed on the phone it is removed here with a line in Settings > Sync). Existing scenarios on the same build, all passing: group, spec, phase1, bigjob, parallel, telegram, cost (169,901 weighted tokens, limit 170,000; no bot instructions or tool descriptions changed), onboarding, sync (setup sync), upload, list. Screens looked at in a browser
  (question, Settings > Sync in English and Arabic, bot editor).
- **Not verified.** Against the real website running (only against a stand-in using W's shapes; also covered:
  `sync_off` = turned off elsewhere, a chat over 4 MB stays here, turning on again re-uploads); the job heartbeat
  (every 30 s, the test jobs end sooner); the phone app; Windows/Mac (run "Tests on
  Windows, Mac and Linux" before a release); real chat sizes against the 100 MB limit (bot replies keep their
  tool steps, so heavy research chats are large); connectors whose sign-in refresh behaves differently on two
  computers at once.
- **Before release.** Website (part W) deployed first; privacy page and terms rewritten (part W/owner, the
  in-app text already says the server can open chats to run tasks); the owner decides when.

## Cloud R: the cloud runner and its servers (branch `cloud-runner`, 2026-11-18, not released, nothing deployed)
Contract: `docs/CLOUD-BUILD.md` (runner additions in its "Changes" note). Plain steps for servers: `infra/MOVING.md`.
- **What it is.** `runner/index.mjs`: claims a job from the website (`POST /api/v1/cloud/runner/claim`), runs it in
  the app's OWN built server (`.next/standalone`, started by `runner/job-server.cjs` with `OOVI_CLOUD_RUNNER=1`) on a
  fresh folder per job, drives it over the process's IPC channel (`lib/cloud-runner.ts`: prepare / connectors / run /
  chat / finish), pushes the chat after each step (at most every 2 s, merged by entry id on 409), heartbeats the
  lease every 30 s, ends the job, wipes the folder. No public port. Settings: env (see the top of runner/index.mjs).
- **Security.** The job's server never gets RUNNER_SECRET: it gets a token for its own account only, accepted by the
  runner's local proxy (`runner/proxy.mjs`), which allows theOovi calls (billed to that account), that account's setup
  and the public catalog, nothing else. Its HTTP API is locked with a launch secret nobody has. In the cloud the
  settings are theOovi only, no keys, no local network (`lib/settings.ts` cloudOnly); connectors run only with a
  public https address (`lib/mcp.ts`), only those the chat's bots use are fetched from the vault. Logs are JSON
  events with a whitelist of fields (`runner/core.mjs` logLine): no chat text, no names, account ids hashed.
  The container: read-only, no capabilities, user `node`, /tmp in memory; setup.sh blocks the cloud's metadata
  addresses for containers and lets only SSH in.
- **Computer steps.** An allow-list (`lib/cloud-runner-core.ts`): web search, research, read_url, places, papers,
  work tables/notes, routines, memory, skills, Telegram, questions/plans, connectors (mcp_). Anything else (files,
  desktop, the bots' browser, documents, the user's own cloud computer, other chats, tools added later) → the step
  isn't run, the bot answers in the user's language (Arabic, Darija, French, English; written by oovi, no model
  call) "This needs your computer: open oovi on it and I'll do it", the job ends `needs_computer`.
- **Hooks in the app** (all off unless `OOVI_CLOUD_RUNNER=1`): instrumentation.ts (no desktop background work),
  orchestrator (the computer-step stop; no self-learning call after a cloud run), runner.ts (no summary call after
  a cloud run: the server ends with the job), settings, mcp, setup-sync (`pullSetup`). No text added to bot
  instructions or tool descriptions.
- **Retries.** A released or retried job removes its own message and the answers after it before running again
  (`resetForRetry`), so a message is never in the chat twice. SIGTERM: jobs get 20 s, then stop, push, release.
- **Image.** `runner/Dockerfile` (amd64 + arm64; 606 MB), `.github/workflows/runner-image.yml` → `ghcr.io/oussasz/oovi-runner`
  (by hand, and on push to main touching runner/, lib/, app/…). `infra/docker-compose.yml`, `infra/setup.sh`
  (one command on any Ubuntu 22.04/24.04), `infra/azure/create.sh | allow-ssh.sh | delete.sh`.
- **Size (recommended for the trial): Azure Standard_B1ms** (1 vCPU, 2 GiB), 2 jobs at a time. Measured: one job's
  server peaks at ~214 MB, runner + 2 jobs ~410 MB. Azure price list read 2026-11-18 (prices.azure.com, France
  Central, Linux, pay as you go): B1ms $0.0236/h ≈ $17.23/month, Standard SSD E4 $2.64/month, static IPv4
  $0.005/h ≈ $3.65/month → **≈ $23.50/month**. The student credit (~$43) lasts under 2 months if left on: delete
  after each trial. Lasting, busier: B2als_v2 (2 vCPU, 4 GiB) ≈ $31/month for the VM.
- **Verified here:** `npx tsc --noEmit`; unit tests 347/347 (new: cloud-runner, runner-core, runner-infra); `npm run build`;
  `node tests/e2e/runner-scenario.cjs` 22/22, with the runner as Node AND as the Docker image (read-only, no caps):
  phone message answered and pushed, needs-computer in French with no extra model call, two accounts at once
  isolated (each theOovi call sees only its own bots and memory; the job server's environment has no secret;
  folders wiped), SIGTERM releases the lease and the job reruns once, logs without chat text; cost scenario
  unchanged (weighted 169,901, 11/11); the image's health check; shellcheck on the scripts.
- **NOT verified:** the real website API (part W isn't built yet: tested against a stand-in), a real theOovi, real
  connectors from a vault, `infra/setup.sh` on a real Ubuntu server (only syntax/lint and a test that it installs
  exactly infra/docker-compose.yml; a run in a system container was not possible here), `infra/azure/*.sh` (no
  Azure here), the GitHub workflow (not run yet), arm64 image.
- **Known limits.** Local (stdio) connectors don't run in the cloud and their tools simply aren't offered (no
  needs_computer for them). Desktop control isn't offered in the cloud (asking for it gets the bot's own answer, not
  needs_computer). Telegram sending needs the user's bot token, which stays on the computer. Work tables survive only
  if part A carries the chat's `work` field. Groups led by the main bot (message_group) need the computer.
- **Owner steps (when he says so):** run the "Runner image" workflow (Actions tab), decide whether the image is public
  (it holds the same code as the desktop app) or private (token on the server); set RUNNER_SECRET on the website; then
  `infra/azure/create.sh` with the main session.
- Admin > Announcements: "Only the people I choose" (website only, NEEDS A WEBSITE DEPLOY; not released). The audience is Everyone or a list the owner types (one address or up to 500, one per line; `web/lib/announcement-audience.ts`; kept in `announcements.test_email` joined by commas, matched by whole address with `= ANY(string_to_array(...))` in the app's list, the email list and the count). Owner's wish: chosen people get an ORDINARY email, not a news email: a plain-text message (new column `announcements.message`, added on first use and in `migrate.mjs`) sent in oovi's own layout with the owner's words as written and the title as subject (`personalMessage` in `web/lib/mail-templates.ts`), no news footer, no unsubscribe link or header. It goes to every chosen address that has an account, including people who unsubscribed from news, unconfirmed or blocked accounts (it is correspondence, the owner chose them); the editor lists who has no account (nothing sent) and whose address was never confirmed (may be mistyped). Everyone keeps the news email as before (HTML, unsubscribe, unsubscribed people skipped). The window and the bar in the app show only for the chosen people. "Send a test email" sends the same kind. Tested on a throwaway PostgreSQL with the built site and a local mail sink: a bad address refused with the list kept, a message required, 6 chosen (one unsubscribed, one unconfirmed, one with no account) -> 5 emails to exactly those five and none to an account that was not chosen, the title as subject, no List-Unsubscribe, HTML typed in the message shown as text, Arabic kept with dir=auto, pressing again sends nothing, one person only. Unit suite passes. Not tested: a real inbox, Safari/Firefox.
## Cloud M: the phone app (branch `cloud-mobile`, built 2026-11-18/19, NOT DEPLOYED)
Part M of `docs/CLOUD-BUILD.md`. The phone app's pages, in English, French and Arabic (right to left).
- NO WEB VERSION, NO ACCOUNT ON THE WEBSITE (owner, 2026-11-19, contract 8ab4a7d: "stop; cancel the web version
  entirely; remove the account button; people can only download from the website; everything is in the app").
  This replaces the web-version and account-page decisions below (kept for history). Done here:
  - `web/next.config.mjs` redirects: `/app`, `/app/**`, `/login`, `/signup`, `/account`, `/account/**` → `/download`
    (308); `/m` and its pages → `/download` unless the user agent has `ooviApp/` (the Android app's web view adds
    `ooviApp/1.0`, `mobile/capacitor.config.json` on branch android-app); the app's files (offline worker, manifest,
    icons, launch screens) stay reachable. `web/app/app`, `web/app/login`, `web/app/signup`, `web/app/account` and
    the header's account button (`components/NavAccount.tsx`) were removed.
  - Kept, with their links pointed at the app instead of the website's sign-in: forgot-password and reset-password
    ("Back to the oovi app" → `/m/login`, which a browser turns into the download page), verified, unsubscribe,
    privacy, terms, refund, pricing (its free card says "Get oovi, free" → /download), welcome (after a payment),
    download, changelog, experts, the console. Wording: "Settings in the oovi app".
  - Signing up happens in the apps: the phone's sign-in screen has "Create one" (name, email, 8+ character password,
    18+ and the terms with `TERMS_VERSION`, the first-touch header, then the 6-digit email code), same calls as the
    website's old form. The desktop already signs up in the app.
  - Pilot and feedback without a website sign-in: `POST /api/v1/app-links {purpose:"pilot"}` (signed in, same-host,
    rate-limited) answers a single-use link `/pilot?t=<token>` (`web/lib/app-links.ts`: only a SHA-256 of the token
    is kept, 30 minutes, used once when the request is saved; table `app_links`). `/pilot` reads who it is for from
    the website session or the link (`web/lib/app-link-user.ts`), and its form sends the token back; without either
    it says to ask from the app. The phone's Settings "Join the pilot" and the desktop's credits panel
    (`app/api/app-link`, `components/Credits.tsx`, falls back to the plain link for older websites) ask for it.
    Feedback: the phone's Settings "Send feedback" posts to `/api/v1/feedback` (the desktop already does); `/feedback`
    without a website session says to send it from the app.
  - NOT changed (another session builds paying from the app): `app/pricing/PaddlePricing.tsx` still sends a
    signed-out visitor to `/login?next=/pricing`, which now lands on /download; the phone's "Manage billing" posts to
    `/api/billing/portal`, which now only returns to `/m/settings`. It works once part W (the cloud API, branch `cloud-web`) is deployed and part A
(the desktop's sync) uploads chats; until then it shows "Not synced yet" with the 3 steps.
- Look (owner, 2026-11-19: "a unique identity, not a copy of Apple"): the website's own language. Warm paper
  (#FBFAF7, dark #151513), Nunito in heavy weights (Tajawal for Arabic), ink-black pill buttons, white cards with
  warm borders and 22px corners, the logo's pastel pebbles as the color system (settings icons on pebbles, unread
  counts, the switch's yellow pebble, swipe actions), bots' faces shown bare (no
  tile or frame, owner 2026-11-19), small heavy Nunito section labels (no handwriting: owner found it not
  professional), the sparkle doodle on titles, the slimes in empty states and sign-in, each bot's replies washed in its
  own face color, three hopping pebbles while loading. Kept from good platform practice: 44 pt targets, safe areas,
  springy motion, Dynamic Type sizes, light/dark.
- ONE LIST, NO TABS (owner, 2026-11-19, review after 99e2d48): no tab bar, no Bots screen, no Settings tab. The
  chat list holds everything: chats (pinned, then newest), then each bot and group with no chat yet under "Start a
  chat" (its role or members). At the top "+ Group" and "+ Bot" like the computer, and a pen (New chat: pick any bot
  or group). "+ Bot": a one-word name (used for @mentions, unique), a role, a face (shuffle); "+ Group": a name and
  its bots (the first leads). Both are written to the account's setup (`PUT /api/v1/setup`, read-merge-write, 409 →
  read again; `bot:<12 hex>` / `group:<12 hex>`, the computer's own item shapes in `lib/setup-sync.ts`), the new
  chat opens at once, and the computer sets them up at its next setup sync (a few minutes). Delete is in the row's
  swipe and long-press menu, asks first, then `DELETE /api/v1/cloud/chats/<id>` (all devices); a group is also
  removed from the setup (like deleting it on the computer); a bot with no chat has nothing to delete (its chat
  starts again). The person's picture (or initial) sits top right where the pen was, and opens Settings (Settings
  has a back button to Chats). Old `/m/bots` and `/app/bots` links land on the list.
- THE WEBSITE OPENS THE WEB APP, THE ACCOUNT PAGE IS IN SETTINGS (owner, 2026-11-19, contract 160a66a): signing in
  (website `/login`, `/signup`) lands on `/app` (a new account: `/app?welcome=1`, a "welcome" toast); signed in, the
  site's header button says "Open oovi" → `/app`; `/account` redirects to `/app/settings` (keeps Paddle's
  `?billing=none|unavailable`; `?welcome=1`). Everything the account page had is in Settings, with the same server
  checks: the account row (picture, name, email) opens Settings → Account (`_ui/AccountScreen.tsx`: photo upload
  /change/remove and name via `PATCH /api/v1/me`, email shown, password via Better Auth `changePassword` with the
  current password and other devices signed out, News by email, delete account via Better Auth `deleteUser` with
  the password, then the browser's copy is wiped and the home page says deleted). Settings itself: "Confirm your
  email" with Send again (`/api/v1/auth/send-verification`, only when mail can be sent), theOovi credits (plan with
  its end date, pilot request/pending, get more credits, send feedback), Billing (status; "Manage billing" posts to
  `/api/billing/portal` → Paddle's portal, which now returns to the Settings it came from, `/app/settings` or
  `/m/settings`, nothing else; free plan → See plans; Paddle note and refund policy). New `GET/PATCH
  /api/v1/account` (signed in, own account only; billing status only, never Paddle ids; news on/off; same-host
  check on PATCH). Wording on refund, privacy, terms, pricing, welcome, verified, pilot and unsubscribe pages now
  points to Settings in the web app. The old account page's components were removed.
- TAP A FACE TO EDIT, AND THE COMPUTER'S CHAT TOOLS (owner, 2026-11-19: "on the web and the mobile, tapping a bot's
  picture should open editing it; other buttons are missing; add what's missing"). A bot's face (list row, chat
  header, beside its messages) opens its editor (`/m/bot/<id>`, `/app/bot/<id>`, `_ui/Editors.tsx`), a group's face
  or header opens the group editor (`/group/<id>`). Bot: name (one word, unique), role, role description,
  instructions (an expert's stay private, as on the computer), look (color, body, hair, eyes, cheeks, mouth, nose,
  on the head, on the face, "Your picture": cut to 256 px PNG, `POST /api/v1/avatars`, `face.image` = its id),
  Make Chief (`main`), hide, web search, browser, signed-in accounts, where its chats live, delete (asks; it leaves
  its groups like `lib/store.ts` deleteBot, its 1:1 chat is deleted everywhere). "Control this computer" and "Files
  on this computer" are shown as "On your computer". No model or key choice. Group: name, members, leader, leader
  mode, delete. Saves change only the edited fields of the account's setup items (`GET`/`PUT /api/v1/setup`, 409 →
  read again and apply again; model, connectors, expert id and the rest kept), in the computer's item shapes.
  Audit of the computer's chat UI (components/ChatView.tsx, Sidebar.tsx, CommandPalette.tsx, Canvas.tsx,
  Routines.tsx) against the phone and web app:

  | On the computer | Phone and web |
  |---|---|
  | Find in this chat | Added (chat menu ⋯; Enter / Shift+Enter next and previous, Esc closes) |
  | Pin / Unpin | Added in the chat menu (already in the list's swipe and long press) |
  | Download this chat (Markdown) | Added, made on the device from the synced chat like `chatMarkdown` |
  | Edit bot / Edit group (header) | Added: the header, the faces, and the chat menu |
  | Delete group | Added (group editor and chat menu); any chat can be deleted from the list |
  | Rename group | Added (group editor) |
  | Clear conversation | On your computer (shown disabled: it changes the computer's copy and closes its browser) |
  | Canvas (work tables, notes, charts) | On your computer (shown disabled: kept in `work/<id>.json`, not synced) |
  | Live view (the bots' browser) | On your computer (shown disabled) |
  | Project folder | On your computer (shown disabled) |
  | Message: Reply, Copy | Already there |
  | Message: New chat from here | On your computer (shown disabled: only the computer creates chats) |
  | Message: Good reply / Not good | On your computer (shown disabled: rating teaches the bots on the computer) |
  | Learned card (correct / forget), Save as skill | Not applicable here (the computer's learning) |
  | Files a bot made: Open / Show in folder | On your computer |
  | Composer: effort, Plan, Deep work | Added ("+" menu, per chat, sent with the message: the computer's job runner accepts them) |
  | Composer: attach files | Coming soon (files are not synced yet) |
  | Composer: @mention, / commands, idea chips | Not added (type @Name; commands run on the computer) |
  | Approval, plan and question cards, Stop | Already there |
  | Sidebar: + Group, + Bot, search all chats, Pinned / Groups / Bots | Already there |
  | Sidebar: show hidden bots | Added: "New chat" lists hidden bots under "Hidden bots" |
  | Routines | Added, read-only in Settings (name, when, which bot); pause, resume, run now and edit stay on the computer (`enabled` is not in the setup item: a routine from another computer arrives paused) |
  | Marketplace | Added: a Settings link to the website's `/experts` |
  | Command palette (Ctrl+K) | Not applicable (navigation only; the list and search cover it) |
  | Notifications | Not applicable yet (no push on the phone app) |

- WEB VERSION (owner, 2026-11-19, contract 9e27545): the same app in any browser at `/app` (`web/app/app/`: its
  own layout, the pages re-export /m's; links go through `web/app/m/_lib/route.ts` so each version stays itself).
  Signed-in only: every API call checks the session; a signed-out visitor is sent to the website's sign-in page
  and back (`/login?next=/app/...`). Not installable (no manifest or offline worker: installing is the phone's /m).
  On wide screens (900 px and up, /app or /m on a tablet) it reads like the computer app (owner, 2026-11-19;
  `_ui/WideFrame.tsx`, modelled on `components/Sidebar.tsx` and `ChatView.tsx`): a sidebar (logo, the person's
  picture → Settings, "+ Group" / "+ Bot", search, Pinned / Groups / Bots with compact rows, the desktop card at the
  bottom) and on the right the open chat, Settings or a connector, or a quiet welcome; the open row is marked. A
  chat's header gives the name and who is in it (a bot's role, a group's members); a bot's message has its face at
  the top and a line with its name, its role and the time, like the computer; messages and the box sit in a column
  of 820 px. On a narrow window or a phone's browser `/app` is one column with the same web look (logo, picture,
  "+ Group" / "+ Bot", Pinned / Groups / Bots), then the chat full width with a back button (not the phone app's
  large titles). Keyboard: Enter sends, Shift+Enter is a new line, Esc closes a
  menu, then a reply, then the chat. On the web, Settings says "This browser".
- The desktop app, suggested gently (same decision; `_ui/Desktop.tsx`, ar/fr/en): a small card in the chat list
  that can be hidden for good, a card in Settings, and under "This needs your computer" the owner's line ("The
  desktop app does more: it works on your files, uses your computer and its browser, runs local connectors, and
  lets you use your own AI keys.") with a Download button to the website's `/download`.
- Where: `web/app/m/` (screens in `_ui/`, pure helpers in `_lib/`, look in `m.css`), `web/public/m/` (manifest,
  icons, 22 iPhone launch screens, offline worker `sw.js`), one header in `web/next.config.mjs` (lets the worker
  serve `/m`). Icons and launch screens: `node web/scripts/mobile-icons.cjs`.
- Screens: Chats (messenger habits: newest first, pinned on top, unread counts, swipe for Read/Pin and Archive,
  long press for the same, "Archived" at the top, search inside messages, pull to refresh, the bot's live work in
  the row); Chat (Markdown with tables and safe links, time and ticks in bubbles (one tick sent, two delivered,
  yellow when answered), the bot's live status from `GET /events` incl. "typing…", long press Reply/Copy, swipe a
  message to reply (sent as `replyTo`), "+" (voice note; photos and files say "coming soon" because files are not
  synced yet), the end button is Send / Stop / microphone like WhatsApp, voice note to text through
  `/api/v1/ai/transcribe` (the text lands in the box to check), Allow / Not now, question and plan cards,
  "This needs your computer"; computer-only bots have no box); Settings (account, theOovi credits, devices, sync and space, language, look, Add to Home Screen help, sign out);
  Connectors, managed from the phone (owner's decision, contract 1f0f147): on/off in the list, a connector's page
  (bots that use it, sign in / again / out, its key, remove), "+" adds one from the catalog (built-in list +
  published Marketplace, hidden ones out), sign-in through the website (opens the service; back at
  `/m/connectors?connected=…`; when it came back in another browser, e.g. iPhone Home Screen → Safari, the app
  finishes it when it comes to the front: GET /vault `pending` → POST `oauth/finish`; every error in plain words).
  Its own sign-in page (`/m/login`) uses the website's sign-in.
- Rules kept: never asks for or keeps an AI model key (a key that looks like one is refused on the phone and by the
  website); connector keys and sign-ins are never shown or stored on the phone (only name, on/off, bots, signed in
  or not); the phone keeps chats without tool results in the browser's storage (opens at once, works offline);
  sign-out, or another account signing in, wipes it.
- Follows part W's real shapes (`web/lib/cloud-types.ts` on `cloud-web`, read there, not merged): events with
  jobs and `jobsAfter`, tombstones, `sync_off`/`busy` codes, vault, sign-in start/finish. What the phone sends is in
  `docs/CLOUD-BUILD.md`, "Changes to this file" (job payloads incl. `replyTo`).
- Screenshots (iPhone 15 size, stand-in data, `docs/mobile/*.jpg`): `en-light-*`, `en-dark-*`, `ar-light-*`,
  `ar-dark-*` for chats, chat-approval, chat-live, needs-computer, group, new-bot, settings, connectors, connector,
  connector-add; plus chat-composer-voice, not-synced and sign-in in light; a tablet (the Android app on a
  wide screen) at 1440×900: `tablet-{en,ar}-{light,dark}-{chat,group,chats,settings,bot-editor}.jpg`. Made with
  `node tests/e2e/mobile-scenario.cjs --shots-only` (website built first).
- Checked here (Linux, Chrome emulating an iPhone 15, the BUILT website behind a stand-in for W's API,
  `tests/e2e/mobile-standin.cjs`): `npx tsc --noEmit` (web and root) clean; unit tests 425 (424 pass, 1 skipped:
  the existing live YouTube test), of which the phone's `tests/unit/mobile-*.test.mts`; `npm run build` in web OK;
  `node tests/e2e/mobile-scenario.cjs` 182/182, twice in a row (an ordinary browser gets /download for /m, /app,
  /login, /signup, /account; no account button; the kept pages open; in the app every account action, Join the pilot
  through a single-use link, Send feedback, creating an account with the email code;
  tap a face: bot and group editors saved after a 409, picture, hide, delete; find, download, pin, the computer-only
  tools shown as such, effort and plan sent; routines; sign-in, sync off and API missing, list and counts, archive, pin,
  search, Markdown and safe links, approval → decision job, send → live status by long-poll → answer, ticks,
  reply, Stop, needs-computer, queued while off, voice note with a fake microphone and with the service off, the
  one list with a bot to start, profile picture → Settings and back, + Bot (one-word and unique name, saved after a
  setup conflict), + Group (its first message goes out and is answered), delete asks first then removes it everywhere,
  the old Bots link,
  every connector flow incl. the other-browser sign-in, AI key refused, no secret on the page or in storage,
  no sideways scroll at 320 px on 11 screens, Arabic right to left, offline from the worker, account switch
  wipes the old copy, sign-out asks then wipes; the web version: the sidebar with Groups and Bots and + Group / + Bot,
  the open row, name/role/time above a bot's message, profile picture → Settings beside the list, Shift+Enter / Enter /
  Esc, the desktop suggestions and hiding the card, connectors beside the list, signed out → the website's sign-in);
  `node tests/e2e/mobile-lighthouse.cjs` (Lighthouse 11.7.1): accessibility 100, best practices 100 and PWA 100 on all 11 phone
  screens tested (with the app's user agent), incl. Account, the bot and group editors (the web version is not installable on purpose).
- NOT checked: a real iPhone or Android phone (Safari, Add to Home Screen, the keyboard, the microphone, Dynamic
  Type, safe areas: the emulation has none), the real cloud API on Vercel (W is not deployed), the real desktop
  sync (A), a real OAuth service, Firefox, a real Groq/OpenAI voice key.
- For the owner, after W is deployed: on the iPhone, open `https://oovi.conuron.com/m` in Safari, sign in, tap
  Share, then "Add to Home Screen", then "Add". On Android (Chrome): the same address, menu ⋮, "Install app".

## Harness fixes after 0.12.3 (branch `harness-fixes`, NOT RELEASED)
- Old topics brought back in every reply (owner's chat: "remind me in 10 minutes to turn off the oven" at 10:46; at 15:12 and 22:39 the bot still asked "did you turn the oven off?", and read "كيف نقدر نجيب" after a VPS question as "how to get clients"). Cause, verified: bots saw no clock at all, only today's date (`systemPrompt` in `lib/orchestrator.ts`; `viewFor` sent user messages without time), so a 10-minute matter looked fresh 12 hours later, and nothing said that earlier topics are closed. Now every user message carries its local time and, after 30 minutes or more of silence, the gap ("[oovi: sent Wed, 18/11/2026, 22:39, 11 hours after the previous message]", `lib/time-note-core.ts`; built from saved times, so the prompt cache holds). New FOR_THE_USER rule: answer the latest message; a past reminder, offer or unanswered question stays closed unless the user reopens it; short-lived things are over once their time passed. LANGUAGE: an unclear word takes the meaning of that same message, not memory or older topics. Texts shortened elsewhere to fit the cost job: 169,983 of 170,000. `tests/unit/time-note.test.mts`, routines scenario G (18/18). NOT checked with a real model. The 15:09 "5 messages" and the reminder that went to a separate chat in the same conversation were already fixed in 0.12.3 / 0.12.2.

## 0.12.3 (released 2026-11-18, owner said "build the version and publish it, minor update")
- One answer per question (owner: 5 messages for "anything new in my email or calendar?", long waits, "correction: I told you before…"). Causes: the done-check's extra rounds each posted a new message and the bot thought the user had read its draft; optional offers ("shall I draft a reply?", "shall I check again?") counted as unfinished; the bot answered from snippets before checking. Now: an extra round continues IN the same reply (`pending.continueIn`, `BotEntry.held`; the draft stays in the steps for the model, the user sees only the final text; the bot is told the user never saw the draft, `UNSEEN_DRAFT`); offers of extras are "done" (`DONE_CHECK_SYSTEM`); ordinary requests get one extra round at most (big jobs keep 4); rule "look everything up first, then answer once" in FOR_THE_USER. bigjob scenario K (42/42). Cost job 169,901 (safety CAPTCHA bullet shortened to fit). NOT checked with a real model on a real inbox.

## 0.12.2 (released 2026-11-18, owner said "build the version and publish it, minor update")
- Reminders (owner's screenshot: "remind me in 10 minutes here" ran in a separate routine chat, answered "I can't send it to your phone", nothing arrived): `propose_routine` with `reminder` (frequency once; `isReminder` in `lib/routines-tools.ts`), no card, no AI run at the time: the text is posted in the chat where it was asked (`postInChat` in `lib/routines-scheduler.ts`, waits for a running reply to end) with a desktop notification; asked from Telegram, it goes back to Telegram too (the owner: "here" can be Telegram). Routine fields `postTo`, `remind`, `postTelegram` (`lib/types.ts`). A one-time task (propose_routine once) posts its result back in the chat too. Routine runs are told their reply IS what the user gets (no "here's the reminder", no "I can't send it"). routines scenario E-F (16/16), telegram scenario.
- Zapier errors: an error about the inputs ("expected record, received string", "required", "invalid input") now tells the bot to call inspect_zapier_actions and retry with the exact fields, instead of "the app isn't connected" (`zapierNextStep`). execute_zapier_*_action gets `instructions`/`output` filled when missing and `params` turned from JSON text into an object (`completeZapierRun`). Schema from a third-party doc of Zapier's MCP (Scalekit), NOT checked with a real Zapier account. Problem report titles now show the error after oovi's "Result from … MCP server" line (`lib/run-report.ts`), so the next report shows the real cause.
- Cost: the 34-step cost job is at 169,964 (limit 170,000) after this: tool texts were shortened to fit (a separate set_reminder tool cost +2,500). Little room left: shorten something before adding tool text.
- Home: the "Your first hour" card is removed (owner didn't like it; it showed "Connected" just because the Chief has the accounts ability).
- Connections never say "connected" before a real check (owner: "everywhere, not only Zapier"): Marketplace cards show Checking… (spinner) while signing in or testing, Connect when not signed in, Fix on error, a check only when signed in and answering (`connState` in `components/Marketplace.tsx`; before, any added connector showed a check). The detail sheet has Disconnect (signed in) or Remove connection. AI model keys are checked with the provider before they are saved and called connected (`lib/key-check.ts`, `POST /api/settings/check`: the model list, OpenRouter's key page; never a paid call). Zapier apps can be removed one by one (× on the chip, Zapier's disable_zapier_action; the app stays in the user's Zapier). Telegram's Disconnect asks first. Already there: Telegram waits for Start before "connected", Disconnect on connectors and AI providers, sign out of all sites (bots' browser), saved logins Remove. zapier scenario E-F; Marketplace checked in a browser.
- Tables: `work_table` action `replace` (owner's report "replace the old team; the Canvas still showed the old team": `add` only fills empty cells of rows with the same name). The old version stays in the Canvas history. The Canvas reloads the moment the bots finish. telegram scenario check.

## After 0.12.0 (built 2026-11-18, NOT RELEASED: the owner said not to build the next version yet)
NEEDS A WEBSITE DEPLOY (owner says "deploy"): AI pictures (`web/app/api/v1/ai/image`, Admin > theOovi > AI pictures). Then the owner adds a free Cloudflare account's Account ID and a "Workers AI" API token there.
- Approval cards in plain words (owner's screenshot: 'Use the "enable_zapier_action" tool of Zapier with {json}'): connector actions read "Send an email in Gmail / To: … / Subject: …" in the user's language (`lib/action-words-core.ts`), Zapier's enable action reads "Let your bots use Google Tasks (turned on in Zapier)"; tool name and raw data only under "Show details" (closed); page elements read 'the button “Envoyer”' (never "element 12"). `tests/unit/action-words.test.mts`, approvals scenario, screenshots in English and Arabic.
- Fewer cards, same safety (`lib/approval-scope-core.ts`): "Allow for this chat" (same site in the bots' browser, or the same connector action), "Always on <site>" (Settings > Safety lists and removes them). Never coverable: saved passwords, files leaving the computer, deleting, the computer's mouse and keyboard. A connector send without a fresh card waits 8 s with Cancel (`lib/hold.ts`). approvals scenario (real MCP connector run in the test, 16 checks) + form scenario F.
- Zapier "Your apps" (`components/ZapierApps.tsx`, `lib/zapier.ts`): on the Zapier page, the apps ready for the bots, one button per app opening Zapier's own page to connect it (manage_zapier_connections, inputs read from the live schema), "Use all my Zapier apps" (auto_provision_mcp). Zapier's read actions no longer ask. A Zapier action failing with no reason gives the bot the usual cause and sends the user to Your apps. Tested with a stand-in using Zapier's documented tool names (zapier scenario); Zapier doesn't document the inputs or error texts, so NOT checked against a real Zapier account. The owner's admin problem report ("execute_zapier_read_action failed", Linux, 0.12.0) only shows "Tool error": its real cause can't be seen from here.
- Replay recorded skills (`lib/replay.ts`, tool `replay_skill`): a skill recorded by showing keeps its steps (replay.json in the skill's folder; not synced between PCs yet); bots run it by code (elements found by role and words, other values for the fields, passwords never replayed), stopping at the first step not found. Form scenario G.
- Cost checks: page screenshots are never sent to the AI (files only, shown to the user): kept. More than 15 connector tools are sent on demand (`lib/tool-defer.ts` MANY_CONNECTOR_TOOLS): a 34-step job with 60 connector tools went from 225,374 to 177,476 weighted tokens (cost scenario with OOVI_COST_MCP=60); the normal job is 167,844.
- AI pictures (free): `create_image` with `photo.ai_prompt`, and the new style "picture" (just the picture), use oovi's AI pictures when the user has no OpenAI/Gemini key: FLUX.1 schnell on Cloudflare Workers AI (`web/lib/imagegen.ts`). Cloudflare's free account: 10,000 neurons a day, about 200 square pictures for all users together (Cloudflare's published rates); above that, pictures stop until midnight UTC unless the account is put on Workers Paid (about $0.0006 a picture). Credits charged at cost. Sexual, nude and gory descriptions are refused (`web/lib/imagegen-core.ts`, a word list: basic, not a full safety system). Tested with a stand-in website; NOT tested with a real Cloudflare account.

## Next big version (0.12, built 2026-11-18, NOT RELEASED: the owner adds more fixes first; no version number bumped)
Tier 1 and Tier 2 of `docs/COMPETITORS-2026-11.md`, on branch `next-version` (also pushed to `main`). Each line: what, where, how it was checked. "Stand-in" = scripted model and local test pages, no real model.

WEBSITE DEPLOYED 2026-11-18 (owner said "deploy"; production checked: home 200, unknown shared page 404 with noindex, pages and transcribe answer 401 when signed out, an unknown routine address 404). Website parts: routine web addresses (`web/app/api/v1/hooks`, `routine-hooks`), speech to text (`web/app/api/v1/ai/transcribe`, Admin > theOovi > Voice notes key: the owner pastes a Groq or OpenAI key there), shared pages (`web/app/api/v1/pages`, public page `/p/<id>`, table `public_pages` created on first use and in `scripts/migrate.mjs`). Without the deploy these three features answer with an error in the app; nothing else breaks.

Harness and cost
- Instructions stay identical between messages: lessons, matching skills and /commands travel with the user's message (`perMessage` in `lib/orchestrator.ts`). Loop guard (`lib/loop-guard-core.ts`): the same call 4 times, or the same failure twice, is refused with a next step. Answers cut at the length limit are continued and joined (`lib/continue-core.ts`). A reply that ends on a promise ("I'll search now", "je vais", "سأبحث", "rani nhawes") is sent back once without the paid check (`lib/promise-core.ts`). Tool inputs repaired to their schema, failures carry "Next step:", old results keep start and end (`lib/arg-repair-core.ts`). Cost scenario: 166,738 weighted tokens for the 34-step job (limit 170,000; was ~161K before `run_helpers` was added to the tools).
- Write while a bot works (`lib/steer.ts`): the message waits for the bot's next step; Telegram says it was received; a message sent before Stop starts the next run. Long chats are summarized right after a run. `steer-scenario`.
- Background helpers (`lib/helpers.ts`, tool `run_helpers`, bots that can search): 2-5 independent parts run at the same time with only lookup tools and the chat's work files, fresh context, max 14 steps each, short reports back; their cost is added to the bot's message. `helpers-scenario` (stand-in): parallel, tools limited, rows land in the table, credits counted. NOT checked with a real model: whether bots choose it at the right moments.

Routines, money, safety
- Routines v2: once, every 15/20/30 minutes (with hours), quiet runs that post only news (NO_NEWS), a watched page checked by plain code before the run, routines started by a web address (relayed through the website, 60 calls/hour). `routines-scenario` (11), web part tested on a throwaway PostgreSQL.
- Spending limits (Settings, per day/month, credits and dollars) and a routine run stopped at 3x its usual cost (`lib/spend-core.ts`). "Not confirmed" mark on replies that claim a send/post/booking/payment with no action behind it (`lib/receipts-core.ts`).
- Saved logins and 2FA codes (Settings > Saved logins, encrypted on this PC, `lib/logins.ts`, tool `fill_login`): oovi types them, the bot never sees them, each sign-in asks. Connector actions that only read no longer ask (`lib/action-kind-core.ts`). After reading outside pages, saving to memory asks. `form-scenario` D.
- Memory per bot (`memory` target "mine"), a fact about the user must use the user's own numbers/emails/links (Arabic digits count), every memory change in a journal with Undo (Settings > Memory > Changes, `/api/memory/journal`). `helpers-scenario` B-D. NOT built from Tier 2 #13: saving after a chat goes quiet, nightly tidy.

Browser and voice
- `browser_steps`: a whole form in one call; elements that appear after an action are marked NEW. `form-scenario` A-C.
- Teach by showing (`lib/teach-core.ts`, Live view > Take control > Record steps): what the user opens, clicks, types and presses becomes plain steps and a skill draft they edit and save. Passwords and code fields are never kept; addresses lose tokens. `form-scenario` E + `tests/unit/teach.test.mts`. Typed text is kept in memory only while recording.
- Voice: Telegram voice messages answered; microphone in the message box (text lands in the box to check). Mac microphone permission text added. NOT checked: the Windows Store package's microphone permission, a real Groq/OpenAI key.

Chat
- Find in a chat (Ctrl+F), search all chats from the sidebar (Ctrl+Shift+F; case, accents, Arabic vowel marks and letter forms), reply to a message (quoted to the bot as "[Replying to …]"), copy text, new chat from any message (copies listed under Copies; the original unchanged; work files copied), pin (works while bots work; `pins.json`), download a chat as Markdown, Ctrl+K to go anywhere, maths with KaTeX (`katex` 0.19.1 added; `$5 and $10` stay text). Charts a bot makes show small in the chat. `chatbasics-scenario` (23) + browser check here (19/19 and screenshots). Emoji reactions were not added: thumbs up/down already exist.
- Share a Canvas page by a public link (notes or tables; Canvas > Share): the site builds the page from plain text and rows, everything escaped, not indexed (`web/lib/public-pages-core.ts`, unit-tested against script injection). Update keeps the link; Stop sharing removes it; renamed pages keep it; deleting the page or chat stops sharing. 200 pages per account. Admin can hide a page only with SQL for now (`UPDATE public_pages SET hidden = true WHERE id = …`): no admin screen yet.
- First hour on Home (`components/FirstHour.tsx`): connect email/calendar (Zapier, or the Chief's signed-in browser), then one click asks the Chief for up to 3 draft replies and today's brief, drafts only. Checked in a browser with a stand-in. NOT checked with a real Zapier/Gmail account.

Languages
- `tests/unit/multilingual.test.mts`: one table of real-style messages per rule (reply language, sent claims, promises, numbers, search) in Arabic, Darija (Arabic and Latin letters), French, English. It found and fixed: Darija in Latin letters ("3tini", "wach t9der") got French replies (now Darija, `isLatinDarija` in `lib/text-locale.ts`), "تم إرسال" and "b3athtlek" claims were missed, "rani nhawes" promises were missed, Arabic-digit phone numbers were refused. Add a line there for every message a rule gets wrong. Which TOOL a bot picks is decided by the model, so it can only be tested with paid model calls: not built.

Checks run for this version (2026-11-18, cloud copy, Linux): tsc (app and web) clean; unit tests 311/311; app build OK; every scenario passed on the final build: group 34, spec 37, phase1 11, bigjob 41, parallel 18, telegram 9, telegram-relay 13, sync 15, upload 10, list 64, cost 11 (166,738 weighted), onboarding 12, steer 9, routines 11, form 16, helpers 14, chatbasics 23. Browser checks with screenshots (light and dark): chat basics 19/19, inline chart and share menu, first hour 6/6. Website pieces: unit tests and a throwaway PostgreSQL; the website itself was not built or deployed. Windows/Mac/Linux CI: run 28 of "Tests on Windows, Mac and Linux" (commit 250c1f0) passed on all three: tsc, unit tests, build and every scenario. NOT checked: a real model on the new features, real Gmail/Zapier, a real Groq/OpenAI key, Safari/Firefox, Windows and Mac by hand.

- Admin > Users > an account > "Correct the email address" (website only, NEEDS A WEBSITE DEPLOY; `correctEmailAction` in `web/app/admin/users/[id]/actions.ts`): for an address typed wrong at sign-up. Why it exists: Abdelaziz's account had `abdelaziz_benkirat2014@gmail.com` (underscore) while his real address is `abdelaziz.benkirat2014@gmail.com` (dot); the confirmation email never arrived, the owner confirmed the account by hand, and the "Please update" email then bounced (550 5.1.1). The action lower-cases and checks the new address (not the same, not used by another account), changes it, KEEPS the account's confirmed status (the owner knows the person), writes `email.correct` (from, to) to the audit log and sends ONE short notice to the NEW address only (`emailChanged` in `web/lib/mail-templates.ts`: "the email address of your account was updated: old -> new. Sign in with the new address from now on."). No code, no confirmation link, nothing else (owner's wish). Tested on a throwaway PostgreSQL with the built site and a local mail sink: refused (not an address, same address, taken address), the fix, the audit row, still confirmed, exactly one email to the new address only (old and new named, no code), signed-out visitor 404. Not tested: Safari/Firefox, a real Gmail inbox. Caveat: the new address is not proven by a click, so if it is wrong the notice bounces and the person keeps a dead address: check it was copied from a message they sent.

- Private experts (APP + website; NEEDS A NEW APP VERSION and a website deploy; not released): a Marketplace item can be marked `protected` (Admin > Marketplace > the item > "Private expert"; Abdelaziz Benkirat is). Then (1) the app never shows its bots' instructions: not in the Marketplace details ("Its instructions are private"), not in Edit bot (role and description locked, no instructions box), not in `/api/bots` or `/api/catalog` answers (`forScreens`, `lib/experts-core.ts`), not to other bots (`botDirectory`), and the bot is told never to reveal them (`lib/orchestrator.ts` systemPrompt); the editor cannot change role, description or instructions (`updateBot`). (2) Bots people ALREADY added follow the catalog: each time the published catalog is fetched (every 5 minutes while oovi is used) `syncExperts` (`lib/experts.ts`) sets role, description and instructions from the catalog for the bots recorded in `plugins.json`, and marks them (`Bot.expert`); the user's name, face, model and abilities stay. Offline or unpublished: nothing changes. Unticking "Private expert" unlocks them. (3) The built-in text of a private expert is no longer in `lib/catalog.ts` (that file is part of the screens' bundle): it is in `lib/expert-prompts.ts` (server only; the unit test fails if a component imports it), and `scripts/sync-web-catalog.mts` puts it into the console's snapshot. Abdelaziz has a new character (no catchphrase, asks before coaching, teases unproven claims, declines to do the founder's work and points to the team leader, lean startup and design thinking as lenses, no fixed language or country) and a new description line: the old line "Coffee first, then we fix your startup" was in every prompt (`about`, systemPrompt) and the bot opened with it. LIMITS, told to the owner: this hides the text in the app; it is still in the public `/api/v1/catalog` answer and in `bots.json` on the user's computer, so a technical person can read it (real protection = keep it on theOovi's server, not built). App versions before this one keep showing instructions and do not update old installs. THE OWNER'S DATABASE COPY WINS: if Abdelaziz was copied into `catalog_items`, tick "Private expert" there and paste the new instructions, or press "Use the app's version" after the deploy. Tested: `tests/unit/experts.test.mts` (11), whole unit suite 231/231, tsc (app and web), app build (the private text is in server chunks only, not in `.next/static`), and in a browser with the built app and a stand-in catalog server: add the expert, API answers, a refused edit, Edit bot, Marketplace details, then a bot rewritten as an old install got the new role, description and instructions after a restart; group-scenario 34/34, onboarding-scenario 12/12. Not run: the other e2e scenarios, the real model (does it keep the character and refuse to reveal it), Windows/Mac.

- Admin > Marketplace is grouped and has pictures (website only, NEEDS A WEBSITE DEPLOY): the list is on the same shelves as in the app (Experts = one bot, Teams, connectors by category, skills by category; `web/lib/catalog-groups.ts`), each group with its count and in the app's order. Each row shows what people see: an expert's or a team's faces (the site's own `Face`, uploaded pictures included), a connector's logo (its own `logo`, else the app's logo: `web/lib/builtin-logos.json` and `web/public/logos`, both written by `node scripts/sync-web-catalog.mts` and checked by `tests/unit/web-catalog-sync.test.mts`), a letter tile for a skill, plus the start of the description. Every action is where it was (order, publish, edit, hide, use the app's version, delete, make all editable); the filter reads All / Connectors / Skills / Experts & teams. Tested on a throwaway PostgreSQL with the built site in a browser: 17 groups, 104 rows, faces drawn, 66 logos and none failing, Edit on the expert (copied with "Private expert" on and its private text), the Connectors filter, Hide, Make all editable, no sideways scroll at 390px. Not tested: Safari/Firefox.

## Bringing people to the latest version without a new release (2026-11-15)
- Admin > Users > "Ask to update": emails everyone whose app is older than the latest release (web/lib/update-ask.ts, template updateAsk, preview "update" in Admin > Email). Once per person per version (admin_audit "update.ask"), blocked accounts and unconfirmed emails left out, 150 per press. Mac people get "download"; Windows people get "click Update" + the Microsoft Store way.
- Admin > theOovi > "Minimum app version": apps older than it get, instead of a theOovi answer, a message (Arabic, French or English, from the person's last message) asking them to update with the download link (HTTP 426, code update_required; old apps show the server's text as it is, checked in 0.10.6's code; not retried). Own API keys keep working. web/lib/versions.ts (tests/unit/versions.test.mts). Never set it to a version released the same day (Store delay).

## First run v2 (2026-11-15, owner's review: "simple, practical, personal"; "I may just want to explore")
- Two screens (components/AccountGate.tsx): 1) Chief: "Hi {name}! Choose your Chief" (name from sign-up; no photo/name step; theOovi set up by itself); 2) "What are you curious about? nothing is fixed": goal chips + "something else", and the suggested team appears and updates live below (only the best fit ticked); "Create my team" or "Skip, I'll explore". Then straight into the app. The "Ready"/first-task screen was removed (it repeated the home screen's ideas, owner's feedback); the home's ideas (ideasFor: at most 2 from the goals, the rest general) do that job. Reopened after the team was made: the app opens directly.
- The Chief's notes say the first interests are only a start, not a limit: follow what the user asks now.
- Marketplace setups' names and descriptions in 6 languages (setup.<id>.name/desc, setupText in lib/i18n/index.ts: used only while the English text is the built-in one, so an admin edit always shows); used in the first run and the Marketplace.
- Funnel: the app reports steps (PUT /api/onboarding → server POST /api/v1/onboarding → app_events kind "onboarding", once per step and user, ids only, not when usage statistics are off). Admin > Overview "First run": chose a Chief, reached the team, created a team / skipped, top goals and characters. NEEDS A WEBSITE DEPLOY to start counting.

## First run, made personal (2026-11-15, not released yet)
- Owner: "instead of three bots and a Studio group and the same leader for everyone, a personalized experience". Onboarding (components/AccountGate.tsx) is now: You (name, photo; theOovi set up by itself, own key in Settings) → Chief (5 characters: calm Oovi, warm Lina, direct Rex, funny Momo, thoughtful Sage; rename, shuffle) → Goals (the Chief asks "what will you use me for?": 10 tappable goals + "something else") → Team (3-4 Marketplace setups suggested for those goals, best two ticked; "Create my team" or "Just me for now") → Ready.
- lib/onboarding-core.ts (pure, tests/unit/onboarding.test.mts): LEADERS, GOALS→setups, suggestSetups (best fit per goal + 1 per other goal; typed words match setup texts; hidden setups never suggested; nothing chosen → classic "Starter team"), leaderNotes (character + goals added to the Chief's instructions).
- app/api/onboarding: GET suggestions (with faces), GET ?mine=1 the goals (home examples follow them: home.idea.g.*), POST applies once (onboarding.json; 409 after): Chief renamed/new face/notes and pinned; the old Scout/Quill/Nova/Studio removed only if untouched and not chosen; setups installed with installPlugin. Seed in lib/store.ts unchanged (tests rely on it). tests/e2e/onboarding-scenario.cjs (9 checks); server.cjs takes OOVI_TEST_ONBOARDED=0.
- Known: setup names and descriptions are English only (as in the Marketplace).

## Sign-up: 18 or older (2026-11-14, owner's choice)
- The sign-up checkbox (app and website) now says "I'm 18 or older and I agree to the Terms and the Privacy Policy" (6 languages). Terms (section 1) and Privacy (12. Children) say 18; TERMS_VERSION and LEGAL_LAST_UPDATED are 2026-11-14 (only new sign-ups are checked against it). Reason: Anthropic counts anyone under 18 as a minor and asks products for minors for extra safeguards. The app's form also shows "At least 8 characters" under the password (the website already did).

## After 0.10.12 (2026-11-14, not released yet): lower AI cost (owner: cache = 71% of the invoice, output = 22%)
- Measured with `tests/e2e/cost-scenario.cjs` (real request bodies of a 34-step research job: 18 pages read and saved over two messages, billed like Anthropic's prompt cache: read 0.1x, write 1.25x). Before → after: cache writes 221,511 → 97,889 tokens (-56%), cache reads 823,628 → 871,701 (+6%), weighted 359,252 → 209,531 (-42%). Same work done (18 rows, same answers).
- Causes found and fixed: (1) `prune` cut the 4th-newest tool result at every step, so the prompt changed there each step and every page was written to the cache twice: the cut line now moves in steps of 4 (PRUNE_KEEP 2, PRUNE_STEP 4); desktop screenshots drop in groups the same way (`pruneDesktopShots`). (2) The instructions changed at every message (work files' counts, Marketplace suggestions for the request), which made the whole conversation be written again: these now go with the user's latest message (`turnNote`, `workNow`, `capabilitiesPrompt({ suggestions })`), and an older message keeps the note it last had (`UserEntry.shown`) so it never changes. (3) read_url default 15,000 → 8,000 characters (more on request).
- Output: routine steps (every step after the first of a message) ask for effort "medium" without extended thinking, unless the user chose an effort or deep work (high). The first step keeps the model's own level (planning). theOovi server takes `thinking: false` (web/app/api/v1/ai/messages/route.ts): THE WEBSITE MUST BE DEPLOYED BEFORE THIS APP VERSION SHIPS, or the old server would add adaptive thinking to medium. Own Anthropic keys: output_config only for models >= 4.6; other providers unchanged. Output saving not measurable without the real model: check Admin > Costs (output tokens per call) after release.

## Next version (0.11, 2026-11-17, not released yet): Canvas, file design, lower cost
- **Canvas** (`components/Canvas.tsx`, `lib/canvas-core.ts`, `app/api/chats/[id]/canvas`): pages beside the chat (plans with tick-boxes, notes, tables, charts) that bots fill through `work_table` / `work_notes` and the user edits by hand; history of versions; export to Excel, Word, PDF, CSV, Markdown.
- **File design** (`lib/file-style.ts`, `lib/files.ts`): Excel with a coloured header, stripes written as a rule (they survive sorting), number formats, numbers typed as text turned into numbers (phones, codes and leading zeros stay text), links, right-to-left sheets; Word with a title block, coloured headings, striped tables, tick-boxes, page numbers, right-to-left paragraphs; matching PDF/HTML; larger type and striped tables on slides. `theme` (blue, green, warm, gray) on `create_document` and `create_spreadsheet`. Checked by rendering with LibreOffice and Chromium here; not opened in Microsoft Office.
- **Cost** (`tests/e2e/cost-scenario.cjs`: 211,247 → 160,926 weighted tokens for the 34-step job, 24% less):
  - Tools on demand (`lib/tool-defer.ts`): `create_image`, `create_presentation`, `create_spreadsheet`, `edit_copy_of_file` are sent as one line each inside `use_tool`; the first call returns the tool's guide as a tool result, the next runs it. The orchestrator unwraps calls on arrival and wraps the history when sending, so the rest of the code sees real tool names and the cached top of the request never changes. Tools a bot must think of by itself mid-job (find_places, find_papers, scrape_list, propose_routine) stay in full on purpose.
  - A page read with `read_url` is cut down as soon as the bot has saved to a work file after it (`savedAfter` in `lib/orchestrator.ts`), instead of a few steps later.
  - Not measured with a real model here (stand-in only): watch Admin → Problems for bots that fail to reach an on-demand tool.
- Linux "Control this computer" (X11) is also in this version and still needs a test on a real Linux desktop.

## After 0.10.11 (2026-11-14, not released yet): faster computer use, glow never in the bot's screenshots
- Speed: the last screen-changing action of a turn comes back with a fresh screenshot (`shotAfterId`, `settleMs` in `lib/desktop-core.ts`; `shotAfter` in `runDesktopCall`), after a short settle (250 ms typing … 1.2 s after Enter). Before, every action returned "OK" and the bot needed a second model round trip just to look: roughly half the waits are gone. The bot is told to chain predictable steps in one turn. Older screenshots are still pruned (KEEP_SHOTS).
- "Thinking" pointer: when oovi's pointer hasn't moved for 0.7 s, it sways gently and three dots in the glow colours pulse beside it (only the drawing moves, never the real mouse). Calmer with reduce-motion.
- Glow in the bot's screenshots (owner: "what the bot sees"): it is excluded by Windows content protection from Windows 10 version 2004; on older builds (< 19041) the glow and pointer go see-through for ~60 ms during each capture. Content protection is applied again after showing. Mask code already skipped these windows. Not checked on a real PC.

## After 0.10.11 (2026-11-14, not released yet): fixes from a user's conversation (m3ak prospect list)
- One deliverable, one file: a chat that makes a file again under the same name in Downloads/oovi replaces its own earlier file (registry `made-files.json` in the data folder; another chat's or the user's file is never replaced; a file open in Excel gets a new copy and the bot is told). work_export of the same table goes to the same file even when the bot invents "_FINAL"/"_UPDATED" names (`exports` in the work store; `new_copy` only when the user asks). Instructions tell bots not to make copies.
- Table reads no longer push each other out of view: one read returns at most ~12K characters and says where to continue (`READ_CHARS`, `lib/workfiles-core.ts`). Cause: with theOovi's ~80K-token budget, a 100-row read made older reads shrink to 400 characters (`fitBudget`), so the bot "remembered" rows and retyped them.
- New `work_table` action `columns` (reorder, rename, clear, drop columns without retyping) and `work_export` options `columns` / `empty_columns` (e.g. blank Statut and Note first). Export results give exact filled counts per column, so reports use real numbers.
- YouTube: read_url on a YouTube search page returns the videos with watch links (`lib/youtube-core.ts`); bots open the watch link with open_in_user_browser and it plays by itself, no click (the user's browser ran as administrator, which Windows doesn't let apps click). Autoplay with sound depends on the browser's own rules; not tested on the owner's PC.
- Question cards (`ask_user`, `lib/ask-user.ts`, `components/QuestionCards.tsx`): 1-4 questions, 2-3 options each plus "Other answer", one card after another, Back and "Skip, let the bot decide". Answers go back as the tool result. Writing a message instead closes the cards and counts as the answer. Not offered on Telegram, in routines, to teammates under a leader, or in group runs started by another chat. Sidebar shows "question" instead of "needs OK".

## After 0.10.10 (2026-11-14, not released yet)
- Expert applications (website only, NEEDS A WEBSITE DEPLOY): public form `/experts/apply` (name, email, public profile link, field, bio, languages, optional "known as", a consent statement, a typed-name signature plus a signature drawn with mouse or finger; people who can't draw tick a box and the typed name is the signature). Saved in table `expert_applications` (created on first use by `lib/expert-db.ts`, also in `scripts/migrate.mjs`) with the consent version and its SHA-256, a salted hash of the IP (never the address), the browser string and the signature PNG. Same email again while still "new" replaces the earlier one; after a decision it is ignored; the person sees the same thank-you either way. Honeypot field, 5 tries per 10 min per network, 200 requests per day cap. Admin > Experts: list with counts, detail with the signature image (`/admin/experts/signature/<id>`, admin-only), Accept / Decline / Put back to New with a note (audit `expert.accept|decline|reopen`), CSV `expert-applications` (no picture; Admin > Reports and the button on the page). Accepting publishes nothing: agree the details in writing, then add the expert in Admin > Marketplace. New notification event "New expert application" (on by default, Admin > Email). THE CONSENT WORDING (`CONSENT_TEXT` in `web/lib/expert-form.ts`, version `CONSENT_VERSION`) IS A PLAIN-LANGUAGE DRAFT, NOT LEGAL ADVICE: have a lawyer read it before relying on it as proof; change the version string whenever the words change. It has no contact address because the site has none: add one in the text if you want people to know where to write to withdraw. Tested with a built site on a throwaway PostgreSQL and a local TLS mail sink: refused form keeps everything typed, ticked and drawn; mouse and real touch events draw; hashed IP; one email per new request and none for corrections or honeypot hits; duplicates; admin list, detail, accept/decline/reopen, audit rows, CSV (formula neutralised, no picture), script text shown as text, signed-out visitors get 404, 375px without sideways scroll; `tests/unit/expert-form.test.mts` (7 tests). Not tested in Safari/Firefox or with a screen reader. Found by the tests and fixed: React's form reset unticked the language boxes after a refused send (the form is now sent by hand), and a submit button's name/value is not sent with server actions in this version (the admin buttons use bound actions).
- What's new page (website only, NEEDS A WEBSITE DEPLOY): every version now has the same shape (headline, New, Improved, Fixed, Good to know) and the page has one "Updating oovi" box instead of install text repeated per version. Words come from Admin > Release notes (`app_config` key `release_notes`), else the polished text in `web/lib/release-notes-seed.ts` (all 29 released versions rewritten: jargon, install steps, code-signing text and repeated notes removed; 0.8.3 and 0.8.4 hidden because they repeat 0.8.5; in 0.10.2 the claim "move your mouse and it stops" was dropped because 0.10.6 reversed it), else the GitHub release written with the template in `docs/RELEASE-NOTES.md` (parsed automatically), else the GitHub text as written minus its install section. Admin > Release notes lists every version and edits headline and the four sections (controlled form, a refused save keeps what was typed), hides a version, or goes back to the default. A version shows only once its GitHub release is published. Tested with a built site on a throwaway PostgreSQL, GitHub's list faked: public page (order, Latest tag, one install box, template/legacy/default/hidden paths), the editor (save, refused empty save, refused code-host link, hide, show again, reset, audit rows), signed-out visitor gets 404, no sideways scroll at 375px; `tests/unit/release-notes.test.mts` (8 tests). I could not read GitHub from the cloud copy (403), so the real list was read through the GitHub tool, not through the site. Not tested in Safari/Firefox.
- Marketplace content is editable in the dashboard (website only, NEEDS A WEBSITE DEPLOY): Admin > Marketplace now lists every item built into the app (connectors, skills, setups: 104) beside the database items. "Make all editable" (or Edit / Hide on one row) copies them into `catalog_items` with the app's own order; from then on they are ordinary rows (edit, unpublish, delete) and the database copy wins over the app's code (same id, `lib/catalog.ts:57` mergeById; the app refreshes the list every 5 minutes, the site caches it 5 minutes). "Use the app's version" puts one back; deleting the copy also falls back to the app's. Why the expert was missing before: `scripts/seed-catalog.mjs` skipped every item the console's check refused, and the check refused `links` and a bot's `about` (the expert) and `setupUrl` (Zapier); the check now knows every field the app uses (`web/lib/catalog.ts`). The console cannot read `lib/`, so it uses `web/lib/builtin-catalog.json`, generated by `node scripts/sync-web-catalog.mts`; `tests/unit/web-catalog-sync.test.mts` fails when it is out of date or when an app item would not pass the console's check, so run the script after changing `lib/catalog.ts`. The item editor now has ordinary fields (name, description, links, and for each bot its role, one-line voice, instructions and tools) that rewrite the JSON, which stays under "Advanced". People who already installed a setup keep their own copy of its bots (`lib/plugins.ts:73` copies at install), so a change reaches new installs only. Tested on a throwaway local PostgreSQL with the built site in a browser: the list (104 built-ins on an empty database), Edit on the expert, the fields, saving, what `/api/v1/catalog` serves (links, voice and face kept), Use the app's version, Hide, Make all editable (nothing already there touched), the audit rows, and the app's real `mergeById` over the served list (103 items identical to the built-in ones, order kept, the hidden one gone). The unit suite has 4 failures only because the root dependencies `linkedom` and `exceljs` are not installed in the cloud copy.
- Pilot request form with taps (website only, NEEDS A WEBSITE DEPLOY): `/pilot` is now four short steps (About you, What you'll do, Your first try, Almost done) made of choice buttons, a face scale, with free text only for the company, "Somewhere else" and one optional note. Questions and choices live in `web/lib/pilot-form.ts` (shared by the form and the server, which re-checks every value against the same lists, limits 6 uses and 3 improvements, and accepts a rating only as exactly 1 to 5). Required: who you are, computer (Windows/Mac/Linux), what for, where you heard about oovi, a face for the first try, how you can pay online, and the feedback promise. Optional: team size, company, languages, AI tools used today, what to improve first, what you'd pay a month, phone app interest, a 15 minute call (+ WhatsApp/Telegram), permission to quote, a note. Stored as one JSON object in `pilot_requests.answers` (the column is also created on first use by `web/lib/pilot-answers.ts` and in `scripts/migrate.mjs`; if it can't be created the request is saved without it, and the old `use_case` column keeps the note or a line built from the choices). Admin > Pilot shows each person's answers under their request, and a new block "What your pilot people told you" counts them (computer = the Mac waitlist, phone interest, how they can pay, what they'd pay, where they heard, uses, improvements, the average of the faces); the pilot CSV has a column per answer; the new-pilot-request notification email carries the main answers. "Where did you hear about oovi" is a dropdown with real brand logos (`web/app/pilot/IconSelect.tsx`, keyboard and screen-reader friendly; paths in `web/lib/brand-icons.ts` come from Simple Icons, CC0; the Microsoft logo is drawn by hand because Simple Icons dropped it; the logos belong to their owners). After sending, the page shows a thank-you with what happens next. Tested on a throwaway local PostgreSQL (with the column missing first): full and minimal paths through the real form in a browser, required-answer messages on every step, the 6 and 3 limits, the column created by itself, the stored JSON, the admin page and insights, the CSV, the notification email, dark mode and phone width, and 8 groups of server checks (values not on the list, bad ratings, limits, control characters, damaged stored values). Not tested: Safari and Firefox.
- CSV reports (website only, NEEDS A WEBSITE DEPLOY): Admin > Reports lists 12 downloadable CSV files in three groups, with a period switch (7 days, 30 days, 90 days, 1 year, everything); the same files have a "Download CSV" button on Finance, Users, Usage, theOovi, Costs, Feedback, Pilot, Crashes and Downloads. Money: payments, refunds and chargebacks, money per day (USD), subscriptions now, credits ledger. Product use: theOovi usage and cost per person per day, app usage per person per day, downloads and app opens per day by system/version/country, crashes. People: all accounts (with country, where they came from, plan, credits, how they use theOovi and the Normal/Watch/Suspicious check with reasons), feedback, pilot requests. Code: `web/lib/reports.ts` (one query per report), served by `web/app/admin/reports/[file]/route.ts` (admins only, anyone else gets a 404; 30 downloads per 10 minutes; each download is written to the audit log as `report.export`). Format: UTF-8 with a BOM so Excel reads Arabic, dates ISO 8601 UTC, money in normal units with the currency in its own column, up to 100,000 rows (the response header `X-Report-Truncated` says if it was cut), and text starting with = + - @ gets an apostrophe in front so a spreadsheet can't run it as a formula (feedback and names are typed by other people). Tested on a throwaway local PostgreSQL with varied data: all 12 files (valid CSV, one column count on every row, Arabic, commas, quotes, new lines and emoji survive), the formula safety, the period filter (1, 7, 30, 365, all, a bad value), anonymous and non-admin get 404, the audit rows, every page shows its buttons, and a real browser click downloads the file with a clear name. Not tested: very large databases, and opening the files in Excel itself.
- Notifications to the owner (website only, NEEDS A WEBSITE DEPLOY): Admin > Email > "Notifications to you" saves who receives them (up to 10 addresses; empty = the admins in ADMIN_EMAILS) and which kinds are on, in `app_config` key `notifications` (`web/lib/notify.ts`). Kinds: new account (`lib/auth.ts` user create hook), order or renewal, refund or chargeback, subscription canceled (`lib/notify-paddle.ts`, called by `app/api/paddle/webhook` after the event is recorded, so a retry doesn't notify twice), new feedback (website `app/feedback/actions.ts` and app `app/api/v1/feedback`; the automatic notes from bots are not sent), new pilot request, theOovi paused because the daily budget ran out and theOovi down because the AI key was refused (`app/api/v1/ai/messages`, at most once per 6 h / 1 h), and crash reports (off by default). The email template is `adminNotice` in `web/lib/mail-templates.ts`. Safeguards: everything is sent after the response and never throws; at most 30 emails per kind per hour (one notice says the rest are held back); a master switch; a "Send a test notification" button. Needs the mail server in Admin > Email to work. Tested on a throwaway local PostgreSQL with a local TLS mail catcher: sign-up through the website and the app, app feedback (and bot note silent), crash (off, then on), Paddle events through `scripts/test-paddle-webhook.cjs` (17/17 still pass; order, refund, cancel mails), pilot request through the real form, budget alert (once), the 30-an-hour cap, saving and reloading the settings, bad address, master switch, test button. Not tested: the "AI key rejected" alert (needs a real provider key) and your real mail server.
- Update banner shows by itself (owner: it only appeared after pressing Check in Settings). Cause: one check 15 s after start, then every 6 h (`electron/updater.cjs`). Now every 30 min, plus on window focus, wake from sleep and screen unlock when the last check is 10+ min old. Old installs keep the 6 h rhythm until they get this version.

## After 0.10.9 (2026-11-14, released as 0.10.10)
- Pilot invitation button (website only, NEEDS A WEBSITE DEPLOY): Admin > Pilot > "Send the pilot invitation" sends the personal `pilotInvite` email (`web/lib/mail-templates.ts`) through the SMTP set in Admin > Email, so it no longer has to be pasted by hand. Safeguards: asks before sending; refuses a second invitation to the same address unless "Send again" is ticked (memory = `admin_audit` rows with action `pilot.invite`, `web/lib/pilot-invite.ts`); 1 per address per 30 s and 20 per admin per hour (in-memory, per server); the greeting uses the name typed or the account's name. Recent invitations are listed under the form. Admin > Users > a user has a "Send pilot invitation" link that opens the form with the address filled in. Tested on a throwaway local PostgreSQL with a local TLS mail catcher (nothing real was sent): valid and invalid addresses, first send, duplicate refusal, send again, the received email (From, To, Reply-To, subject, greeting, button, link, logo, plain-text twin), audit rows, prefill link. Not tested: your real mail server.
- Bot pointer: a soft rounded arrow in the glow colours (gold → orange → coral → pink, colours drifting slowly), like the owner's picture; orange click ring.
- Glow moves for real (owner: "good but static, make them move and wave, responsive to the screen size"). It was drawn to move, but a wave took ~28 s, so it looked frozen. Measured with a test page: change per pixel in 1 s went from about 4 to 16 (out of 255). Changes: waves 5x faster with a bigger swing, a gentle "breathing", colours turning faster; with Windows "Animation effects" off it moves calmer instead of not at all; `backgroundThrottling: false` on the glow windows; thickness = 6% of the screen's short side (36–130 px); redrawn when a screen is plugged in or out or its resolution/scale changes. Not yet seen on the owner's PC.

## After 0.10.8 (2026-11-14, not released yet)
- Desktop glow redrawn to match the owner's picture: a soft, wavy, multicolor canvas scene (blue, lilac, orange/yellow, pink) with bright lines, rounded corners, one scene shared across all screens (`electron/desktop-control.cjs` GLOW_SCENE). Not yet seen on a real Windows multi-monitor PC.
- New setup "Abdelaziz Benkirat" (`lib/catalog.ts`): startup coach, funny, cool and brutally honest; yellow face with glasses, no beard (the beard option was removed); LinkedIn link shown in the details. Open question to the owner: written consent from Abdelaziz to use his real name and link.
- Marketplace: every connector, skill and setup card opens a details window (click, Enter or Space): connector facts and needed fields, a skill's full instructions, every bot of a setup with its role, abilities and instructions, skills and connectors included. `GET /api/skills/library?id=` returns one library skill whole.

## 0.10.8 (2026-11-14, released; website deployed first): screens, connectors, skills library, setups, "too long"
- Several screens: the bot works on one screen at a time (`ScreenView` in `lib/desktop-control.ts`: the screen with the window in front, or the one it chose), sees it alone at full sharpness, and every point is moved by that screen's corner (`toGlobal`/`toLocal`, `screenOfRect`, `screenLines`, `pickScreen` in `lib/desktop-core.ts`, unit-tested with a laptop + monitor on its left). `manage_window screen` switches screens; `switch` follows the window's screen; `open_app` re-detects. The bridge (`electron/desktop-control.cjs`): `screens()` (nativeOrigin, real sizes), `capture({screen})`, the glow on every screen, pointer moved with `SetCursorPos` (works with negative positions; checked on GitHub's Windows machine). NOT run with two real screens: needs the owner's PC.
- Glow: oovi's lilac, blue and coral flowing along the edges (18 DIP, fades inward), on every screen; bounds set again once shown (mixed scale factors).
- One card: bringing a window to the front, opening an app or a page in the user's browser is also the OK for the screen, mouse and keyboard for the rest of the task (`ok.alsoDesktop`); no second card.
- Connector sign-in comes back through `https://oovi.conuron.com/connect/callback` (`web/app/connect/callback/route.ts` forwards to `http://127.0.0.1:<port>/api/mcp/oauth/callback`; the port is the end of `state`). The service's page now names oovi's site, not "localhost". Checked: Notion registered the client with that address. NEEDS A WEBSITE DEPLOY before the app ships. `OOVI_OAUTH_LOCAL=1` keeps the old direct way.
- Connectors: "Set up" became "Details" (what it is, status, how it connects, maker, address, added / signed-in dates, docs, every tool with what it does) and a Disconnect for every kind (sign-out for one-click ones, remove for the others). Six more one-click connectors (they register themselves, checked from their public metadata): Apollo.io, Calendly, Airwallex, WordPress.com, Mermaid Chart, Jam. Gmail/Google Drive/Calendar, Slack, HubSpot, Box, Mailchimp, DocuSign don't let apps register themselves: oovi would need its own registered app with each (owner's accounts; Google's Gmail scopes need Google's verification). Not done: owner's decision.
- Skills library: 326 skills (`lib/skills-library.json`, built by `scripts/import-skills.mjs` from anthropics/skills (Apache-2.0), obra/superpowers, coreyhaines31/marketingskills, alirezarezvani/claude-skills, wshobson/agents, K-Dense-AI/claude-scientific-skills (MIT); notices in `THIRD_PARTY_SKILLS.md`). Kept only skills that work as instructions (not ones running bundled scripts), not Claude-Code-only, no suspicious text. Server-side (`lib/skills-library.ts`, `/api/skills/library` search + install); Marketplace > Skills > "Skills library" with categories and the source and license on each card.
- "Plugins" is "Setups" in the app (6 languages, help). 11 expert bots (one bot, no group: SEO, copywriter, ads, email marketing, financial analyst, contracts, recruiter, product manager, data analyst, tutor, translator) and 5 more teams (marketing agency, startup studio, online shop, study group, website team); setups can bring library skills.
- "This conversation is too long for one request" on every message (owner's Quill): when the bot's instructions and tools alone are near the limit, trimming the conversation can't help. Now connector tools are compacted (`compactSchema`, `leanTools` in `lib/context.ts`) or only the matching ones sent, a huge single message or result is cut (`shortenAll`), and when it still can't fit the error says which parts are biggest and what to turn off (`chat.tooBig`). Checked with 60 large fake tools and a 400 KB result. The real cause on the owner's PC isn't known (can't see his data): the new error will name it if it happens again.

## 0.10.7 (2026-11-13): Auto mode (owner: "add a mode that always allows, so I'm not asked every time")
- Settings > Safety > "Auto mode" (`approvals.auto`) and an "Auto" chip under the message box (both switch the same setting; turning it on asks for a confirmation). In Auto mode nothing stops for a card except `AUTO_STILL_ASKS` (`lib/orchestrator.ts`): delete_file, run_command, propose_routine, request_abilities/propose_team, propose_specialist. A bot's own plan is approved at once (shown in the chat as approved) and the task gets the desktop OK, through the same path as a plan the user approved. Plan mode (chosen by the user) still waits for review. Hard blocks (system folders, secrets) are unchanged. spec-scenario (folder + file without card, command still asks), list-scenario N (plan runs without waiting). Desktop actions in Auto mode NOT run on a real PC (Windows only).

## 0.10.7: the admin feedback list of 2026-11-12/13 (tool notes and user requests)
- Code and configuration files: `create_document` refuses them (also `.gitignore`, `.env`, `Dockerfile`, which used to become "….docx") and points to the project folder. New tool `use_project_folder` (`lib/project-folder.ts`): the bot asks for the folder the user named (a card; a missing folder is created, same rules as the folder button: not a drive, the home folder, a system folder or oovi's data); on yes it becomes the chat's project folder and the turn restarts with `write_file` & co. spec-scenario.
- Long documents: `create_document` with `append: true` adds sections to the document made with that filename (its Markdown is kept in `<data>/doc-sources/`, checked against the file's size; a changed file can't be extended). An answer cut at the output limit (`stop_reason: max_tokens` / `finish_reason: length`, `cutOff` in `lib/llm.ts`) runs none of its tool calls: the bot gets `CUT_OFF` (orchestrator) telling it to send less per call. This was the "incomplete .docx" note. spec-scenario.
- Where files go: Settings > Files on this computer > "Where bots save the files they make" (`saveFolder` setting, `chosenSaveFolder()`; `downloadsDir()` uses it; default still Downloads/oovi). From "they are using a folder in my Downloads without my permission". spec-scenario.
- `read_url`: a page that refuses plain downloads (400/403: WordPress, business.site, Facebook pages) or needs JavaScript is read in a hidden browser by itself (`readInBrowser` in `lib/reader.ts`: one shared headless browser, 3 pages at a time, closed after a minute idle, private addresses blocked). A chapter page that is mostly an introduction lists its sub-pages to read next (`subPages`; checked on postgresql.org/docs/18/ddl.html). list-scenario O.
- `find_papers`: `also` (up to 4 other phrasings, same call); records holding every word of one phrasing come first and the answer says how many don't (`topicWords`/`onTopicFirst` in `lib/papers-core.ts`); the description says to pick `sources` by field. From "startup readiness" returning medical and engineering papers. unit + list-scenario J.
- `work_table update` with a new column name (Status) adds the column (`updateRow`). unit.
- `work_notes`: a name given with words in another order still finds the one file that shares at least two thirds of its words.
- `message_group` to a busy group (or one waiting for the user's answer): waits 30 s, then the task is queued in `delegations.json` (`queued`) and sent when the group is free; its answer is reported as usual. group-scenario G.
- Google Maps in the bots' browser: `read_page` says that a results list holds no phones and how to read each place's panel, and that a panel's values belong to that place only (`siteGuide` in `lib/tools.ts`).
- `create_image` infographic redesigned (`infographicCss` in `lib/card.ts`): steps as a timeline (across the image when wide), stats as big figures, optional `icon` (one emoji) per point, soft glow and dot grid instead of grey boxes and a flat color band. Word values ("Plan") are steps, number values are stats. unit.
- Bots: role up to 80 characters; new "Role description" (`about`, 400) shown to the bot and its teammates (`lib/bot-limits.ts`). Shared knowledge (Settings > Memory > Knowledge) 2,000 → 5,000 characters.
- Trello connector (Marketplace): community server `@delorenj/mcp-server-trello@1.8.1` (pinned), API key + token, optional board. Code read (Node shebang, stdio, env names); not run here: the session isn't allowed to start third-party packages. NOT tried with a real Trello account.
- Already fixed in 0.10.5/0.10.6 (notes came from older versions): find_places timeouts, "window changed since approved", SearXNG not reachable, prefill error.

## 0.10.7: typing, email code at sign-up, done-check limits (2026-11-13)
- Account signals in Admin (website only, NEEDS A WEBSITE DEPLOY): country, how and where each account signed up (website / app / API, first-visit referrer from the browser's localStorage), theOovi calls counted as "from the app" (request carries `x-oovi-version` and `x-oovi-platform`), "without the app's headers" and "with tools", first/last call, accounts from the same network (salted hash, never the IP). `web/lib/user-signals.ts`; shown on Admin > Users (Country, Check) and each user page ("Where they come from..."). The Check is a hint only (Normal / Watch / Suspicious, with reasons on hover), it never blocks anyone. theOovi requests now also keep last seen, version and platform fresh (before, only `/api/v1/me` did, so an account that used credits could show "never opened the app"). The 11 new `"user"` columns create themselves on first use (3 s lock timeout, fails quietly and retries after a minute) and are also in `scripts/migrate.mjs`. Also new: Admin > Costs (`web/app/admin/costs/page.tsx`: spend, cost of 1,000 credits, plan margins, what-if prices) and `pilotInvite` in `web/lib/mail-templates.ts` (a personal invitation, previewed in Admin > Email, not sent automatically). Tested on a throwaway local PostgreSQL and the built site: sign-up through the website form, the app route and the API without app headers, `/me`, the admin pages, and `scripts/test-paddle-webhook.cjs` (all 17 pass). Not tested here: a real theOovi request (needs the provider key), real Vercel country headers.
- From the owner's test conversation (Facebook messages, a dashboard report): text typed garbled ("1-(' '' '3") in Messenger; the done-check repeated one failure ~15 times; wrong numbers sent from screenshots no longer in view; "كابتير" (capture) read as CAPTCHA and two wrong lessons saved; no way to send a real screenshot; "oovi covers the browser"; a French reply when the message was only a name.
- Typing: `typeText` in `electron/win32-windows.cjs` sends characters with SendInput KEYEVENTF_UNICODE (40-byte INPUT on 64-bit Windows, batches of 32 events, Enter and Tab as keys); `bridge.type` uses it, libnut's `typeString` (it pressed keys as if the keyboard were American) only as a fallback. Checked on GitHub's Windows machine with Notepad switched to a French AZERTY layout: Arabic, French, English and an emoji read back exactly (`tests/win/windows-check.cjs`, 13/13).
- Done-check: a real choice offered after failed attempts is "needs_user"; a reply that repeats the previous one ends the work without a check (`sameReply`, `job.lastReply`); `MAX_AUTO_ROUNDS` 4. bigjob K.
- Screen numbers: DESKTOP_PROMPT says to write them down when read (work_notes) and to check a fresh screenshot before sending or reporting any.
- Darija: common tech words in `LANGUAGE` (كابتير = screenshot, never CAPTCHA…). Lessons: REFLECT_SYSTEM saves only what the user said in plain words, never the bots' reading of an unclear message.
- Language: a message with no clear language takes the language of the user's previous messages (`writeIn` in `viewFor`). bigjob L.
- `send_screenshot` (`SEND_SHOT_SPEC`, `runSendScreenshot` in `lib/desktop-control.ts`): the real screen at full resolution, private windows blacked out, saved as a file (shown in the chat, sent on Telegram). Covered by the task's desktop OK or plan; asked otherwise. NOT run on Windows yet.
- oovi's own window in the way: an action refused because it would reach oovi's window minimizes oovi again (`stepAsideAgain`) and retries once; the approved-window check does the same. NOT run on Windows yet.
- Email confirmed at sign-up: the confirmation email carries a 6-digit code (email-OTP plugin, `codes.make` in `web/lib/auth.ts`) and the link. When the console requires confirmation and email works: `/api/v1/auth/sign-up` and `/sign-in` answer `{verify, email}` instead of a session for apps that send `x-oovi-email-code: 1` (this app, `lib/account.ts`); `/api/v1/auth/verify-email` takes the code and returns the session; `/api/v1/auth/resend-code` sends a new one; the app's sign-in screen (`components/AccountGate.tsx`) and the website's sign-up form (`web/app/signup/SignupForm.tsx`, `/api/v1/auth/verification`) ask for the code. Older apps keep the old flow. Tested against a throwaway local PostgreSQL and a local mail catcher (sign-up, sign-in before confirming, wrong code, right code, resend, older app, the website form in a real browser). NEEDS A WEBSITE DEPLOY.

## 0.10.6 (2026-11-12): a general done-check, one plan approved once, the mouse never stops a bot, find_places via the server
- Owner's verdict on 0.10.5 (Quill, "50 factories in Akbou" and a Facebook task): French answers to Arabic; the first message didn't start a long job; bots read pages one by one; find_places timed out on the owner's line; padding to reach 50; "you moved the mouse" stopped the bot; a card approved "oovi" instead of Brave, then the bot handed the click to the user. The owner rejected detecting long tasks from the wording ("a list with a number"): "a robust system that recognizes long tasks across all task types".
- Correction I made to my own diagnosis: Quill had the browser (its 4:23 PM run used open_url), so scrape_list was available; it simply wasn't used.
- Done-check (`lib/done-check-core.ts`, `checkDone()` in `lib/orchestrator.ts`): after the turn of the bot that answers the user (only when the turn used tools, or a job is running; not for a list job with a row count, which its count decides), one low-effort call compares the request with what was delivered: done / needs_user / unfinished (+ what's missing). Unfinished work becomes a job (`job.auto`, deep, limits lifted) and the bot goes again with "Checked after your last turn… Still to do: …". The same missing note twice, or no tool work for `JOB_STALE` rounds, ends with one report turn. At most `MAX_AUTO_ROUNDS` (12) per user message. A failed or unclear check never continues anything. Cost: one small call per working turn. Scripted tests answer it through `tests/e2e/model-rules.cjs` (`doneCheck.verdict`).
- Jobs without a row count measure progress by tool work (`toolWork` in `jobRound`). A list job's live count is appended to every table-changing tool result (`TABLE_TOOLS`), because the instructions are built once per turn.
- Rows marked "to confirm" (any language, `UNCONFIRMED` in `lib/workfiles-core.ts`) don't count toward a goal; the bot is told never to pad, and that the table is the record (don't re-check rows from memory).
- Reply language: `replyLanguage()` in `lib/text-locale.ts`; a line is appended to the user's latest message in the view (`viewFor`), and to the turn-again line.
- One plan, approved once: bots that can act on the computer or accounts get `propose_plan` and `ACT_PLAN`; approval grants desktop control for the task (`grantDesktop`) and `planApproved` covers clicks, typing, downloads, uploads from allowed folders, open_app, open_in_user_browser and manage_window, even with "Ask before every action" on (default on). Files outside the allowed folders, skills and routines still ask. list scenario N.
- Desktop: no "user moved the mouse" stop any more (owner's decision; Stop on the banner stops). Every pointer action moves to its own target right before it acts. `windowUnder()`/`behindOwn()` compute an action's window as it will be once oovi steps aside (a card approved while oovi was in front named oovi). `DESKTOP_PROMPT`: retry after a passing refusal, never hand a step back. All texts that said "move the mouse to stop" changed (6 languages + consent dialog).
- Bulk tools at the right moment: `lib/list-detect.ts` finds a page's list from its HTML; read_url and research add "This page is a list of about N items… call scrape_list with url=…". scrape_list is given to every bot with Web search (public pages; the private browser when needed).
- find_places: `lib/places-data.ts` (reading the open data; each range download has its own 90 s limit) and `lib/places-core.ts` are used by the app and, as identical copies, by the website (`web/lib/`, `web/app/api/v1/places/route.ts`, signed-in users, 30 a minute). The app asks the server first and reads the data itself when the server can't answer. `tests/unit/places-sync.test.mts` keeps the copies identical. NEEDS A WEBSITE DEPLOY for the server path.
- Tests on three systems: `.github/workflows/tests.yml` (Windows, Mac, Linux: tsc, unit, build, all scenarios). Desktop control itself is still Windows only.

## 0.10.5 (2026-11-12): search with no setup, no more "prefill", "retry" resumes the job, window tools
- Owner's conversation (Quill, "50 factories in Akbou"): the bot told the user to set up web search, the user chose SearXNG (not running), every search failed; "prefill" error; "retry" made the bot start from zero and ask again; desktop control can't switch or close windows by itself.
- Search (`searchWithNote` in `lib/search.ts`): the chosen provider is tried first; when it isn't set, fails or finds nothing, the built-in search answers (own Claude/Gemini key, else Exa's free public search). "none" was removed (old settings become "auto"). The bot is told when the chosen service failed, and never to send the user to a setting. Checked live: SearXNG set to a dead address, results came from the built-in search in about 1 second.
- Prefill: every tool call in the history gets a result (`answered()` in `viewFor`), and both wire formats (`anthropicParts`, `openaiCompatible` in `lib/llm.ts`) add a user-side line when a conversation would end on the bot's own words. The website's `/api/v1/ai/messages` does the same for app versions before 0.10.3 (needs a website deploy).
- Unfinished jobs: `Chat.openJob` keeps a big job that ended before its goal for 24 hours; the user's next message carries it over (`job.carried`) with a prompt line saying a short message means "go on". If the carried round adds nothing, the user meant something else: it ends quietly and closes. bigjob scenario J (5 checks).
- Windows: `manage_window` (list, switch, minimize, maximize, restore, close) in `lib/desktop-control.ts`, matching and safety in `lib/desktop-core.ts` (never oovi's, system, administrator or private windows), native calls in `electron/win32-windows.cjs` (declared apart so a binding failure can't disable the rest of desktop control). `open_app` also finds Microsoft Store apps (Get-StartApps, read when a bot starts using the computer; started with explorer.exe shell:AppsFolder\<id>; system and password packages blocked in `blockedApp`).
  - Run on a real Windows machine (GitHub windows-latest, `.github/workflows/windows-check.yml` + `tests/win/windows-check.cjs`), 10/10: Notepad listed with title and program, minimized, brought back to the front (it got the keyboard: the lone-Alt trick works from a background process), maximized, closed; an unknown handle refused; the Store apps list read (Settings, Terminal and Windows Security among them, all refused by `blockedApp`). Not run: inside the real oovi app with a real model. The first two runs didn't start: the private repo had no Actions minutes left; the owner made the repo public to continue.
- Directory rows: a rank number ("01") or a button/ad label is never taken for the item's name (`itemLines` in `lib/page-list-core.ts`). Seen on algeriayp.com: one scrape_list call gives 40 Akbou companies, 36 with a phone.

## 0.10.4 (2026-11-12): bulk collection tools: scrape_list (a whole site), find_places (open map data), find_papers (open publication catalogues)
- Fixes from the owner's 0.10.3 conversation (a list stuck at 18 of 50) and from the bots' tool notes in the admin Feedback page, all in 0.10.4:
  - Two rules contradicted each other on search snippets (`lib/orchestrator.ts` research paragraph and `lib/reader.ts` said "a snippet is not a source"; `workPrompt` said keep it marked "to confirm"). One rule now: confirm on the page when it can be read; else keep it with the search result as source, marked "to confirm".
  - A phone number or email is saved only when it was read somewhere: `readSoFar()` in `lib/orchestrator.ts` gathers tool results, the user's messages and the work tables of the chat; `dropUnseen`/`seenIn` in `lib/workfiles-core.ts` take unread values out of phone and email cells on work_table add and update (the row is kept, the bot is told what was not saved). Not applied when pictures were read in the chat (desktop screenshots, image or PDF attachments): those can't be checked. Notes are not a source. The collecting tools write straight to the table and are not checked.
  - A big job whose rounds add nothing now gives its owner one last WRAP UP turn (also for a bot alone): a report, never a question.
  - Leaders are told to use the bulk tools; bots with desktop control are told to open a refusing site in the user's browser instead of offering to.
  - Forms in the bots' browser (the dashboard upload that "failed twice": the project was never selected): the element list now names a checkbox by the words beside it, says ticked / not ticked, shows a dropdown's choices and what is chosen, and marks switched-off controls; `type` on a dropdown chooses the option; clicking a switched-off or covered control explains it instead of timing out; a name that doesn't resolve is explained (tunnel addresses change).
  - work_table accepts rows sent as JSON text (assumed cause of "work_table add reported failure twice"; not reproduced); a work file asked for by an approximate name is found when exactly one fits.
  - Not done from the Feedback page: longer role field, Trello connector, shared knowledge 2000 -> 5000 characters, a role description field; the "folder in my Downloads without my permission" report.
- The owner's rule for this family of tools: "the same philosophy in every similar domain": the bot asks once, an engine fetches, merges and saves dozens or hundreds of rows into the work table with no model call per item; the model then reads only what matters. A new domain = one module with a pure core (`*-core.ts`, unit-tested), a network part with env-overridable base URLs for tests, a spec added in `toolsFor` (`lib/tools.ts`), a dispatch line in `runTool`, labels in `statusText`/`callLabel`/i18n, and a scene in `tests/e2e/list-scenario.cjs`. Rows go in with `addRecordRows` (`lib/workfiles.ts`).
- `find_papers` (`lib/papers.ts`, `lib/papers-core.ts`): Crossref (all fields), Europe PMC (medicine, life sciences; abstracts, free full text), arXiv (preprints). No key. The same paper from two catalogues is merged by DOI, else by title and year. Year filter, free-full-text filter, sort by relevance / most cited / newest (sorting picks among the relevant results: at least 100 are fetched). arXiv gets 12 seconds and is optional: from the cloud machine it answered once, then limited requests. OpenAlex was left out: it now needs a key (checked 2026-11-12).
  - Run for real: "CRISPR base editing sickle cell disease" from 2019, 200 rows into a table (137 with an abstract, 98 with a free full text link); a nonsense query says nothing was found. The first run took 45 s because arXiv was waited for 45 s; that wait is now 12 s (not re-timed against the live services).
  - The tool tells the bot that a catalogue record is not the paper: read it before reporting findings.
- Candidates for the same pattern, not built: books (Open Library answered without a key), news, patents, court decisions, company registers, job offers, product prices. Wikipedia's API and GDELT refused this machine.
- Owner: "my friends scrape without AI, with tools like Playwright; oovi must outperform them."
- `scrape_list` (`lib/scrape.ts`, spec in `lib/tools.ts`): one tool call does what a scraping script does, with no model call per page. It reads the list (`lib/page-list.ts`, shared with extract_list), goes through the next pages by itself (rel=next, a "Next/Suivant/التالي" control with or without arrows, numbered pages, a button that swaps the list in place, or a URL with `{page}`), optionally opens each item's own page (`details: true`: plain download 4 at a time through `fetchPage` in `lib/reader.ts`, the browser when the site refuses that) and saves name, details, phone, email, address, link, source and any asked-for column (`fields: {column: "selector"}` or `"selector@attr"`) into the work table.
- A phone or email found on most item pages of one site is the site's own (footer) and is given to no item (`siteWide` in `lib/page-list-core.ts`).
- Item text is split into lines by blocks and by inline pieces that touch (`linesOf` in `LIST_JS`), because innerText glued "Salon Lina" + "Kouba".
- Limits: one call works at most 9 minutes and then says how to go on; 100 list pages and 1,000 item pages per call; every address is checked against the private-network block; if the user takes the browser, it stops and says so. No disguise: a site that refuses automated visits is reported, not worked around.
- Run on real sites from the cloud machine: dzadvisor.com cafés in Algiers, 3 pages with details: 48 cafés, 48 with phone and address, 16 seconds, 2 model calls. books.toscrape.com 3 pages with Price/Stock/Title fields: 60 rows, 4 seconds.
- `find_places` (`lib/places.ts`, pure parts in `lib/places-core.ts`, spec `PLACES_SPEC`; bots with Web search or Browser have it). Owner refused a paid Google key and asked for a free open source: Overture Maps "places" (open data, CDLA-Permissive-2.0, no key).
  - How: the newest release is found from the public bucket's listing; each file's index is read once per release (about 38 MB for the 16 files, then kept in `<data>/cache/places/<release>.json`); a question downloads only the blocks of rows that cover the area (5 to 10 MB each, at most 12). Read with `hyparquet` + `hyparquet-compressors` (MIT, pure JavaScript, bundled into the standalone server: no native code).
  - The area's outline: Nominatim (OpenStreetMap), at most one request a second with oovi's own User-Agent, then Photon. "lat,lon" works too. An area over 150 km across is refused.
  - Categories are English words matched on whole words of Overture's categories; when nothing matches, the tool answers with the area's own categories.
  - Run for real from the cloud machine: Hydra, Alger: 26 cafés and coffee shops (18 with a phone) and 117 beauty/hair/spa (100 given, all with a phone) in about 8 seconds including the first index build; Shibuya, Tokyo works; "Algérie" is refused as too large.
  - Known limits: in Algeria almost every row comes from Facebook pages (a business without one is missing; numbers can be old); "internet cafe" matches "cafe"; the first question each month downloads the 38 MB index; tests use `OOVI_PLACES_URL`, `OOVI_GEOCODER_URL`, `OOVI_GEOCODER2_URL` and `tests/e2e/fixtures/places.parquet` (made-up places).
  - Privacy page has a paragraph about these services (needs a website deploy).
- `tests/e2e/list-scenario.cjs` is now 36 checks (scene I is find_places).

## 0.10.3 (2026-11-12): two errors that stopped teams, lists taken from pages in one step, one table per job
- Seen by the owner in a team chat: the leader's turn failed with "This model does not support assistant message prefill. The conversation must end with a user message."
- Cause (in the app since 0.10.0): a bot given the turn right after its own message (a big job's next round, `settle()` `p.queue.push(bot.id)`; a last turn to conclude; teammates who added nothing) was sent a conversation ending with its own words. The service refuses that.
- Fix: `viewFor()` in `lib/orchestrator.ts` ends such a view with a short user-side line (`AGAIN`).
- Why tests missed it: the scripted model accepted anything. `tests/e2e/model-rules.cjs` now refuses what the real service refuses, in every scenario; bigjob failed 3 checks before the fix, 27/27 after.
- Second error in the same chat: "The request body is not valid JSON: unexpected end of hex escape". Cause: text cut in the middle of an emoji (any `.slice()` of page text or tool output) leaves half a character; the service refuses the whole request. Fix: `lib/wire-json.ts` (`wireJson`) makes every string whole where requests leave the app (`lib/llm.ts`), and the website's `/api/v1/ai/messages` does the same for older app versions (needs a website deploy).
- Diagnosed, not built yet (owner to decide): lists of businesses are slow because (1) there is no tool that returns many places with phone numbers at once; (2) the bots' browser has no scroll and no way to pull a whole list from a page; (3) Google Maps shows the bots' browser a "limited view" (6 results, no phones; seen from the cloud machine); (4) the main bot's chat and the group it delegates to have separate work tables (`runWorkTool(c, chat.id, …)`), so counts disagree (12 vs 5 in the owner's chat); (5) code running exists only with an E2B key or a project folder.
- Built after that diagnosis (owner said "go" for 1 to 3; not released):
  - `scroll` and `extract_list` for the bots' browser (`lib/tools.ts`, `SCROLL_JS`, `LIST_JS`; rows shaped in `lib/page-list-core.ts`). extract_list finds the page's main list (largest group of same-built siblings with text), can load more by scrolling (also inside a panel), and with `table` puts the items straight into a work table (`addListRows` in `lib/workfiles.ts`). Bare numbers inside one item count as phones (`phonesInText` in `lib/contacts.ts`).
  - One table per job: a task passed with message_group carries `workChat`; `workHome(chat)` in `lib/orchestrator.ts` decides whose work files a chat uses. A message the user writes in the group itself uses the group's own files.
  - Source rule in `workPrompt`: a row found on a directory is kept, with its source, marked "to confirm"; the user is never asked to copy from a page.
  - `tests/e2e/list-scenario.cjs` (16 checks, real browser, local pages). Also run by hand on real sites from the cloud machine: Google Maps results 6 -> 19 after scrolling (names and addresses, no phones: "limited view"), dzadvisor.com listings 16 items per page (names and links; phones are on each item's page), Wikipedia table 172 rows, a scroll-to-load page 10 -> 40.
  - Known limits: sites that block automated browsers (pagesjaunes.fr, yelp.com, a Cloudflare check) still block; a page with one item per row of mixed layout may need `selector`; no "find places" tool yet (owner to decide on a Google Places key).
- Next (owner said no to a paid Google key, asked for a free open source): Overture Maps places (open data, CDLA-Permissive-2.0, GeoParquet on a public bucket, no key). Measured 2026-11-12 for the Algiers area: 21,931 places, 18,679 with a phone; cafés and coffee shops 162 (112 with a phone); beauty 849 (767 with a phone); most rows carry a Facebook page link. A bounding-box query over the 16 files took about 2 seconds with DuckDB. Not built yet.

## 0.10.2 (2026-11-12): the user's chat is where things happen; bots act for the user
Second conversation the same night ("use brave, go to facebook.com and send a message to me: test"): the bot refused ("sending messages from your accounts is outside what I can do"), asked "should I go ahead?" after being told to, sent the user to do it himself, and the review saved the false lesson "The user does not want the bots to control their PC or browser".
- **Acting for the user is the job** (`FOR_THE_USER` in `lib/orchestrator.ts`, placed before `SAFETY`): the request is the authorization, the card is the confirmation, a task passed on by the main bot has the user's authority, never "do it yourself". The blanket bans ("never … send … unless the user asked for that exact action", "ONLY when…") are reworded to "do what was asked and no more". `abilityLines` no longer tells a bot with desktop control that it can't send messages.
- **False lessons**: `bansAbility` in `lib/lesson-rules.ts`: the automatic review never saves a lesson or profile fact that takes an ability away, and such lessons saved before are dropped when lessons are read.
- **Visible control** (`electron/desktop-control.cjs` `showDeco`, `bridge.pointer`; `glide` in `lib/desktop-control.ts`; `glidePath` in `lib/desktop-core.ts`): four thin glowing strips at the screen edges and a 56px pointer window just beside the real pointer's tip, all click-through and excluded from screenshots; the pointer glides (ease in/out, up to 24 steps) and a ring pulses on clicks. Never a full-screen window: oovi refuses to act on its own windows (`windowVerdict`), so nothing of oovi's may sit under the click point. Ran in real Electron on a Linux virtual screen (windows created, positioned, removed); **not run on Windows**.
- **Any browser, not Brave** (`open_in_user_browser`, `OPEN_BROWSER_SPEC`/`runOpenInBrowser` in `lib/desktop-control.ts`, `openInBrowser` in `electron/desktop-control.cjs`): opens an address in the user's default browser through the system (Electron `shell.openExternal`), whichever browser that is. Same card rule as `open_app`. Nothing in the engine names a browser; "Brave" was only an example in a prompt and is now generic. Not run on Windows.
- **Model behaviour check (indicative, not a release test)**: no Anthropic key in the cloud session, so Haiku 5.5 was asked through sub-agents to play one assistant turn with the exact system prompt and tool list the built app sends (captured from the app, desktop sections added as on Windows; files were in the session scratchpad). 5 requests: Gmail check, Facebook message, the send step, a Darija request, a threat. Found one defect: `abilityLines` still said a bot "needs Use my signed-in accounts" to send a message, so the model asked for that ability instead of using the user's browser. Fixed (desktop-aware paragraphs 3 and 4); 3 retests chose `open_in_user_browser`. The threat was declined with a lawful alternative. A real test needs the real API with real screenshots: ask the owner about a test key in the environment's secrets.
- **Attaching files to pages** (`upload_file` in `lib/tools.ts`, `attachFile`; file rules in `uploadSource`, `lib/computer.ts`): the owner's bot answered "I can't choose a local file, do it yourself in 3 steps" because no such tool existed. It handles a file field, a button that opens the file chooser, and a hidden file field; two fields without a number is refused with a clear message. A file outside Downloads/oovi and outside the allowed folders always asks first; keys, system and browser-profile files are never attached. The desktop route has the file-dialog steps in `DESKTOP_PROMPT`. Test: `tests/e2e/upload-scenario.cjs` (10 checks, real browser, local pages). Not covered: drag-and-drop-only zones with no file field at all.
- **CAPTCHAs**: the owner asked again to make the bots' browser "look like a normal person". Not done and not planned: disguising an automated browser's fingerprint is getting around sites' bot checks (refused by the session's safety check). The route that needs no disguise is the one products in this field use: work in the user's real browser. In oovi that is desktop control in the user's own Brave/Chrome; bots are told to switch to it when a check repeats.
From a real conversation on the owner's PC ("use my pc and check my gmail in brave": the Chief gave it to a group, the OK was asked in the group, the task was reworded, the bot opened Gmail in its own signed-out browser and stopped).
- **Approvals come to the user** (`groupAsksFor` in `lib/delegations.ts`, `GET /api/chats/[id]` adds `groupAsks` for the main bot's chat only, `components/ApprovalCard.tsx` is now the one card for own and group requests, `answerGroup` in `components/ChatView.tsx` posts the answer to the group's run). It reuses `waitingGroupTasks()` (what Telegram's /yes already used). A group's plan uses the existing `PlanReview`.
- **The user's words travel with the task**: `UserEntry.userWords`, set by `message_group` from the main chat's last user message (harness, not prompt), shown to the group's bots as "the task" and in the group's chat under the passed-on message.
- **Do it yourself first**: the main bot's rules, the `message_group` description and `abilityLines` (new `desktop` flag) say a job its own tools can do is done by itself; a group is for jobs that split into parts.
- **The user's apps and sessions first**: the 0.10.1 rule "websites: use the browser tools, not the desktop" was wrong and is removed. Order now: the browser/app the user names (desktop control) > the bot's browser with signed-in accounts > private browser.
- **Act before asking** on the desktop: look, act, check; open what is missing with `open_app` (no second card once the task has the mouse-and-keyboard OK, unless "ask before every action" is on; the grant card says so).
- **Still not run on Windows**: `open_app`, the minimize/restore of oovi's window and the whole desktop loop. The engine paths are tested with a scripted model (`tests/e2e/group-scenario.cjs` 29 checks); how the real model behaves with these rules is not tested. Owner declined nothing yet about a real-model test set (item 6 of the proposal): ask again.

## 0.10.1 (2026-11-11): desktop control, honesty, learning, tool notes
From a real conversation ("open ChatGPT on my PC and make a tiger picture": the bot said it couldn't, made a stock-photo card, then saw a black screen).
- **Black screen**: oovi's own window is blacked out in screenshots and covered the screen. Now `electron/desktop-control.cjs` minimizes oovi's windows when the control banner shows (`stepAside`) and restores them when it hides (`comeBack`: task end, Stop, or a pause for the user's OK).
- **open_app** (`lib/desktop-apps-core.ts`, `OPEN_APP_SPEC`/`runOpenApp` in `lib/desktop-control.ts`): starts one Start-menu app by name after a card. Terminals, system tools, installers, uninstallers and password managers are refused, judged by the shortcut's target as well as its name. Microsoft Store apps aren't listed (no PowerShell on purpose). **Not run on Windows**: only the rules are unit-tested (`tests/unit/desktop-apps.test.mts`). Ask the owner to try it.
- **Honesty**: bots are told desktop control is a real ability (or where to turn it on), that `create_image` designs from stock photos and doesn't generate pictures, that named websites are done in the browser, and to say which option they picked after "ok".
- **Step details**: the expandable raw tool result is labelled "What the bot received (technical)" and isn't shown for steps that made a file.
- **Learning**: at most 1 lesson per run (2 after a correction), only about the user's work; notes about oovi's tools are refused (`TECHNICAL_LESSON` in `lib/lesson-rules.ts`).
- **Crash reports**: "ResizeObserver loop…" is fixed at its source (`components/Updates.tsx`) and no longer reported (`lib/crash-filter.ts`).
- **Tool notes go to the owner, not to the user's learning** (`lib/tool-notes.ts`, `cleanToolNote` in `lib/lesson-rules.ts`): the review returns `tools` (notes about oovi's own tools); these and the refused technical lessons are sent to `POST /api/v1/feedback` with `source: "bot"` while "Send crash reports and tool problems" is on (same setting as crash reports, wording updated in 6 languages, Privacy page updated). Cleaned first: emails, numbers, file paths, quoted text, the page part of addresses, the user's own name. Each note once per computer and once per user on the server. Admin: Feedback > "Bots: tool notes" filter and a KPI.
- **CAPTCHAs, not done**: measured cause: the bots' browser announces itself as automated (`HeadlessChrome`, `navigator.webdriver = true`). Hiding that was refused by the cloud session's safety check (bot-check circumvention) and was not done. Only the bots' behaviour changed: continue on the page after the user solves a check, never loop on the same check, use another route. The owner must decide whether to pursue anything further.

## Linux added to 0.10.0 (2026-11-11)
- Owner's choice: no new version. The Linux files are built from `main` as 0.10.0 and attached to the existing v0.10.0 release (Actions > Build desktop apps > Run workflow on `main`, tag `v0.10.0`, only `linux`), so Windows and Mac users aren't asked to update and the Store package is untouched. The Linux-only code paths (update feed, browser paths) are in `main`, not in the Windows/Mac 0.10.0 installers, which don't need them.
- Built on GitHub (ubuntu-latest): `oovi-<version>-linux.AppImage` (any distribution) and `oovi-<version>-linux.deb` (Ubuntu, Debian, Mint), x64 only, plus `latest-linux.yml`. `publish-downloads.yml` now requires them.
- Checked on Ubuntu 24.04 (cloud session, as root with --no-sandbox, virtual display): the .deb installs with apt (dependencies resolved, menu entry, icon, AppArmor profile for Ubuntu 24+ in its postinst), and both the installed app and the AppImage start and show the sign-in screen. Not checked: a real desktop session as a normal user, and the AppImage on Ubuntu 24+ (unprivileged user namespaces are restricted there: the website recommends the .deb).
- App: Linux checks `latest-linux.yml` and sends "Download" to `/download/linux-deb` or `/download/linux-appimage` (updates are manual, like Mac; AppImage self-update is possible later once tested on a real update). Bots' browser: besides Chrome/Edge channels, `lib/browser.ts` tries the usual Linux paths (Chromium from apt/snap/flatpak, Brave…), proven by making a PDF with Chrome's channel path hidden.
- Website: Linux tab (two choices), Linux buttons, `/updates/latest-linux.yml`, targets `linux-deb` and `linux-appimage` (deploy the website only once a release has the Linux files, or the buttons lead to "unavailable").
- Desktop control stays Windows only.

## Status after 0.10.0
- 0.10.0 is on `main`, released on GitHub (v0.10.0), copied to the downloads site (website buttons + in-app updates serve 0.10.0) and submitted to the Microsoft Store by the owner (in certification, 2026-11-11).
- The first build of the release failed on the spare-copy upload ("Artifact storage quota has been hit"); `build.yml` now makes that copy only for test builds. To attach installers to an existing release: Actions > Build desktop apps > Run workflow on `main` with the tag.
- Website: Windows first, "Coming soon" for phone and web, 3-step Mac install guide; `status.maxConcurrent` is live.
- Not yet proven with the real model on the real web: the big-job and parallel engine (ask the owner for the conversation of a real "100 prospects" run).

# Earlier: oovi 0.8.8 (released 2026-11-10)

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

## 0.10.0 (2026-11-11): heavy team work, teammates at the same time, learning card, Telegram files
Owner's words: "I want a real team that does heavy, dirty work and doesn't stop until it reaches the goal", no credit ceiling ("if the task is big, the user assumes"), chat messages stay short and the work goes into files, nothing may depend on a bot's role.
- **Big jobs** (`start_big_job`, `lib/orchestrator.ts`): the bot that answers the user decides a task is big. Hand-off and step limits are lifted; the owner of the job is sent back until the goal is reached (a row count in a work table when there is one); the job closes itself after 2 rounds that add nothing (`JOB_STALE`). One turn may take 400 model calls (`JOB_STEPS`, a loop guard).
- **Work files** (`lib/workfiles.ts`, `lib/workfiles-core.ts`): per chat, `work_table` (rows merged by name or phone), `work_notes`, `work_export` (Excel/CSV/Word/PDF/Markdown without retyping). Stored in `<data>/work/<chatId>.json`.
- **Reader** (`lib/contacts.ts`, `lib/reader.ts`): phones, emails, WhatsApp, addresses from tel: links, buttons, footers, JSON-LD. Checked on real pages (DzAdvisor, Glammy) that bots had reported as "no number".
- **Learning** (`lib/learning.ts`): the review sees saved lessons and the profile and returns `{text, replaces}`; the Learned card has Correct / Forget per line (`POST /api/chats/[id]/learn` with `change`).
- **Telegram**: every file a tool returns is sent (exports, downloads, copies, cloud-computer files), and a routine's files too.
- Tests: `tests/e2e/bigjob-scenario.cjs` (23 checks), `tests/e2e/telegram-scenario.cjs` (8), unit `contacts`, `workfiles`.
- **Teammates work at the same time** (`teamBatch`, `runBatch`, `runTogether` in `lib/orchestrator.ts`): work the leader hands to 2+ teammates runs in parallel (up to 4 at once). While they work they don't see each other's replies (`BotEntry.batch`); the leader's turn comes after all of them. Requests for the user's OK are shown one card at a time (`Pending.parked`). One teammate's error doesn't end the others' work. Kept one at a time on purpose: plain groups without a leader (a conversation), bots using the user's signed-in accounts, chats with a project folder, and desktop control. Calls to theOovi queue in the app at the server's limit (`lib/gate.ts`, `status.maxConcurrent`, default 3) instead of failing as "busy". Test: `tests/e2e/parallel-scenario.cjs` (18 checks).
- **Not done**: a teammate that needs the user's OK is answered only when the others working with it have finished their turns (the run must pause to take the answer). The owner's Telegram file failure wasn't reproduced: ask what was requested when it failed.

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
