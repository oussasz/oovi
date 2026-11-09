import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { getCrashGroup } from "@/lib/admin-stats";
import { PageHead, Section } from "@/components/admin/ui";
import { fmtDateTime, fmtInt, platformLabel } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Crash" };

export default async function AdminCrashGroup({ params }: { params: Promise<{ hash: string }> }) {
  await requireAdmin();
  const { hash } = await params;
  const group = await getCrashGroup(hash);
  if (!group) notFound();
  const message = group.reports[0]!.message;

  return (
    <>
      <PageHead
        title="Crash details"
        sub={`${fmtInt(group.total)} reports from ${fmtInt(group.users)} signed-in users. Showing the latest ${group.reports.length}.`}
      >
        <Link href="/admin/crashes" className="btn btn-ghost btn-sm">
          All crashes
        </Link>
      </PageHead>

      <Section title="Error message">
        <pre className="adm-pre" style={{ marginTop: 0 }}>
          {message}
        </pre>
      </Section>

      <Section title="Recent reports">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Version</th>
                <th>Platform</th>
                <th>User</th>
                <th>Stack and context</th>
              </tr>
            </thead>
            <tbody>
              {group.reports.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td className="adm-mono">{r.appVersion}</td>
                  <td>{platformLabel(r.platform)}</td>
                  <td>
                    {r.userId ? (
                      <Link href={`/admin/users/${encodeURIComponent(r.userId)}`}>{r.email ?? "Account"}</Link>
                    ) : (
                      <span className="fine">Signed out</span>
                    )}
                  </td>
                  <td style={{ minWidth: 320 }}>
                    {r.stack || r.context ? (
                      <details className="adm-details">
                        <summary>Show stack</summary>
                        {r.stack && <pre className="adm-pre">{r.stack}</pre>}
                        {r.context && <pre className="adm-pre">{r.context}</pre>}
                      </details>
                    ) : (
                      <span className="fine">No stack</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
