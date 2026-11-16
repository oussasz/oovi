import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { listAnnouncements } from "@/lib/announcements";
import { Empty, PageHead, Section } from "@/components/admin/ui";
import { fmtAgo, fmtInt } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Announcements" };

export default async function AdminAnnouncements() {
  await requireAdmin();
  const list = await listAnnouncements();
  return (
    <>
      <PageHead title="Announcements" sub="News for your users (a new expert, a new feature), designed in HTML: a window and a bar in the app, and email.">
        <Link href="/admin/announcements/edit" className="btn btn-dark btn-sm">
          New announcement
        </Link>
      </PageHead>
      <Section title="All announcements">
        {list.length === 0 ? (
          <Empty>No announcements yet. Press “New announcement” to write the first one.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Channels</th>
                  <th>Who</th>
                  <th>Status</th>
                  <th className="num">Seen</th>
                  <th className="num">Closed</th>
                  <th className="num">Emailed</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/admin/announcements/edit?id=${a.id}`}>{a.title}</Link>
                    </td>
                    <td>{[a.window && "Window", a.bar && "Bar", a.email && "Email"].filter(Boolean).join(", ")}</td>
                    <td>{a.testEmail ? `Test: ${a.testEmail}` : "Everyone"}</td>
                    <td>
                      <span className={`adm-badge${a.status === "live" ? " on" : ""}`}>{a.status === "live" ? "Live" : a.status === "ended" ? "Ended" : "Draft"}</span>
                    </td>
                    <td className="num">{fmtInt(a.stats.shown ?? 0)}</td>
                    <td className="num">{fmtInt(a.stats.closed ?? 0)}</td>
                    <td className="num">{fmtInt(a.stats.emailed ?? 0)}</td>
                    <td className="nowrap">{fmtAgo(a.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
