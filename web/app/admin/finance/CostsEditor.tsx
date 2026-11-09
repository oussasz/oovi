"use client";

import { useState } from "react";

type Row = { key: number; name: string; usd: string };
let nextKey = 1;

/** Fixed monthly costs (name + USD per month), sent to the server action as JSON in "costs". */
export function CostsEditor({ initial }: { initial: { name: string; usd: number }[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    (initial.length ? initial : [{ name: "", usd: 0 }]).map((c) => ({ key: nextKey++, name: c.name, usd: c.name ? String(c.usd) : "" })),
  );
  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = rows.reduce((t, r) => t + (Number(r.usd.replace(/,/g, "")) || 0), 0);

  return (
    <div className="fin-costs">
      <input type="hidden" name="costs" value={JSON.stringify(rows.map(({ name, usd }) => ({ name, usd })))} />
      {rows.map((r, i) => (
        <div className="fin-cost-row" key={r.key}>
          <input
            className="input"
            aria-label={`Cost ${i + 1} name`}
            placeholder="e.g. Vercel, Neon, domain, email"
            maxLength={60}
            value={r.name}
            onChange={(e) => set(r.key, { name: e.target.value })}
          />
          <input
            className="input"
            aria-label={`Cost ${i + 1} USD per month`}
            placeholder="USD / month"
            inputMode="decimal"
            value={r.usd}
            onChange={(e) => set(r.key, { usd: e.target.value })}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove cost ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <div className="fin-cost-foot">
        <button type="button" className="btn btn-light btn-sm" disabled={rows.length >= 30} onClick={() => setRows((rs) => [...rs, { key: nextKey++, name: "", usd: "" }])}>
          Add a cost
        </button>
        <span className="adm-sub">
          Total: <b>${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}</b> per month
        </span>
      </div>
    </div>
  );
}
