// Serves one CSV report (/admin/reports/payments.csv?period=30 or period=all). Admins only: anyone else gets a
// plain 404, like the rest of the console. Every download is recorded in the audit log.
import { getAdmin } from "@/lib/admin";
import { rateLimit } from "@/lib/api";
import { audit } from "@/lib/credits";
import { parseReportPeriod, REPORTS, toCsv } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const admin = await getAdmin();
  if (!admin) return text(404, "Not found");
  const { file } = await ctx.params;
  const def = REPORTS.find((r) => r.key === file.replace(/\.csv$/i, ""));
  if (!def) return text(404, "Not found");
  if (!rateLimit(`report:${admin.id}`, 30, 10 * 60_000)) return text(429, "Too many downloads in a short time. Please wait a few minutes.");

  const days = def.period ? parseReportPeriod(new URL(req.url).searchParams.get("period")) : null;
  let t;
  try {
    t = await def.build(days);
  } catch (err) {
    console.error(`report ${def.key} failed:`, err instanceof Error ? err.message : err);
    return text(500, "This report couldn't be built. If the database was just updated, try again in a minute.");
  }
  await audit(admin.email, "report.export", def.key, { period: def.period ? (days === null ? "all" : `${days} days`) : "now", rows: t.rows.length, truncated: t.truncated }).catch(() => {});

  const stamp = new Date().toISOString().slice(0, 10);
  const range = !def.period ? "" : days === null ? "-all" : `-${days}d`;
  return new Response(toCsv(t), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="oovi-${def.key}${range}-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      "X-Report-Rows": String(t.rows.length),
      "X-Report-Truncated": t.truncated ? "yes" : "no",
    },
  });
}
