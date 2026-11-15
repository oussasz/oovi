// "Ask to update" (Admin > Users): an email to the people whose app is older than the latest release. Each
// person is asked once per version (remembered in admin_audit, action "update.ask"), blocked accounts and
// unconfirmed emails are left out, and nothing is sent without the owner pressing the button.
import { pool } from "./db";
import { listReleases } from "./releases";
import { compareVersions } from "./versions";

export type Behind = { email: string; name: string | null; version: string; platform: string | null };

/** The newest released version ("0.10.13"), or null when the releases can't be read. */
export async function latestVersion(): Promise<string | null> {
  const r = (await listReleases())[0];
  const v = r?.tag_name.replace(/^v/i, "") ?? "";
  return /^\d+\.\d+\.\d+$/.test(v) ? v : null;
}

/** People on an older app than `latest`, not asked yet for this version. */
export async function peopleBehind(latest: string): Promise<Behind[]> {
  const [users, asked] = await Promise.all([
    pool.query<{ email: string; name: string | null; last_app_version: string; last_platform: string | null }>(
      `SELECT email, name, last_app_version, last_platform FROM "user"
        WHERE last_app_version IS NOT NULL AND "emailVerified" = true AND COALESCE(oovi_status, 'active') <> 'blocked'`,
    ),
    pool.query<{ target: string }>(`SELECT DISTINCT target FROM admin_audit WHERE action = 'update.ask' AND detail->>'version' = $1`, [latest]),
  ]);
  const done = new Set(asked.rows.map((r) => r.target.toLowerCase()));
  return users.rows
    .filter((u) => /^\d/.test(u.last_app_version) && compareVersions(u.last_app_version, latest) < 0 && !done.has(u.email.toLowerCase()))
    .map((u) => ({ email: u.email, name: u.name, version: u.last_app_version, platform: u.last_platform }))
    .sort((a, b) => compareVersions(a.version, b.version));
}
