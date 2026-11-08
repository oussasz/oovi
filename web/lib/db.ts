import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __ooviPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL?.replace("sslmode=require", "sslmode=verify-full");
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
}

export const pool: Pool = globalThis.__ooviPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__ooviPool = pool;
