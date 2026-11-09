// Creates/updates the Better Auth tables and oovi's own tables on the Neon database.
// Usage: npm run db:migrate   (reads DATABASE_URL_UNPOOLED / DATABASE_URL from .env.local)
// Keep the auth schema below in sync with lib/auth.ts (additionalFields).
// Everything here is additive and safe to run again (IF NOT EXISTS).
//
// Environment variables used by the website:
//   DATABASE_URL / DATABASE_URL_UNPOOLED  Neon Postgres connection strings
//   BETTER_AUTH_SECRET, BETTER_AUTH_URL    Better Auth signing secret and public base URL
//   ADMIN_EMAILS                           comma-separated emails allowed into /admin
//                                          (case-insensitive; unset = nobody is an admin)
//   PUBLIC_RELEASES_REPO, GITHUB_REPO, GITHUB_RELEASES_TOKEN  installer downloads
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const pool = new Pool({ connectionString, max: 1 });

const options = {
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET || "migration-only-secret-not-used-for-signing-0000",
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      termsVersion: { type: "string", required: false, input: true },
      termsAcceptedAt: { type: "date", required: false, input: false },
    },
  },
};

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(options);
console.log(
  "Better Auth: tables to create:",
  toBeCreated.map((t) => t.table).join(", ") || "none",
  "| tables to alter:",
  toBeAdded.map((t) => t.table).join(", ") || "none",
);
await runMigrations();

await pool.query(`
  CREATE TABLE IF NOT EXISTS crash_reports (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    app_version TEXT NOT NULL,
    platform    TEXT NOT NULL,
    message     TEXT NOT NULL,
    stack       TEXT NULL,
    context     TEXT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS crash_reports_created_at_idx ON crash_reports (created_at DESC);
  CREATE INDEX IF NOT EXISTS crash_reports_user_id_idx ON crash_reports (user_id);
`);
console.log("crash_reports: ok");

// Product analytics. No IP addresses are ever stored here.
await pool.query(`
  CREATE TABLE IF NOT EXISTS app_events (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    platform    TEXT NULL,
    app_version TEXT NULL,
    data        JSONB NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS app_events_kind_created_at_idx ON app_events (kind, created_at DESC);
  CREATE INDEX IF NOT EXISTS app_events_user_id_created_at_idx ON app_events (user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS usage_daily (
    user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    day         DATE NOT NULL,
    app_version TEXT NULL,
    platform    TEXT NULL,
    counts      JSONB NOT NULL,
    totals      JSONB NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day)
  );
  CREATE INDEX IF NOT EXISTS usage_daily_day_idx ON usage_daily (day);

  CREATE TABLE IF NOT EXISTS catalog_items (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('connector', 'skill', 'plugin')),
    data        JSONB NOT NULL,
    published   BOOLEAN NOT NULL DEFAULT false,
    sort        INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS catalog_items_published_sort_idx ON catalog_items (published, sort);

  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NULL;
  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_app_version TEXT NULL;
  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_platform TEXT NULL;
`);
console.log("app_events, usage_daily, catalog_items, user activity columns: ok");

