"use client";

import { useState, useTransition } from "react";
import { setNewsEmails } from "./news-actions";

/** News by email (new experts, new features): on unless the person turned it off here or from an email. */
export function NewsCard({ on: initial }: { on: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <section className="card" aria-labelledby="news-title">
      <h2 id="news-title">News by email</h2>
      <label className="check" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => {
            const v = e.target.checked;
            setOn(v);
            start(async () => {
              const r = await setNewsEmails(v);
              if (!r.ok) setOn(!v);
            });
          }}
        />
        Send me oovi news: new experts and new features, a few times a month at most.
      </label>
      <p className="muted" style={{ marginTop: 8 }}>Emails about your account (sign-in, payments) always come.</p>
    </section>
  );
}
