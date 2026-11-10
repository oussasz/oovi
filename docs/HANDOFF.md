# Hand-off: oovi next version (branch `next-version`)

Written 2026-11-10 by the Claude Code session that did this work on the owner's Windows PC, for the session that continues it. Read this first; it is self-contained.

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

## What's left (in order)
1. Run `npm run build`, then `node tests/e2e/spec-scenario.cjs` and `node tests/e2e/phase1-scenario.cjs`; fix anything that fails.
2. Look at the new screens in a browser (run the built server on a fresh data folder: `OOVI_DATA=/tmp/x PORT=3302 node .next/standalone/server.js`): sign-in (language picker, opens on Create account), onboarding last step, Home message box and ideas, an Arabic bot reply (right-to-left lines), the specialist card, hidden bots toggle, credits panel, team task total. Light and dark.
3. A short real-model check (it costs credits; keep it to a few messages): the leader delegates a bigger task and proposes a specialist when one is missing; an English message after French ones is answered in English.
4. Review the diff once more (security: `create_image` paths, `render.ts` network blocking, specialist creation), then commit, merge to `main` only with the owner's OK.
5. Not built (need the owner's accounts/decisions): local payment in Algeria (Edahabia/CIB via a gateway such as Chargily or SATIM; needs a merchant account), WhatsApp access (needs a Meta WhatsApp Business account and a public webhook, e.g. via the website), true AI image generation on theOovi (server cost decision).
6. Still pending from before: deploy the website (`cd web && npx vercel@latest --prod --yes`; it was blocked by a permission check on the PC, the owner can run it), live test on the owner's PC (Telegram groups, desktop control), then version 0.8.8 and the release (Microsoft Store + downloads repo) only with the owner's go-ahead.

## Rules the owner set (keep them)
- Confirm before anything outward or hard to undo: pushing to `main`, deploying, publishing, store submissions, sending messages.
- Never ask the owner to paste passwords or keys into chat; never enter passwords or create accounts; test with stand-ins or a fresh data folder instead.
- Write for people: plain words, short; Arabic (incl. Algerian Darija), French and English users.
- "We win in the harness, not in the model": no automatic switch to a bigger model to fix quality; cost matters.
