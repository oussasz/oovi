# oovi cloud: what is being built (contract for the parallel sessions, 2026-11-18)

Read `docs/CLOUD-PLAN.md` first (the owner's decisions). This file adds the owner's new decisions and the exact
contract every part follows, so the parts built in parallel fit together. Change this file only with a note at
the bottom saying what changed and why.

## The owner's new decisions (2026-11-18)
- On the phone and in the cloud, the ONLY AI model is theOovi (credits). The user's own API keys (OpenAI,
  Gemini…) never leave their computer: they are not synced and the cloud never uses them. (Stage 1B is therefore
  connectors only.)
- Connectors move with the account: their sign-ins are synced (encrypted) so the phone and the cloud can use them.
- The phone app: a real, polished app, Apple style (iOS look and feel), not a basic page.
- The cloud server runs on Azure first (student credit), built so it can move to any other server without
  breaking anything when the subscription ends.

## Defaults chosen for the open questions (the owner can change them)
- A group chat is synced only if every bot in it is "cloud". One "local" bot makes the whole group local.
- Size limit per account: 100 MB of chats (compressed). Past it, new chats stay local and Settings says so.
- Files: not synced yet (the phone shows the name and "on your computer").

## Parts and branches (one session each, all start from `next-version` at the commit that adds this file)
| Part | Branch | Where |
|---|---|---|
| W. Website: storage and API | `cloud-web` | `web/` |
| A. Desktop app: sync and worker | `cloud-app` | `lib/`, `components/`, `app/api/` |
| M. Phone app | `cloud-mobile` | `web/app/m/` (+ `web/public/m/`) |
| R. Cloud runner and servers | `cloud-runner` | `runner/`, `infra/`, small hooks in `lib/` |
No part edits another part's folders except through the API below. Shared types live in `web/lib/cloud-types.ts`
(written by W first; others copy what they need, no imports across the app/web boundary).

## Data (website database, Postgres; tables created on first use and in `scripts/migrate.mjs`)
- `cloud_sync (user_id PK → user ON DELETE CASCADE, enabled bool, bytes int, chats int, last_sync timestamptz,
  enabled_at, disabled_at)`.
- `cloud_chat (user_id, chat_id text, version int, data jsonb (sealed: gzip+sealSecret like account_setup),
  bytes int, updated_at, deleted bool, PRIMARY KEY (user_id, chat_id))`. `data` = the app's Chat JSON (lib/types.ts
  `Chat`) without attachments' file contents.
- `cloud_vault (user_id, connector_id text, version int, data jsonb sealed, updated_at, PK (user_id, connector_id))`:
  a connector's settings AND its sign-in (tokens), so the cloud and the phone can call it. Never API keys.
- `cloud_job (id uuid PK, user_id, chat_id, kind text ('message'|'decision'|'stop'), payload jsonb sealed,
  status text ('queued'|'claimed'|'done'|'needs_computer'|'failed'), claimed_by text ('desktop:<deviceId>'|'runner:<id>'),
  lease_until timestamptz, created_at, updated_at, error text)`.
- `cloud_device (user_id, device_id text, kind ('desktop'|'phone'|'runner'), last_seen timestamptz, PK (user_id, device_id))`.
The admin console shows only counts and sizes (never `data` or `payload`).

## API (all under `/api/v1/cloud`, signed-in session as today, `getRequestSession`; JSON; `cache-control: no-store`)
- `GET  /status` → `{enabled, bytes, limit, chats, lastSync, devices:[{deviceId, kind, lastSeen, online}]}`
  (online = seen in the last 60 s).
- `PUT  /status {enabled:boolean}`. Turning off deletes all `cloud_chat`, `cloud_vault`, `cloud_job` rows of the
  account at once.
- `GET  /chats?since=<iso>` → `{chats:[{chatId, version, updatedAt, deleted, bytes}], now}` (list, no content).
- `GET  /chats/<chatId>` → `{chatId, version, chat}`.
- `PUT  /chats/<chatId> {baseVersion, chat}` → `{version}` or 409 `{version, chat}` (the client merges: entries by
  `id`, newer `updatedAt` wins per entry; then PUT again). 413 when over the account limit.
