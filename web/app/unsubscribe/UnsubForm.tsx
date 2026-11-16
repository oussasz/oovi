"use client";

import { useActionState } from "react";
import { changeNews, type UnsubState } from "./actions";

export function UnsubForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<UnsubState, FormData>(changeNews, null);
  if (state?.done === "out")
    return (
      <form action={action}>
        <p className="sub">Done. You won’t get oovi news by email anymore. Emails about your account (sign-in, payments) still come.</p>
        <input type="hidden" name="t" value={token} />
        <input type="hidden" name="action" value="in" />
        <button className="btn btn-ghost btn-lg btn-block" disabled={pending}>
          I changed my mind: keep sending news
        </button>
      </form>
    );
  if (state?.done === "in") return <p className="sub">Good: you’ll keep getting oovi news.</p>;
  return (
    <form action={action}>
      <p className="sub">Stop getting oovi news (new experts, new features) by email? Emails about your account still come.</p>
      {state?.error && (
        <p className="fine" role="alert" style={{ color: "var(--coral-ink, #b42318)" }}>
          {state.error}
        </p>
      )}
      <input type="hidden" name="t" value={token} />
      <button className="btn btn-dark btn-lg btn-block" disabled={pending}>
        {pending ? "One moment…" : "Unsubscribe"}
      </button>
    </form>
  );
}
