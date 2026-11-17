# What four competitors have that oovi lacks (read 2026-11-18)

Four open-source "Grok Bot alternatives" were read file by file (nothing from them was run): **dusk bot** (DuskBotAI/duskbot), **Rakazo** (elie222/rakazo), **OpenMausBot** (milind-soni/OpenMausBot), **OpenBot** (CopilotKit/OpenBot). Each finding was checked against oovi's code; the points marked "verified in oovi" were re-read by hand.

**Ideas only, never their code.** Licences: dusk = PolyForm Noncommercial (no commercial use), OpenMausBot = Apache 2.0 except `enterprise/`, Rakazo = Apache 2.0, OpenBot = MIT but needs a paid closed component in production. dusk and OpenMausBot share 2,278 server file paths (one grew from the other), so their ideas overlap.

**Where oovi is already ahead of all four:** Arabic and Darija with right-to-left (none of them has Arabic), theOovi credits with no setup, Telegram with approvals, Word/Excel/PowerPoint/PDF files, find_places / find_papers / list scraping, Canvas, big-job mode with a multilingual done-check, the expert Marketplace, Linux desktop control, no Docker.

## Tier 1: next version (cheap, high value, mostly cost and reliability)

| # | What | Who has it | oovi today | Effort |
|---|---|---|---|---|
| 1 | **Keep the cached part of the request fixed.** Memory and the lessons picked from each message sit in the system prompt, so every new user message re-bills the whole conversation at the cache-write price. Move them next to the user's message. | dusk (`server/system-prompt.ts`), Maus (`recall.ts`) | Verified in oovi: `lib/orchestrator.ts:487-495` | S |
| 2 | **Write to a bot while it works.** The message waits in a queue (kept after Stop) or is taken into the running work before the next step. | dusk, Maus (`steer-queue.ts`), Rakazo (`run-turn-images.ts`) | Verified: refused with 409, `app/api/chats/[id]/run/route.ts:54` | M |
| 3 | **Loop guard.** Stop after the same call 6 times, or the same failing call twice, and tell the bot to try another way. | Rakazo (`runs/turn/tool-loop.ts`), dusk, Maus, OpenBot | Verified: only a 25-step cap (`lib/settings.ts:103`) | S |
| 4 | **Long answers never cut.** An answer that hits the output limit is continued; an empty answer is retried. | Rakazo (`pi-runtime-fallback.ts`) | Verified: only a cut with tool calls is handled (`lib/orchestrator.ts:1485`) | S |
| 5 | **Free "not finished" checks before the paid one:** a reply ending on a promise ("I'll get the rest now") with no action gets one nudge; the last step is told to answer now. Must know Arabic, Darija, French. | OpenBot (`shared/run-notices.ts`), dusk (`host/finish-guard.ts`, English only) | One model call per check (`lib/done-check-core.ts`) | S |
| 6 | **Summarize while the chat is idle**, right after a turn, not when the user writes next (they wait 35-58 s per their notes). | dusk, Maus (`warm-summary.ts`) | Compaction at the start of the turn (`lib/orchestrator.ts`, `compactIfLong`) | S-M |
| 7 | **Better routines:** once at a time ("remind me at 5"), every N minutes; silent runs that post nothing when there is no news; checks in plain code (page, price, feed, inbox) that call the AI only when something changed; back off after errors. | Rakazo (`routine-watch.ts`, `silent-reply.ts`), dusk/Maus (`host/routine-checks.ts`), OpenBot | Verified: daily/weekly/hourly only (`lib/routines-tools.ts:29`); the AI runs on every tick | S-M |
| 8 | **Spending limits** per day and month (whole app, per bot, per routine; a routine run costing 3x its usual stops itself). For own-key users especially. | dusk (`spend.ts`, `routine-self-cap.ts`), Maus (`usage-caps.ts`) | Only the step cap | S |
| 9 | **Several browser actions in one call** (fill a whole form at once), and after a click return only the new buttons and fields. Fewer model calls per task. | Rakazo (up to 24 actions), dusk (`batch.ts`, `after-action.ts`) | One action per call (`lib/tools.ts`) | M |
| 10 | **Voice notes from Telegram turned into text**, and a microphone button in the app. Darija speakers send voice notes. | Rakazo, OpenBot (on-device dictation), dusk/Maus | None | M |

