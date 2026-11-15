import { pool } from "./db";
import { isVersion, normalizeNotes, type Notes, type NotesMap } from "./release-notes";

// What the owner saved in Admin > Release notes: { "0.10.13": { headline, sections, hidden } }, one app_config row.

/** Never throws: if the database can't be read, the page falls back to the shipped text. */
export async function getNotesOverrides(): Promise<NotesMap> {
  try {
    const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'release_notes'");
    const v = rows[0]?.value;
    const out: NotesMap = {};
    if (v && typeof v === "object") {
      for (const [version, notes] of Object.entries(v as Record<string, unknown>)) {
        if (isVersion(version)) out[version] = normalizeNotes(notes);
      }
    }
    return out;
  } catch (err) {
    console.error("release notes read failed", err instanceof Error ? err.message : err);
    return {};
  }
}

/** Save one version's notes, or put it back to the default when `notes` is null. */
export async function saveNotesOverride(version: string, notes: Notes | null, by: string): Promise<void> {
  if (!isVersion(version)) throw new Error("bad version");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // Two admins saving at once must not lose each other's change.
    await c.query("SELECT pg_advisory_xact_lock(hashtext('release_notes'))");
    const { rows } = await c.query("SELECT value FROM app_config WHERE key = 'release_notes' FOR UPDATE");
    const all: Record<string, unknown> = rows[0]?.value && typeof rows[0].value === "object" ? { ...(rows[0].value as object) } : {};
    if (notes) all[version] = normalizeNotes(notes);
    else delete all[version];
    await c.query(
      `INSERT INTO app_config (key, value, updated_at, updated_by) VALUES ('release_notes', $1::jsonb, now(), $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(all), by],
    );
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
