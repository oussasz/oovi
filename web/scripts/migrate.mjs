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

const { rows } = await pool.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
);
console.log("Tables:", rows.map((r) => r.table_name).join(", "));
await pool.end();
