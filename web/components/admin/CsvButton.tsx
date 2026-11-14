/** A "Download CSV" link for one report (see lib/reports.ts). `period` is a number of days or "all". */
export function CsvButton({ report, period, label = "Download CSV", className = "btn btn-light btn-sm" }: { report: string; period?: number | "all"; label?: string; className?: string }) {
  const q = period === undefined ? "" : `?period=${period}`;
  return (
    <a href={`/admin/reports/${report}.csv${q}`} className={className} download>
      {label}
    </a>
  );
}
