"use client";

import { useActionState, useState } from "react";
import { TEAM_SIZES } from "@/lib/team-sizes";
import { requestPilot, type PilotFormState } from "./actions";

export function PilotForm() {
  const [state, action, pending] = useActionState<PilotFormState, FormData>(requestPilot, null);
  const [useCase, setUseCase] = useState("");
  const n = useCase.trim().length;

  if (state?.ok) {
    return (
      <p className="alert alert-ok" role="status">
        Thanks! Your request was sent. We review every request by hand and you’ll see the result on this page and in your account.
      </p>
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
      <div className="field">
        <label htmlFor="useCase">What will you use oovi for?</label>
        <textarea
          id="useCase"
          name="useCase"
          className="input"
          rows={5}
          minLength={30}
          maxLength={2000}
          required
          value={useCase}
          onChange={(e) => setUseCase(e.target.value)}
          aria-describedby="useCase-help"
        />
        <span id="useCase-help" className="fine">
          A few sentences about your work and the tasks you’d like oovi to help with. {n < 30 ? `At least 30 characters (${n} so far).` : `${n} / 2,000`}
        </span>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="organization">Organization (optional)</label>
          <input id="organization" name="organization" className="input" maxLength={120} autoComplete="organization" />
        </div>
        <div className="field">
          <label htmlFor="role">Your role (optional)</label>
          <input id="role" name="role" className="input" maxLength={120} autoComplete="organization-title" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="teamSize">Team size</label>
        <select id="teamSize" name="teamSize" className="input" defaultValue="">
          <option value="">Prefer not to say</option>
          {TEAM_SIZES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <label className="check">
        <input type="checkbox" name="feedback" required />
        <span>I’ll send feedback about problems and improvements.</span>
      </label>
      <button type="submit" className="btn btn-dark btn-lg" disabled={pending || n < 30}>
        {pending ? "Sending…" : "Send my request"}
      </button>
    </form>
  );
}
