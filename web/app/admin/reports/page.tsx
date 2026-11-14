import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { parseReportPeriod, REPORTS, ROW_LIMIT } from "@/lib/reports";
import { CsvButton } from "@/components/admin/CsvButton";
import { PageHead, Section } from "@/components/admin/ui";
import { fmtInt } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reports" };

const PERIODS: { value: string; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "all", label: "Everything" },
];
const GROUPS = ["Money", "Product use", "People"] as const;

export default async function AdminReports({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireAdmin();
  const raw = (await searchParams).period;
  const days = parseReportPeriod(raw);
  const current = days === null ? "all" : String(days);

  return (
    <>
      <PageHead
        title="Reports"
        sub={`Download any of these as a CSV file to open in a spreadsheet or to share for analysis. Dates are UTC and money is in normal units (10.5 = $10.50). Each file holds up to ${fmtInt(ROW_LIMIT)} rows. Some contain people's emails, so keep them private. Every download is written to the Audit log.`}
      >
        <nav className="seg adm-seg" aria-label="Time period">
          {PERIODS.map((p) => (
            <Link key={p.value} href={`/admin/reports?period=${p.value}`} className={p.value === current ? "on" : undefined} aria-current={p.value === current ? "page" : undefined}>
              {p.label}
            </Link>
          ))}
        </nav>
      </PageHead>

      {GROUPS.map((g) => (
        <Section key={g} title={g}>
          <ul className="adm-list">
            {REPORTS.filter((r) => r.group === g).map((r) => (
              <li key={r.key} className="adm-list-item">
                <div className="adm-list-head">
                  <span className="adm-strong">{r.title}</span>
                  <span className="fine">{r.period ? (days === null ? "everything" : `last ${days} days`) : "as it is now"}</span>
                </div>
                <p className="adm-sub">{r.description}</p>
                <div>
                  <CsvButton report={r.key} period={r.period ? (current === "all" ? "all" : Number(current)) : undefined} className="btn btn-dark btn-sm" />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </>
  );
}
