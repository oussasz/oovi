import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { emailsFor, listAudit } from "@/lib/ai-admin";
import { Empty, PageHead, Section } from "@/components/admin/ui";
import { fmtDateTime } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit log" };

const ACTION_LABELS: Record<string, string> = {
  "ai.pause": "Paused theOovi",
  "ai.resume": "Resumed theOovi",
  "ai.settings": "Changed theOovi settings",
  "ai.key.replace": "Replaced the provider API key",
  "ai.key.remove": "Removed the provider API key",
  "plans.save": "Changed plans",
  "pilot.settings": "Changed pilot settings",
  "pilot.approve": "Approved a pilot request",
  "pilot.reject": "Rejected a pilot request",
  "credits.adjust": "Changed credits",
  "plan.set": "Set a plan",
  "limit.set": "Set a daily-limit override",
  "limit.clear": "Cleared the daily-limit override",
  "usage.reset_today": "Reset today’s usage",
  "ai.user_on": "Turned theOovi on for an account",
  "ai.user_off": "Turned theOovi off for an account",
  "account.block": "Blocked an account",
  "account.unblock": "Unblocked an account",
  "feedback.update": "Updated feedback",
};

function detailText(d: unknown): string {
  if (d === null || d === undefined) return "";
  try {
    const s = JSON.stringify(d);
    return s.length > 600 ? `${s.slice(0, 600)}…` : s;
  } catch {
    return "";
  }
}

export default async function AdminAudit() {
  await requireAdmin();
  const rows = await listAudit(200);
  const emails = await emailsFor(rows.map((r) => r.target ?? ""));

  return (
    <>
      <PageHead title="Audit log" sub="Every change made in the console, newest first (latest 200)." />
      <Section title="Admin actions">
        {rows.length === 0 ? (
          <Empty>No admin actions recorded yet.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Admin</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const email = r.target ? emails.get(r.target) : undefined;
                  return (
                    <tr key={r.id}>
                      <td className="nowrap">{fmtDateTime(r.createdAt)}</td>
                      <td>{r.adminEmail}</td>
                      <td>
                        {ACTION_LABELS[r.action] ?? r.action}
                        <div className="adm-mono fine">{r.action}</div>
                      </td>
                      <td>
                        {email && r.target ? (
                          <Link href={`/admin/users/${encodeURIComponent(r.target)}`}>{email}</Link>
                        ) : (
                          <span className="adm-mono">{r.target ?? "–"}</span>
                        )}
                      </td>
                      <td className="adm-mono adm-detail">{detailText(r.detail)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
