import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { listUsers, USERS_PAGE_SIZE, type UserListRow } from "@/lib/admin-stats";
import { getPlans, type Plan } from "@/lib/ai-config";
import { assess, countryLabel, getSignals } from "@/lib/user-signals";
import { VerdictBadge } from "@/components/admin/Verdict";
import { Empty, PageHead, Section } from "@/components/admin/ui";
import { fmtAgo, fmtDate, fmtInt, fmtNumber, platformLabel } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Users" };

type SP = { q?: string; page?: string };

const credits = (v: number) => fmtNumber(Math.round(v * 10) / 10);

function todayCell(u: UserListRow, plans: Map<string, Plan>): string {
  if (!u.credits) return "–";
  const limit = u.credits.dailyLimitOverride ?? plans.get(u.credits.plan)?.dailyLimit ?? plans.get("free")?.dailyLimit ?? 0;
  return `${credits(u.credits.todayUsed)} / ${limit === 0 ? "no limit" : fmtInt(limit)}${u.credits.dailyLimitOverride !== null ? " *" : ""}`;
}

function StatusBadge({ u }: { u: UserListRow }) {
  if (u.status === "blocked") return <span className="adm-badge warn">Blocked</span>;
  if (u.credits && !u.credits.aiEnabled) return <span className="adm-badge">theOovi off</span>;
  return <span className="adm-badge on">Active</span>;
}

function pageHref(q: string, page: number) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return `/admin/users${s ? `?${s}` : ""}`;
}

export default async function AdminUsers({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const page = Math.min(10_000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const [{ rows, total }, planList] = await Promise.all([listUsers(q, page), getPlans()]);
  const plans = new Map(planList.map((p) => [p.id, p]));
  // Country and "does it look like a person?". Null if the signal columns can't be read: the list still works.
  const signals = await getSignals(rows.map((r) => r.id));
  const verdicts = new Map(rows.map((r) => [r.id, signals?.get(r.id) ? assess(r, signals.get(r.id)!) : null]));
  const flagged = [...verdicts.values()].filter((v) => v?.level === "suspicious").length;
  const pages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
  const from = total ? (page - 1) * USERS_PAGE_SIZE + 1 : 0;
  const to = Math.min(total, page * USERS_PAGE_SIZE);

  return (
    <>
      <PageHead
        title="Users"
        sub={`Everyone with an oovi account, newest first. Credits are theOovi credits; “–” means they haven’t used theOovi or opened their account page yet. * = daily limit set by hand.${flagged ? ` ${flagged} on this page look suspicious.` : ""}`}
      />
      <Section
        title={q ? `Results for “${q}”` : "All accounts"}
        actions={
          <form className="adm-search" role="search" action="/admin/users">
            <label htmlFor="user-q" className="sr-only">
              Search by email or name
            </label>
            <input id="user-q" className="input" type="search" name="q" defaultValue={q} placeholder="Search email or name" maxLength={100} />
            <button className="btn btn-dark btn-sm" type="submit">
              Search
            </button>
            {q && (
              <Link className="btn btn-ghost btn-sm" href="/admin/users">
                Clear
              </Link>
            )}
          </form>
        }
      >
        {rows.length === 0 ? (
          <Empty>{q ? "No accounts match that search." : "No accounts yet."}</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Check</th>
                  <th>Country</th>
                  <th>Plan</th>
                  <th className="num">Balance</th>
                  <th className="num">Today used / limit</th>
                  <th>Created</th>
                  <th>Last seen in app</th>
                  <th>App version</th>
                  <th>Platform</th>
                  <th>Terms</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/admin/users/${encodeURIComponent(u.id)}`}>{u.email}</Link>
                    </td>
                    <td>{u.name || "–"}</td>
                    <td>
                      <StatusBadge u={u} />
                    </td>
                    <td>
                      <VerdictBadge v={verdicts.get(u.id) ?? null} />
                    </td>
                    <td>{signals?.get(u.id) ? countryLabel(signals.get(u.id)!.lastCountry ?? signals.get(u.id)!.signupCountry) : "–"}</td>
                    <td>{u.credits ? (plans.get(u.credits.plan)?.name ?? u.credits.plan) : "–"}</td>
                    <td className="num">{u.credits ? credits(u.credits.balance) : "–"}</td>
                    <td className="num">{todayCell(u, plans)}</td>
                    <td className="nowrap">{fmtDate(u.createdAt)}</td>
                    <td className="nowrap">{fmtAgo(u.lastSeenAt)}</td>
                    <td className="adm-mono">{u.appVersion ?? "–"}</td>
                    <td>{platformLabel(u.platform)}</td>
                    <td className="nowrap">{u.termsVersion ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="adm-pager">
          <span>
            {total ? `${fmtInt(from)}–${fmtInt(to)} of ${fmtInt(total)}` : "0 accounts"}
          </span>
          <span className="adm-row-actions">
            {page > 1 && (
              <Link className="btn btn-ghost btn-sm" href={pageHref(q, page - 1)}>
                Previous
              </Link>
            )}
            {page < pages && (
              <Link className="btn btn-ghost btn-sm" href={pageHref(q, page + 1)}>
                Next
              </Link>
            )}
          </span>
        </div>
      </Section>
    </>
  );
}
