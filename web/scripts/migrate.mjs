// Creates/updates the Better Auth tables and the crash_reports table on the Neon database.
// Usage: npm run db:migrate   (reads DATABASE_URL_UNPOOLED / DATABASE_URL from .env.local)
// Keep the auth schema below in sync with lib/auth.ts (additionalFields).
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

const { rows } = await pool.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
);
console.log("Tables:", rows.map((r) => r.table_name).join(", "));
await pool.end();