- `DELETE /chats/<chatId>` → marks deleted (kept 30 days as a tombstone so other devices remove it too).
- `GET/PUT /vault/<connectorId>` same versioning as chats; `GET /vault` lists ids and versions.
- `POST /jobs {chatId, kind, payload}` → `{jobId}`: the phone sends a message / an approval answer / Stop.
- `POST /jobs/claim {deviceId, kind:'desktop'|'runner', chatIds?: string[]}` → `{job|null}`: atomic
  (`UPDATE … WHERE status='queued' … FOR UPDATE SKIP LOCKED`), lease 120 s. Desktop claims first when online
  (see "Who runs a job"); runner claims only jobs older than 5 s with no online desktop, or chats marked cloud-only.
- `POST /jobs/<id>/heartbeat` (extends the lease), `POST /jobs/<id>/done {status, error?}`.
- `GET  /events?chatId=…&after=<version>` long-poll (25 s) or SSE: the phone waits for the chat's next version.
- Runner-only (header `x-oovi-runner: <RUNNER_SECRET>`, never a user session): `POST /runner/claim` (any account),
  `GET/PUT /runner/chats/<userId>/<chatId>`, `GET /runner/vault/<userId>/<connectorId>`,
  `POST /runner/ai/<userId>` = theOovi model call billed to that user (same as `/api/v1/ai/messages`).
Rate limits like `/api/v1/setup`. Every write bumps `cloud_sync.bytes/chats/last_sync`.

## Who runs a job (one chat, one runner at a time: the job's lease is the lock)
1. The desktop app, when it is open and the chat is synced: it claims jobs for its account every 3 s, runs them
   with its normal orchestrator (any model the user set up, all tools), and pushes the chat after each step.
2. Otherwise the cloud runner (theOovi model only; tools: chat, web search, read pages, find places, papers,
   work tables/notes, routines, connectors from the vault, Telegram). A step that needs the computer (files,
   desktop control, the bots' browser, a local connector, the user's own key) is not run: the bot answers in the
   user's language "This needs your computer: open oovi on it and I'll do it", and the job is re-queued as
   `needs_computer`; the desktop picks it up when it opens.
3. Routines marked "cloud" run on the runner when no desktop of the account is online at their time.

