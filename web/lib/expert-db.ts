// Expert applications (the form at /experts/apply, reviewed in Admin > Experts). The table is created on first use
// (and in scripts/migrate.mjs) the same careful way as the other late additions: a short lock wait, and a failure
// never breaks anything else on the site.
import { pool } from "./db";
import { STATUSES, type ExpertInput, type ExpertStatus } from "./expert-form";

const g = globalThis as typeof globalThis & { __ooviExperts?: { ok: boolean; at: number; run?: Promise<boolean> } };

export async function ensureExpertTable(): Promise<boolean> {
  const s = (g.__ooviExperts ??= { ok: false, at: 0 });
  if (s.ok) return true;
  if (s.run) return s.run;
  if (s.at && Date.now() - s.at < 60_000) return false;
  s.run = (async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '3s'");
      await c.query(`
        CREATE TABLE IF NOT EXISTS expert_applications (
          id                  BIGSERIAL PRIMARY KEY,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
          status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'declined')),
          name                TEXT NOT NULL,
          email               TEXT NOT NULL,
          profile_url         TEXT NOT NULL,
          field               TEXT NOT NULL,
          bio                 TEXT NOT NULL,
          languages           TEXT[] NOT NULL DEFAULT '{}',
          known_as            TEXT NULL,
          consent_version     TEXT NOT NULL,
          consent_text_hash   TEXT NOT NULL,
          signed_name         TEXT NOT NULL,
          signature_png       BYTEA NULL,
          ip_hash             TEXT NULL,
          user_agent          TEXT NULL,
          reviewed_at         TIMESTAMPTZ NULL,
          reviewed_by         TEXT NULL,
          review_note         TEXT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS expert_applications_email_idx ON expert_applications (email);
        CREATE INDEX IF NOT EXISTS expert_applications_status_idx ON expert_applications (status, created_at DESC);
      `);
      await c.query("COMMIT");
      s.ok = true;
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      console.error("expert applications table not ready:", err instanceof Error ? err.message : err);
      s.ok = false;
    } finally {
      c.release();
      s.at = Date.now();
      s.run = undefined;
    }
    return s.ok;
  })();
  return s.run;
}

/** Applications in the last 24 hours: a global brake on floods (each row can hold a small picture). */
export async function applicationsToday(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM expert_applications WHERE created_at > now() - interval '1 day'");
  return Number(rows[0]?.n ?? 0);
}

/**
 * Saves a request. The same email again: while the first one is still "new" it is replaced by the newer one (people
 * correct a typo); once it was accepted or declined the new one is ignored. Either way the caller shows the same thank-you.
 * `saved` is "new" for a first request, "updated" for a replaced one, "ignored" when it was already reviewed.
 */
export async function saveApplication(
  v: ExpertInput,
  meta: { consentVersion: string; consentHash: string; ipHash: string | null; userAgent: string },
): Promise<"new" | "updated" | "ignored"> {
  const res = await pool.query<{ inserted: boolean }>(
    `INSERT INTO expert_applications
       (name, email, profile_url, field, bio, languages, known_as, consent_version, consent_text_hash, signed_name, signature_png, ip_hash, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, $9, $10, $11, $12, $13)
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name, profile_url = EXCLUDED.profile_url, field = EXCLUDED.field, bio = EXCLUDED.bio,
       languages = EXCLUDED.languages, known_as = EXCLUDED.known_as, consent_version = EXCLUDED.consent_version,
       consent_text_hash = EXCLUDED.consent_text_hash, signed_name = EXCLUDED.signed_name, signature_png = EXCLUDED.signature_png,
       ip_hash = EXCLUDED.ip_hash, user_agent = EXCLUDED.user_agent, created_at = now()
     WHERE expert_applications.status = 'new'
     RETURNING (xmax = 0) AS inserted`,
    [v.name, v.email, v.profileUrl, v.field, v.bio, v.languages, v.knownAs, meta.consentVersion, meta.consentHash, v.signedName, v.signature, meta.ipHash, meta.userAgent.slice(0, 300) || null],
  );
  if (!res.rows[0]) return "ignored";
  return res.rows[0].inserted ? "new" : "updated";
}

export type ExpertRow = {
  id: string;
  created_at: Date;
  status: ExpertStatus;
  name: string;
  email: string;
  profile_url: string;
  field: string;
  bio: string;
  languages: string[];
  known_as: string | null;
  consent_version: string;
  consent_text_hash: string;
  signed_name: string;
  has_signature: boolean;
  ip_hash: string | null;
  user_agent: string | null;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  review_note: string | null;
};

const COLS = `id::text, created_at, status, name, email, profile_url, field, bio, languages, known_as, consent_version, consent_text_hash,
  signed_name, (signature_png IS NOT NULL) AS has_signature, ip_hash, user_agent, reviewed_at, reviewed_by, review_note`;

export async function listApplications(status: ExpertStatus | null): Promise<{ rows: ExpertRow[]; counts: Record<ExpertStatus, number> }> {
  await ensureExpertTable();
  const [list, counts] = await Promise.all([
    pool.query<ExpertRow>(`SELECT ${COLS} FROM expert_applications WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 500`, [status]),
    pool.query<{ status: ExpertStatus; n: string }>("SELECT status, count(*)::text AS n FROM expert_applications GROUP BY status"),
  ]);
  const c = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<ExpertStatus, number>;
  for (const r of counts.rows) c[r.status] = Number(r.n);
  return { rows: list.rows, counts: c };
}

export async function getApplication(id: string): Promise<ExpertRow | null> {
  await ensureExpertTable();
  const { rows } = await pool.query<ExpertRow>(`SELECT ${COLS} FROM expert_applications WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getSignature(id: string): Promise<Buffer | null> {
  await ensureExpertTable();
  const { rows } = await pool.query<{ signature_png: Buffer | null }>("SELECT signature_png FROM expert_applications WHERE id = $1", [id]);
  return rows[0]?.signature_png ?? null;
}

export async function setApplicationStatus(id: string, status: ExpertStatus, by: string, note: string): Promise<ExpertStatus | null> {
  await ensureExpertTable();
  // The previous status comes back so the audit log can say what changed.
  const { rows } = await pool.query<{ prev: ExpertStatus }>(
    `UPDATE expert_applications n SET status = $2, review_note = NULLIF($4, ''),
            reviewed_at = CASE WHEN $2 = 'new' THEN NULL ELSE now() END, reviewed_by = CASE WHEN $2 = 'new' THEN NULL ELSE $3 END
       FROM expert_applications o WHERE n.id = $1 AND o.id = n.id RETURNING o.status AS prev`,
    [id, status, by, note],
  );
  return rows[0]?.prev ?? null;
}