## Tier 2: following versions

| # | What | Who | Effort |
|---|---|---|---|
| 11 | Saved logins and two-step codes the bot never sees: the app types them; page scripts blocked meanwhile; API keys added only for the exact site. | all four | M-L |
| 12 | Fewer approval cards: ask only for risky kinds (delete, send, post, pay, password); "allow for this conversation" / "always here"; an optional cheap judge; a hold before sending messages; once a run has read outside text (web, email), memory and skill writes need approval. | OpenBot, Rakazo, dusk | M |
| 13 | Memory per bot: saved after a chat goes quiet, only facts that quote the user's own words, change log with undo, tidied at night. | dusk, Maus, Rakazo | M |
| 14 | Proof for actions: a reply that says "sent" or "booked" with no record of it gets a "Not confirmed" mark; an action is never sent twice after a crash or retry. | dusk, OpenBot, Rakazo | S-M |
| 15 | Event triggers: an incoming email, a web address (webhook), a GitHub issue starts a routine. | all four | M-L |
| 16 | Morning brief built by code from mail and calendar, email sorted by a small model, a "time saved" counter. | dusk, Maus, OpenBot | M |
| 17 | Teach by showing: the user does the task once, it becomes a skill to review. | Rakazo, OpenBot | M-L |
| 18 | Helpers with a fresh context that run in the background and report back. | OpenBot, Rakazo, Maus | M |
| 19 | Chat basics: search in a chat and across chats, fork from a message, export, pin, reply-to, reactions, command palette, maths (LaTeX). | all four | S each |
| 20 | Pages shared by a public link, and small charts or forms inside the chat. | Rakazo, dusk, Maus, OpenBot | M |
| 21 | Tool results: "Next step:" hint on every failure, repair of badly shaped arguments, shortening that keeps the start and the end. | dusk, Rakazo, OpenBot | S |
| 22 | Tests built from real failed requests in Arabic, Darija, French (which tool the bot picks). | Maus, Rakazo, OpenBot | S-M |
| 23 | "First hour" in the chat: connect Gmail and Calendar, then up to 3 draft replies and a brief. | Maus | M |

## Tier 3: big or strategic (decide before building)

- Run bots on the ChatGPT or Claude plan the user already pays for (all four do it). Pulls against theOovi credits; each vendor's terms must be checked first.
- Phone app with notifications; Slack, Teams, email channels. WhatsApp: Rakazo's notes say Meta allows general AI assistants only in the EU, Brazil and Türkiye (not checked).
- Always-on cloud so routines run with the PC off (Maus, Rakazo, dusk).
- Live voice calls; meeting-notes bot (Meet, Teams).
- Real AI image generation (today create_image makes designed cards).
- Data tab: questions in SQL over big CSV/Excel files.
- Import from other assistants (skills, memory).
- Control the user's apps in the background through the accessibility tree, and replay saved steps with no model call.
- Companies: sign-in with the company account (SSO), roles, activity log.

## To measure before deciding

- **Tools on demand (0.11):** dusk measured no saving from hiding tools once caching is on ($0.56 vs $0.58, their docs); OpenBot measured a large saving for very long connector lists. Re-run `tests/e2e/cost-scenario.cjs` with and without `lib/tool-defer.ts`, and with 50+ connector tools.
- **Arabic token count:** oovi estimates length / 3 (`lib/context.ts:19`); Rakazo assumes far more tokens per Arabic character. If oovi under-counts Arabic, long Arabic chats could exceed theOovi's limit. Measure with real usage numbers.
- **Screenshot on every page read** (`lib/tools.ts:328`): measure its cost against reading text only.
