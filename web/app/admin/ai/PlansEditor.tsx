"use client";

import { useState } from "react";
import type { Plan } from "@/lib/ai-config";
import { ActionForm, type ActionState } from "@/components/admin/ActionForm";

type Row = { key: number; id: string; name: string; price: string; monthlyCredits: string; dailyLimit: string; visible: boolean };

let nextKey = 1;
const toRow = (p: Plan): Row => ({
  key: nextKey++,
  id: p.id,
  name: p.name,
  price: p.price,
  monthlyCredits: String(p.monthlyCredits),
  dailyLimit: String(p.dailyLimit),
  visible: p.visible,
});

/** Table editor for the plans. Sent to the server as JSON and checked there. */
export function PlansEditor({ plans, action }: { plans: Plan[]; action: (fd: FormData) => Promise<ActionState> }) {
  const [rows, setRows] = useState<Row[]>(() => plans.map(toRow));
  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const payload = JSON.stringify(
    rows.map(({ id, name, price, monthlyCredits, dailyLimit, visible }) => ({ id, name, price, monthlyCredits, dailyLimit, visible })),
  );

  return (
    <ActionForm
      action={action}
      submitLabel="Save plans"
      extraButtons={
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={rows.length >= 20}
          onClick={() => setRows((rs) => [...rs, { key: nextKey++, id: "", name: "", price: "", monthlyCredits: "0", dailyLimit: "0", visible: false }])}
        >
          Add a plan
        </button>
      }
    >
      <input type="hidden" name="plans" value={payload} />
      <div className="adm-table-wrap">
        <table className="adm-table adm-plans">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Price label</th>
              <th className="num">Monthly credits</th>
              <th className="num">Daily limit</th>
              <th>On pricing page</th>
              <th>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isFree = r.id === "free" && plans.some((p) => p.id === "free");
              const label = r.name || r.id || `new plan ${i + 1}`;
              return (
                <tr key={r.key}>
                  <td>
                    <label className="sr-only" htmlFor={`plan-id-${r.key}`}>
                      ID for {label}
                    </label>
                    <input
                      id={`plan-id-${r.key}`}
                      className="input"
                      value={r.id}
                      maxLength={32}
                      readOnly={isFree}
                      placeholder="e.g. team"
                      pattern="[a-z][a-z0-9\-]{0,31}"
                      onChange={(e) => set(r.key, { id: e.target.value.toLowerCase() })}
                    />
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`plan-name-${r.key}`}>
                      Name for {label}
                    </label>
                    <input id={`plan-name-${r.key}`} className="input" value={r.name} maxLength={40} onChange={(e) => set(r.key, { name: e.target.value })} />
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`plan-price-${r.key}`}>
                      Price label for {label}
                    </label>
                    <input
                      id={`plan-price-${r.key}`}
                      className="input"
                      value={r.price}
                      maxLength={40}
                      placeholder="e.g. $9.99 / month"
                      onChange={(e) => set(r.key, { price: e.target.value })}
                    />
                  </td>
                  <td className="num">
                    <label className="sr-only" htmlFor={`plan-monthly-${r.key}`}>
                      Monthly credits for {label}
                    </label>
                    <input
                      id={`plan-monthly-${r.key}`}
                      className="input"
                      type="number"
                      min={0}
                      max={100000000}
                      step={1}
                      value={r.monthlyCredits}
                      onChange={(e) => set(r.key, { monthlyCredits: e.target.value })}
                    />
                  </td>
                  <td className="num">
                    <label className="sr-only" htmlFor={`plan-daily-${r.key}`}>
                      Daily limit for {label}
                    </label>
                    <input
                      id={`plan-daily-${r.key}`}
                      className="input"
                      type="number"
                      min={0}
                      max={100000000}
                      step={1}
                      value={r.dailyLimit}
                      onChange={(e) => set(r.key, { dailyLimit: e.target.value })}
                    />
                  </td>
                  <td>
                    <label className="check">
                      <input type="checkbox" checked={r.visible} onChange={(e) => set(r.key, { visible: e.target.checked })} />
                      <span>
                        Visible<span className="sr-only"> on the pricing page: {label}</span>
                      </span>
                    </label>
                  </td>
                  <td>
                    {isFree ? (
                      <span className="fine">Always kept</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        aria-label={`Remove ${label}`}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ActionForm>
  );
}
