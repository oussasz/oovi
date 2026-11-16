import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { listApplications } from "@/lib/expert-db";
import { LANGUAGES, STATUSES, STATUS_LABEL, type ExpertStatus } from "@/lib/expert-form";
import { CsvButton } from "@/components/admin/CsvButton";
import { Empty, FilterLinks, PageHead, Section } from "@/components/admin/ui";
import { fmtDateTime } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Experts" };

export default async function AdminExperts({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as ExpertStatus) ? (sp.status as ExpertStatus) : null;
  const { rows, counts } = await listApplications(status);
  const total = counts.new + counts.accepted + counts.declined;
  const langs = (l: string[]) => l.map((x) => LANGUAGES.find((y) => y.value === x)?.label ?? x).join(", ");

  return (
    <>
      <PageHead
        title="Experts"
        sub={
          <>
            People who asked, on <Link href="/experts/apply" className="text-link">the website form</Link>, to be added as an expert. Accepting an application publishes nothing: the next step is to agree the details with the
            person in writing, then add the expert in <Link href="/admin/marketplace" className="text-link">Admin › Marketplace</Link>.
          </>
        }
      >
        <CsvButton report="expert-applications" period="all" />
      </PageHead>

      <Section
        title={`Applications (${total})`}
        actions={
          <FilterLinks
            label="Status"
            items={[
              { href: "/admin/experts", text: `All ${total}`, on: status === null },
              ...STATUSES.map((s) => ({ href: `/admin/experts?status=${s}`, text: `${STATUS_LABEL[s]} ${counts[s]}`, on: status === s })),
            ]}
          />
        }
      >
        {rows.length === 0 ? (
          <Empty>No applications{status ? ` that are ${STATUS_LABEL[status].toLowerCase()}` : " yet"}.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Name</th>
                  <th>Expert in</th>
                  <th>Languages</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{fmtDateTime(r.created_at.toISOString())}</td>
                    <td>
                      <Link href={`/admin/experts/view?id=${r.id}`}>{r.name}</Link>
                      <div className="adm-sub">{r.email}</div>
                    </td>
                    <td>{r.field}</td>
                    <td>{langs(r.languages)}</td>
                    <td>
                      <span className={`adm-badge${r.status === "accepted" ? " on" : ""}`}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td>
                      <Link href={`/admin/experts/view?id=${r.id}`} className="btn btn-light btn-sm">
                        Open
                      </Link>
                    </td>
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
