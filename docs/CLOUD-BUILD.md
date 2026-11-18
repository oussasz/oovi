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
