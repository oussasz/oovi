// What is waiting for the owner, as small numbers in the admin menu (components/admin/nav-config.ts):
// new feedback from people, problems reported this week and not fixed, crashes in the last day, pilot
// requests and expert applications to answer. Each count fails alone (a missing table = 0).
import { pool } from "./db";
import type { BadgeKey } from "@/components/admin/nav-config";

const one = (sql: string) =>
  pool
    .query(sql)
    .then((r) => Number(r.rows[0]?.n ?? 0))
    .catch(() => 0);

export async function adminBadges(): Promise<Record<BadgeKey, number>> {
  const [feedback, problems, crashes, pilot, experts] = await Promise.all([
    one("SELECT count(*) AS n FROM feedback WHERE status = 'new' AND source <> 'bot'"),
    one(`SELECT count(DISTINCT f.problem_key) AS n FROM feedback f LEFT JOIN problem_fixes x ON x.problem_key = f.problem_key
          WHERE f.problem_key IS NOT NULL AND f.created_at > now() - interval '7 days' AND x.problem_key IS NULL`),
    one("SELECT count(*) AS n FROM crash_reports WHERE created_at > now() - interval '24 hours'"),
    one("SELECT count(*) AS n FROM pilot_requests WHERE status = 'pending'"),
    one("SELECT count(*) AS n FROM expert_applications WHERE status = 'new'"),
  ]);
  return { feedback, problems, crashes, pilot, experts };
}
