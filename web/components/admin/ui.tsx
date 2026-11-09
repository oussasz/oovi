import Link from "next/link";
import type { ReactNode } from "react";
import { PERIODS, type Period } from "@/lib/admin-stats";
import { fmtInt } from "./format";

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="adm-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="adm-sub">{sub}</p>}
      </div>
      {children && <div className="adm-head-actions">{children}</div>}
    </div>
  );
}

/** 7 / 30 / 90 day switch (or custom `periods`), kept in the URL (?period=). */
export function PeriodPicker({
  period,
  path,
  params = {},
  periods = PERIODS,
  label = (p) => `${p} days`,
}: {
  period: Period | number;
  path: string;
  params?: Record<string, string>;
  periods?: readonly number[];
  label?: (p: number) => string;
}) {
  return (
    <nav className="seg adm-seg" aria-label="Time period">
      {periods.map((p) => {
        const q = new URLSearchParams({ ...params, period: String(p) });
        return (
          <Link key={p} href={`${path}?${q}`} className={p === period ? "on" : undefined} aria-current={p === period ? "page" : undefined}>
            {label(p)}
          </Link>
        );
      })}
    </nav>
  );
}

/** A row of filter links (status, kind…), kept in the URL. */
export function FilterLinks({
  label,
  items,
}: {
  label: string;
  items: { href: string; text: string; on: boolean }[];
}) {
  return (
    <nav className="adm-seg adm-filter" aria-label={label}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={i.on ? "on" : undefined} aria-current={i.on ? "page" : undefined}>
          {i.text}
        </Link>
      ))}
    </nav>
  );
}

export type Change = { value: number; previous: number | null };

function changeText(c: Change, periodLabel: string): { text: string; tone: "up" | "down" | "flat" } {
  if (c.previous === null) return { text: "", tone: "flat" };
  if (c.previous === 0 && c.value === 0) return { text: `same as ${periodLabel}`, tone: "flat" };
  if (c.previous === 0) return { text: `up from 0 ${periodLabel}`, tone: "up" };
  const pct = ((c.value - c.previous) / c.previous) * 100;
  if (Math.abs(pct) < 0.5) return { text: `same as ${periodLabel}`, tone: "flat" };
  return { text: `${pct > 0 ? "+" : ""}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}% vs ${periodLabel}`, tone: pct > 0 ? "up" : "down" };
}

/**
 * A KPI card. `change` compares with the previous period of the same length;
 * `lowerIsBetter` flips the colors (e.g. crashes).
 */
export function Kpi({
  label,
  value,
  change,
  previousLabel = "previous period",
  lowerIsBetter = false,
  hint,
}: {
  label: string;
  value: string;
  change?: Change;
  previousLabel?: string;
  lowerIsBetter?: boolean;
  hint?: ReactNode;
}) {
  const c = change ? changeText(change, previousLabel) : null;
  const good = c && c.tone !== "flat" ? (c.tone === "up") !== lowerIsBetter : null;
  return (
    <div className="adm-kpi">
      <span className="adm-kpi-label">{label}</span>
      <span className="adm-kpi-value">{value}</span>
      {c && c.text && (
        <span className={`adm-kpi-change ${good === null ? "flat" : good ? "good" : "bad"}`}>
          {c.tone === "up" ? "▲ " : c.tone === "down" ? "▼ " : ""}
          {c.text}
          {change?.previous !== null && change?.previous !== undefined && (
            <span className="adm-kpi-prev"> (was {fmtInt(change.previous)})</span>
          )}
        </span>
      )}
      {hint && <span className="adm-kpi-hint">{hint}</span>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="adm-empty">{children}</p>;
}

export function Section({ title, sub, children, actions }: { title: string; sub?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card adm-card">
      <div className="adm-card-head">
        <div>
          <h2>{title}</h2>
          {sub && <p className="adm-sub">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
