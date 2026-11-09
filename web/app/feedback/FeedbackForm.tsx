"use client";

import { useActionState, useState } from "react";
import { sendFeedback, type FeedbackFormState } from "./actions";

const KINDS = [
  { value: "problem", label: "Something isn’t working" },
  { value: "improvement", label: "An idea or improvement" },
  { value: "other", label: "Something else" },
] as const;

/** Each "Send more feedback" starts a fresh form. */
export function FeedbackForm() {
  const [round, setRound] = useState(0);
  return <Inner key={round} onAgain={() => setRound((r) => r + 1)} />;
}

function Inner({ onAgain }: { onAgain: () => void }) {
  const [state, action, pending] = useActionState<FeedbackFormState, FormData>(sendFeedback, null);
  const [message, setMessage] = useState("");
  const n = message.trim().length;

  if (state?.ok) {
    return (
      <div className="form">
        <p className="alert alert-ok" role="status">
          Thank you! Your feedback was sent. We read every message.
        </p>
        <button type="button" className="btn btn-light btn-md" onClick={onAgain}>
          Send more feedback
        </button>
      </div>
    );
  }

  return (
    <form className="form" action={action}>
      {state?.errors && state.errors.length > 0 && (
        <ul className="alert alert-error form-errors" role="alert">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <fieldset className="radio-group">
        <legend className="label">What is it about?</legend>
        {KINDS.map((k, i) => (
          <label key={k.value} className="check">
            <input type="radio" name="kind" value={k.value} defaultChecked={i === 0} required />
            <span>{k.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor="message">Your message</label>
        <textarea
          id="message"
          name="message"
          className="input"
          rows={7}
          minLength={5}
          maxLength={5000}
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-describedby="message-help"
        />
        <span id="message-help" className="fine">
          What happened, what you expected, or what you’d like to see. Please don’t include passwords or API keys. {n} / 5,000
        </span>
      </div>
      <button type="submit" className="btn btn-dark btn-lg" disabled={pending || n < 5}>
        {pending ? "Sending…" : "Send feedback"}
      </button>
    </form>
  );
}
