"use client";

// A bot's questions (ask_user) as cards, one after another: tap an option, or write another answer.
// The last answer sends them all; "Back" changes an earlier one; "Skip" lets the bot decide.
// Writing in the message box instead also answers (the bot reads that message).
import { useEffect, useRef, useState } from "react";
import type { AskItem } from "@/lib/types";
import { useI18n } from "./I18n";
import Icon from "./Icon";

export default function QuestionCards({ intro, items, busy, onAnswer }: { intro?: string; items: AskItem[]; busy: boolean; onAnswer: (answers: string[] | null) => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => items.map(() => ""));
  const [writing, setWriting] = useState(false);
  const [other, setOther] = useState("");
  const first = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const q = items[step]!;
  const last = step === items.length - 1;

  // Each next card puts the keyboard on its first option (or on the text box when writing). Not when the
  // cards first appear: the user may be typing in the message box, and focus there must stay.
  const shown = useRef(false);
  useEffect(() => {
    if (!shown.current) {
      shown.current = true;
      return;
    }
    if (writing) box.current?.focus();
    else first.current?.focus({ preventScroll: true });
  }, [step, writing]);

  function pick(answer: string) {
    const a = answer.replace(/\s+/g, " ").trim().slice(0, 1000);
    if (!a || busy) return;
    const next = answers.map((x, i) => (i === step ? a : x));
    setAnswers(next);
    setWriting(false);
    setOther("");
    if (last) onAnswer(next);
    else setStep(step + 1);
  }

  const written = answers[step] && !q.options.includes(answers[step]!) ? answers[step]! : "";

  return (
    <section className="ask-card" aria-label={t("ask.label")}>
      <div className="ask-head">
        <span className="ask-count" aria-live="polite">
          {items.length > 1 ? t("ask.count", { n: step + 1, total: items.length }) : t("ask.one")}
        </span>
        {items.length > 1 && (
          <span className="ask-dots" aria-hidden>
            {items.map((_, i) => (
              <i key={i} className={i < step ? "done" : i === step ? "on" : ""} />
            ))}
          </span>
        )}
      </div>
      {intro && step === 0 && (
        <p className="ask-intro" dir="auto">
          {intro}
        </p>
      )}
      <p className="ask-q" dir="auto">
        {q.question}
      </p>
      {!writing ? (
        <div className="ask-options" role="group" aria-label={q.question}>
          {q.options.map((o, i) => (
            <button key={o} ref={i === 0 ? first : undefined} className={`ask-opt${answers[step] === o ? " picked" : ""}`} onClick={() => pick(o)} disabled={busy} dir="auto">
              <span className="ask-key" aria-hidden>
                {i + 1}
              </span>
              {o}
            </button>
          ))}
          <button
            className={`ask-opt other${written ? " picked" : ""}`}
            onClick={() => {
              setOther(written);
              setWriting(true);
            }}
            disabled={busy}
          >
            <Icon name="edit" size={14} /> {written ? written : t("ask.other")}
          </button>
        </div>
      ) : (
        <form
          className="ask-write"
          onSubmit={(ev) => {
            ev.preventDefault();
            pick(other);
          }}
        >
          <textarea
            ref={box}
            value={other}
            maxLength={1000}
            rows={2}
            dir="auto"
            placeholder={t("ask.placeholder")}
            aria-label={t("ask.placeholder")}
            onChange={(ev) => setOther(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && !ev.shiftKey) {
                ev.preventDefault();
                pick(other);
              } else if (ev.key === "Escape") setWriting(false);
            }}
          />
          <div className="ask-write-actions">
            <button type="button" className="btn sm" onClick={() => setWriting(false)}>
              {t("ask.options")}
            </button>
            <button type="submit" className="btn primary sm" disabled={busy || !other.trim()}>
              {last ? t("ask.send") : t("ask.next")}
            </button>
          </div>
        </form>
      )}
      <div className="ask-foot">
        {step > 0 ? (
          <button className="link-btn" onClick={() => (setWriting(false), setStep(step - 1))} disabled={busy}>
            {t("ask.back")}
          </button>
        ) : (
          <span />
        )}
        <button className="link-btn muted" onClick={() => onAnswer(null)} disabled={busy}>
          {t("ask.skip")}
        </button>
      </div>
    </section>
  );
}

/** After the user answered: the questions and answers, compact, in the bot's message. */
export function AnsweredQuestions({ items, answers, state }: { items: AskItem[]; answers?: string[]; state: "answered" | "skipped" | "replaced" }) {
  const { t } = useI18n();
  if (state !== "answered" || !answers) return <div className="note">{t(state === "skipped" ? "ask.skipped" : "ask.replied")}</div>;
  return (
    <dl className="ask-done" aria-label={t("ask.yours")}>
      {items.map((q, i) => (
        <div key={i}>
          <dt dir="auto">{q.question}</dt>
          <dd dir="auto">{answers[i]}</dd>
        </div>
      ))}
    </dl>
  );
}