// theOovi: credits, the hosted model, pilot program, feedback and the admin audit log.
// Credits are stored in millicredits (1 credit = 1000) so small calls add up exactly.
await pool.query(`
  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS oovi_status TEXT NOT NULL DEFAULT 'active';
  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS oovi_status_reason TEXT NULL;

  CREATE TABLE IF NOT EXISTS app_config (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  TEXT NULL
  );

  CREATE TABLE IF NOT EXISTS credit_accounts (
    user_id              TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
    balance_mc           BIGINT NOT NULL DEFAULT 0,
    plan                 TEXT NOT NULL DEFAULT 'free',
    plan_until           TIMESTAMPTZ NULL,
    plan_renews_at       TIMESTAMPTZ NULL,
    daily_limit_override INT NULL,
    ai_enabled           BOOLEAN NOT NULL DEFAULT true,
    day                  DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
    day_used_mc          BIGINT NOT NULL DEFAULT 0,
    held_mc              BIGINT NOT NULL DEFAULT 0,
    inflight             INT NOT NULL DEFAULT 0,
    held_at              TIMESTAMPTZ NULL,
    total_used_mc        BIGINT NOT NULL DEFAULT 0,
    grant_ip_hash        TEXT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS credit_accounts_grant_ip_idx ON credit_accounts (grant_ip_hash, created_at);
  CREATE INDEX IF NOT EXISTS credit_accounts_plan_idx ON credit_accounts (plan);

  CREATE TABLE IF NOT EXISTS credit_ledger (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    delta_mc    BIGINT NOT NULL,
    kind        TEXT NOT NULL,
    note        TEXT NULL,
    actor       TEXT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS credit_ledger_kind_idx ON credit_ledger (kind, created_at DESC);

  CREATE TABLE IF NOT EXISTS ai_usage_daily (
    user_id        TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    day            DATE NOT NULL,
    calls          INT NOT NULL DEFAULT 0,
    errors         INT NOT NULL DEFAULT 0,
    blocked        INT NOT NULL DEFAULT 0,
    input_tokens   BIGINT NOT NULL DEFAULT 0,
    output_tokens  BIGINT NOT NULL DEFAULT 0,
    cache_read     BIGINT NOT NULL DEFAULT 0,
    cache_write    BIGINT NOT NULL DEFAULT 0,
    cost_usd       NUMERIC(14, 6) NOT NULL DEFAULT 0,
    credits_mc     BIGINT NOT NULL DEFAULT 0,
    latency_ms     BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );
  CREATE INDEX IF NOT EXISTS ai_usage_daily_day_idx ON ai_usage_daily (day);

  CREATE TABLE IF NOT EXISTS pilot_requests (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
    use_case      TEXT NOT NULL,
    organization  TEXT NULL,
    role          TEXT NULL,
    team_size     TEXT NULL,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    credits       INT NULL,
    admin_note    TEXT NULL,
    reviewed_by   TEXT NULL,
    reviewed_at   TIMESTAMPTZ NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS pilot_requests_status_idx ON pilot_requests (status, created_at DESC);

  CREATE TABLE IF NOT EXISTS feedback (
    id           BIGSERIAL PRIMARY KEY,
    user_id      TEXT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('problem', 'improvement', 'other')),
    message      TEXT NOT NULL,
    source       TEXT NOT NULL DEFAULT 'web',
    app_version  TEXT NULL,
    platform     TEXT NULL,
    status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'done')),
    admin_note   TEXT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback (status, created_at DESC);

  CREATE TABLE IF NOT EXISTS admin_audit (
    id          BIGSERIAL PRIMARY KEY,
    admin_email TEXT NOT NULL,
    action      TEXT NOT NULL,
    target      TEXT NULL,
    detail      JSONB NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit (created_at DESC);
`);
console.log("theOovi credits, pilot, feedback and audit tables: ok");

// Paddle billing: a mirror of Paddle customers and subscriptions (written only from verified
// webhooks), the payments that granted credits, and the events already handled. These rows are
// live billing state: never delete them to tidy up.
await pool.query(`
  CREATE TABLE IF NOT EXISTS customers (
    customer_id        TEXT PRIMARY KEY,
    user_id            TEXT NULL REFERENCES "user"(id) ON DELETE SET NULL,
    email              TEXT NOT NULL DEFAULT '',
    paddle_updated_at  TIMESTAMPTZ NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS customers_user_idx ON customers (user_id);
  CREATE INDEX IF NOT EXISTS customers_email_idx ON customers (lower(email));

  CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id          TEXT PRIMARY KEY,
    customer_id              TEXT NOT NULL REFERENCES customers(customer_id),
    user_id                  TEXT NULL REFERENCES "user"(id) ON DELETE SET NULL,
    status                   TEXT NOT NULL,
    price_id                 TEXT NOT NULL,
    product_id               TEXT NOT NULL,
    billing_interval         TEXT NULL,
    current_period_ends_at   TIMESTAMPTZ NULL,
    scheduled_change_action  TEXT NULL,
    scheduled_change_at      TIMESTAMPTZ NULL,
    paddle_updated_at        TIMESTAMPTZ NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions (user_id);
  CREATE INDEX IF NOT EXISTS subscriptions_customer_idx ON subscriptions (customer_id);

  CREATE TABLE IF NOT EXISTS paddle_transactions (
    transaction_id   TEXT PRIMARY KEY,
    user_id          TEXT NULL REFERENCES "user"(id) ON DELETE SET NULL,
    customer_id      TEXT NULL,
    subscription_id  TEXT NULL,
    price_id         TEXT NULL,
    plan_id          TEXT NULL,
    credits_mc       BIGINT NOT NULL DEFAULT 0,
    period_ends_at   TIMESTAMPTZ NULL,
    refunded_at      TIMESTAMPTZ NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS paddle_transactions_user_idx ON paddle_transactions (user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS paddle_events (
    event_id     TEXT PRIMARY KEY,
    event_type   TEXT NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);
console.log("Paddle billing tables: ok");

const { rows } = await pool.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
);
console.log("Tables:", rows.map((r) => r.table_name).join(", "));
await pool.end();
