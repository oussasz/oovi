"use client";

// Plan mode: the plan a bot proposed, editable before anything runs. Steps can be edited,
// added, removed and moved with buttons (works with the keyboard, not drag-only).
// "Run this plan" sends the edited steps; writing in the message box instead asks for changes.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "./I18n";
import Icon from "./Icon";

const MAX_STEPS = 20;
const MAX_LEN = 200;
type Row = { key: number; text: string };
let nextKey = 1;

export default function PlanReview({ steps, busy, onDecide }: { steps: string[]; busy: boolean; onDecide: (approve: boolean, items: string[]) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>(() => steps.map((text) => ({ key: nextKey++, text })));
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const refs = useRef(new Map<number, HTMLTextAreaElement>());

  useEffect(() => {
    if (focusKey === null) return;
    refs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey, rows]);

  const clean = rows.map((r) => r.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const set = (key: number, text: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, text } : r)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const out = [...rs];
      [out[i], out[j]] = [out[j]!, out[i]!];
      setFocusKey(out[j]!.key);
      return out;
    });
  const remove = (i: number) =>
    setRows((rs) => {
      const out = rs.filter((_, k) => k !== i);
      const near = out[Math.min(i, out.length - 1)];
      if (near) setFocusKey(near.key);
      return out;
    });
  const addAfter = (i: number) =>
    setRows((rs) => {
      if (rs.length >= MAX_STEPS) return rs;
      const row = { key: nextKey++, text: "" };
      setFocusKey(row.key);
      return [...rs.slice(0, i + 1), row, ...rs.slice(i + 1)];
    });

  return (
    <section className="plan-review" aria-label={t("plan.title")}>
      <p className="plan-review-title">
        <Icon name="check" size={15} /> {t("plan.title")}
      </p>
      <ol className="plan-edit">
        {rows.map((r, i) => (
          <li key={r.key}>
            <span className="plan-num" aria-hidden>
              {i + 1}
            </span>
            <textarea
              ref={(el) => {
                if (el) refs.current.set(r.key, el);
                else refs.current.delete(r.key);
              }}
              rows={1}
              value={r.text}
              maxLength={MAX_LEN}
              aria-label={t("plan.step", { n: String(i + 1) })}
              disabled={busy}
              onChange={(e) => set(r.key, e.target.value.replace(/\n/g, " "))}
              onKeyDown={(e) => {
                // Enter adds the next step (a step is one line).
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addAfter(i);
                }
              }}
            />
            <span className="plan-row-actions">
              <button type="button" className="icon-btn sm" aria-label={t("plan.moveUp", { n: String(i + 1) })} title={t("plan.moveUp", { n: String(i + 1) })} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                <span aria-hidden>↑</span>
              </button>
              <button type="button" className="icon-btn sm" aria-label={t("plan.moveDown", { n: String(i + 1) })} title={t("plan.moveDown", { n: String(i + 1) })} disabled={busy || i === rows.length - 1} onClick={() => move(i, 1)}>
                <span aria-hidden>↓</span>
              </button>
              <button type="button" className="icon-btn sm" aria-label={t("plan.remove", { n: String(i + 1) })} title={t("plan.remove", { n: String(i + 1) })} disabled={busy} onClick={() => remove(i)}>
                <Icon name="close" size={13} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <button type="button" className="link-btn plan-add" disabled={busy || rows.length >= MAX_STEPS} onClick={() => addAfter(rows.length - 1)}>
        <Icon name="plus" size={13} /> {t("plan.addStep")}
      </button>
      <p className="muted plan-hint">{t("plan.reviseHint")}</p>
      {!clean.length && (
        <p className="msg-err" role="alert">
          {t("plan.empty")}
        </p>
      )}
      <div className="plan-actions">
        <button type="button" className="btn primary" disabled={busy || !clean.length} onClick={() => onDecide(true, clean)}>
          {t("plan.run")} <Icon name="arrow" size={15} />
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => onDecide(false, clean)}>
          {t("plan.cancel")}
        </button>
      </div>
    </section>
  );
}