## Security rules (every part)
- Sealed with `sealSecret` (key in the website's environment, never in the database). The runner gets data only
  through the runner API; it holds no database credentials.
- No chat content in logs, errors, problem reports or the admin console.
- Turning sync off or deleting the account removes everything at once.
- The phone app is same-origin with the website (cookies, CSRF as the rest of the site). No API key is ever sent to
  or stored on the phone.

## Moving servers (part R)
The runner is stateless: everything lives in the website database. A server is set up with one command
(`infra/setup.sh` on any Ubuntu 22.04/24.04 machine: Docker, the runner image, automatic restarts and updates,
health check). Moving = run it on the new machine, then stop the old one. Azure-specific steps are only in
`infra/azure/` (create, delete). No data on the server, so nothing to copy.

## Changes to this file
- 2026-11-18 (owner): connectors are managed from the phone too, like on the computer: add one from the catalog,
  sign in (OAuth), turn on/off, choose which bots use it, disconnect, remove. Sign-ins started on the phone finish
  on the website: `POST /api/v1/cloud/connectors/<id>/oauth/start` → `{authUrl}`; the service redirects to
  `/api/v1/cloud/connectors/oauth/callback`, which stores the tokens in `cloud_vault` (sealed) and returns to the
  phone. `PUT /vault/<id>` from the phone for on/off/bots; `DELETE /vault/<id>` disconnects (the desktop removes it
  at its next pull). Keys typed for a connector (an API-key connector) are allowed: they belong to the connector,
  not to an AI model. AI model keys stay forbidden on the phone.
- 2026-11-18 (owner): the phone app must feel like WhatsApp / Messenger: a chat list first, bubbles, the usual
  composer (text, voice, attach), long-press menu on a message (reply, copy), swipe to reply, ticks/typing-like
  status while the bot works, unread counts, archive/pin by swipe. Familiar, never strange; Apple-style polish.
- 2026-11-18, part W (website), while building the API. Additions only; nothing above was removed. The exact shapes
  are in `web/lib/cloud-types.ts`.
  - Device header `x-oovi-device: desktop:<id>` or `phone:<id>` on any signed-in cloud request marks the device seen
    (that is how `/status` lists devices and how the runner knows a desktop is online). Claims mark it too.
  - Heartbeat and done carry who holds the job: `{deviceId}` (desktop) so another device or account can't extend or
    end it (409 = lease lost). Claim answers `{job: {jobId, chatId, kind, payload, was, createdAt, leaseUntil}}`;
    `was` = `needs_computer` tells the desktop the runner couldn't do it.
  - The runner also needs `POST /runner/jobs/<id>/heartbeat` and `/runner/jobs/<id>/done` (`{runnerId}`), and
    `PUT /runner/vault/<userId>/<connectorId>` to save a sign-in it refreshed (services that rotate tokens).
    `/runner/claim` takes `{runnerId}` and answers the job with its `userId`.
  - `DELETE /vault/<connectorId>`: a connector removed on a computer (no tombstone; the list shows it's gone).
  - `cloud_chat.data` may be NULL: a deleted chat's tombstone keeps no content. A 409 on a chat also says `deleted`.
  - Every chat, vault and job route answers 403 `sync_off` while sync is off. A job needs its chat synced (404).
    At most 100 waiting jobs per account. One chat is at most 4 MB as sent (Vercel refuses bodies over 4.5 MB).
  - `/events` also takes `jobsAfter=<iso>` and answers `{changed, version, deleted, updatedAt, jobs:[…], now}`: the
    phone sees a job become `needs_computer` or `failed` without a new chat version.
  - `GET /chats` answers `now` 5 s early on purpose: a save finishing during the read is listed again, never missed.
  - Runner claims: "chats marked cloud-only" is NOT built (no field marks them); the runner takes a job when it
    waited 5 s and no desktop of the account was seen in the last 60 s. Part A/R: say if a flag is needed.
  - `/runner/ai/<userId>` only for accounts that sync and already have theOovi credits; `POST /jobs` sets up the
    credits from the person's own address (welcome credits are limited per network, the runner's address isn't theirs).
  - Signed-in writes coming from another website (an Origin header that isn't the site) are refused (403).
- 2026-11-18, part W, connectors from the phone (built): `POST /api/v1/cloud/connectors/<id>/oauth/start {url?}` →
  `{authUrl}` (the url comes from the vault entry's `data.url`, else the body; public https only). The service
  returns to `GET /api/v1/cloud/connectors/oauth/callback`, which writes `data.oauth = {clientInfo, tokens,
  redirectUrl, signedInAt}` into the vault entry (other fields kept, version +1) and answers 303 to
  `/m/connectors?connected=<id>` or `/m/connectors?error=expired|denied|failed|signed_out|sync_off[&id=<id>]`.
  The state works once, for 10 minutes, for the same account AND session (part M: open authUrl in the same browser
  as the phone app, not a separate one, or the callback finds no session). The client is registered for the
  website's redirect address: the desktop and the runner refresh with `oauth.clientInfo` as it is. `PUT /vault`
  refuses values that look like AI model keys (sk-ant-, sk-proj-, sk-or-v1-, gsk_, xai-, old sk-…) with 400.
- 2026-11-18, part W, a sign-in that comes back to ANOTHER browser (iPhone home-screen app → Safari, another cookie
  jar). Asked by the main session. The callback no longer says signed_out: it keeps the code sealed, unused (10 minutes,
  once) and shows a small page (Arabic, French or English from the browser) with the account masked (o***@gmail.com)
  and ONE button "Yes, it's my account" (POST /connectors/oauth/confirm, the page's own hold token, no session).
  `GET /vault` answers `pending: [{flowId, connectorId, status: waiting_confirm|waiting_finish, here}]`; the app
  (here=true) calls `POST /api/v1/cloud/connectors/oauth/finish {flowId}` (only the account AND session that started
  it, once) → `{connectorId, version, data}`. `oauth/start` also answers `flowId`. Why the button (not in the request):
  without it, someone could start a sign-in on their own account, send the link to another person, and quietly
  receive that person's Notion or Gmail access when they approve it; the masked account plus the tap makes them look.
  Same session as the start: unchanged (finished at once).

- 2026-11-18, part A (desktop, branch `cloud-app`): the desktop follows part W's shapes exactly
  (`web/lib/cloud-types.ts` on `cloud-web`, commit 405b96e): header `x-oovi-device: desktop:<deviceId>`; vault
  bodies `{baseVersion, data}` / `{connectorId, version, data}` / `{items:[…]}` (a connector known at the last
  sync and absent from a successful list = removed elsewhere, so removed here); jobs `{job:{jobId, …}}`,
  heartbeat and done with `{deviceId}`; chats `{chatId, version, deleted, chat|null}`, 409 with `deleted`, 413
  `over_limit` (account full: new chats stay here) or `too_big` (that chat stays here until it changes); code
  `sync_off` = turned off on another device (stops here, keeps the chats). Also: the desktop is marked online by
  `POST /jobs/claim` every 3 s; a chat it sends never has `workspace` or `allow` (this computer's project folder
  and allowed actions), and those fields from the account are ignored; entries merge three-way by id (entries have
  no `updatedAt`; the chat's `updatedAt` decides when both sides changed one entry); from the phone it runs
  `message {text, effort?, deep?, plan?, entryId?, replyTo?}`, `decision {decisions, allowChat?} | {planDecision}
  | {answers}` and `stop`, never "always allow" for folders or edits; the vault item carries `bots: string[]`
  (which bots use the connector).
- 2026-11-18, part R (runner), additions only, nothing removed. Everything below is under `/api/v1/cloud/runner`,
  header `x-oovi-runner: <RUNNER_SECRET>` (403 without it), JSON, `cache-control: no-store`. The runner holds no
  database credentials and never logs chat content. Built and tested against a stand-in in
  `tests/e2e/runner-scenario.cjs` (the stand-in there is the exact shape the runner expects).
  - `POST /claim {runnerId, exclude?: userId[]}` → `{job: {jobId, userId, chatId, kind, payload, was, createdAt, leaseUntil, timezone?, userName?} | null}`
    (heartbeat, done and release carry `{runnerId}` in their body; see web/lib/cloud-types.ts).
    `payload` unsealed. `exclude`: accounts that already have a job on this runner (fairness; one job per account at
    a time by default). `timezone` (IANA, optional): the job's server runs in it ("today", routine times); else UTC.
    `userName` (optional): what the bots call the user. Claim rule as above (older than 5 s and no online desktop,
    or a cloud-only chat); lease 120 s; marks `cloud_device` `runner:<runnerId>`.
  - `POST /jobs/<id>/heartbeat` → 200, or 404/409/410 when this runner no longer holds the lease (it then stops the run
    and pushes nothing more). Sent every 30 s.
  - `POST /jobs/<id>/done {status: 'done'|'needs_computer'|'failed', error?}`: `error` is a short code
    (`timeout`, `server_start`, `setup`, `chat_not_found`, `server_crash`, `error`), never text from the chat.
  - `POST /jobs/<id>/release` → the job goes back to `queued` (lease cleared): the runner is stopping (SIGTERM) or
    can't take it now. 404/409 when the lease is not this runner's.
  - `GET /setup/<userId>` and `PUT /setup/<userId> {baseVersion, items}` → exactly like `GET/PUT /api/v1/setup`
    (`{version, items}`, `{version}` or 409). A job's memory, routines and lessons go back to the account this way.
  - `PUT /vault/<userId>/<connectorId> {baseVersion, data}` → `{version}` or 409: a connector's sign-in refreshed
    during a job (services that rotate refresh tokens would otherwise lock the computer out).
  - `POST /ai/<userId>`: same request and answers as `/api/v1/ai/messages` (errors `{error, code}` with their status,
    `retry-after` on 429), billed to that account.
  - Vault `data` (written by part A, read by the runner): `{name, transport: 'http', url, headers?: {name: value},
    auth?: 'oauth', oauth?: {clientInfo, tokens, …} (lib/mcp-oauth.ts OAuthData), enabled, trusted}`. The runner
    fetches only the connectors the chat's bots use. A connector that runs as a program on the computer (stdio) or
    at a private address is never run in the cloud.
  - Chat JSON may carry `work` (the chat's work tables and notes, `WorkStore` of lib/workfiles-core.ts): the runner
    reads it and sends it back with the chat. Part A: save it to `work/<chatId>.json` and send it with the chat, so
    tables made in the cloud are not lost (optional; without it they are lost after the job).
  - A message job's user entry gets the id `payload.entryId`, or `j<job id without dashes, 24 chars>` when the phone
    gives none. A job run again (released, lease lost, or a `needs_computer` job picked up by the desktop) first
    removes that entry and the bots' answers after it, then runs the message again: it is never in the chat twice.
    Part A: do the same when the desktop runs a `needs_computer` job (the cloud's "This needs your computer" reply
    is one of those answers).
