"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { TEAM_SIZES } from "@/lib/team-sizes";
import { CALL, FACES, HEARD, IMPROVE, LANGUAGES, MOBILE, PAY, PAY_METHODS, ROLES, SYSTEMS, TOOLS, USES, type Opt } from "@/lib/pilot-form";
import { requestPilot, type PilotFormState } from "./actions";

const STEPS = ["About you", "What you’ll do", "Your first try", "Almost done"];

/** A row of tap-to-choose buttons: pick one, or several (up to `max`). */
function Choices({
  name,
  legend,
  hint,
  options,
  multi = false,
  max = 99,
  required = false,
  onChange,
}: {
  name: string;
  legend: string;
  hint?: string;
  options: Opt[];
  multi?: boolean;
  max?: number;
  required?: boolean;
  onChange?: (picked: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (v: string) => {
    const next = multi ? (picked.includes(v) ? picked.filter((x) => x !== v) : picked.length < max ? [...picked, v] : picked) : [v];
    setPicked(next);
    onChange?.(next);
  };
  return (
    <fieldset className="pf-group">
      <legend>
        {legend}
        {required ? <span className="pf-req"> *</span> : <span className="pf-opt"> (optional)</span>}
      </legend>
      {(hint || multi) && <span className="pf-hint">{hint ?? (max < 99 ? `Pick up to ${max}.` : "Pick all that fit.")}</span>}
      <div className="pf-chips">
        {options.map((o) => {
          const on = picked.includes(o.value);
          return (
            <label key={o.value} className="pf-chip">
              <input
                type={multi ? "checkbox" : "radio"}
                name={name}
                value={o.value}
                checked={on}
                disabled={multi && !on && picked.length >= max}
                onChange={() => toggle(o.value)}
              />
              <span>
                {o.icon && (
                  <span className="pf-ico" aria-hidden="true">
                    {o.icon}
                  </span>
                )}
                {o.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PilotForm() {
  const [state, dispatch, pending] = useActionState<PilotFormState, FormData>(requestPilot, null);
  const [step, setStep] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const [heard, setHeard] = useState<string[]>([]);
  const [face, setFace] = useState(0);
  const [stars, setStars] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  if (state?.ok) {
    return (
      <div className="pf-done" role="status">
        <p className="pf-done-icon" aria-hidden="true">
          🎉
        </p>
        <h3>Thank you! Your request is in.</h3>
        <p className="muted">
          We read every request by hand. You’ll see the result on this page and in your account, and an email tells you when it’s approved.
        </p>
      </div>
    );
  }

  /** What is still missing on a step (the server checks everything again). */
  const missing = (s: number): string[] => {
    const f = formRef.current;
    if (!f) return [];
    const fd = new FormData(f);
    const out: string[] = [];
    if (s === 0) {
      if (!fd.get("role")) out.push("Pick what describes you best.");
      if (!fd.get("system")) out.push("Pick the computer you use.");
    }
    if (s === 1 && !fd.getAll("uses").length) out.push("Pick at least one thing you’ll use oovi for.");
    if (s === 2) {
      if (!fd.get("heard")) out.push("Tell us where you heard about oovi.");
      if (!fd.get("experience")) out.push("Choose a face for your first try with oovi.");
    }
    if (s === 3) {
      if (!fd.getAll("payMethods").length) out.push("Tell us how you can pay online (or that you can’t yet).");
      if (fd.get("feedback") !== "on") out.push("Please confirm that you’ll send us feedback. It’s what the pilot is for.");
    }
    return out;
  };

  const go = (to: number) => {
    setStep(to);
    setProblems([]);
    requestAnimationFrame(() => {
      titleRef.current?.focus();
      titleRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };
  const next = () => {
    const m = missing(step);
    if (m.length) return setProblems(m);
    go(step + 1);
  };

  return (
    <form
      ref={formRef}
      className="form pf"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        for (let s = 0; s < STEPS.length; s++) {
          const m = missing(s);
          if (m.length) {
            setStep(s);
            return setProblems(m);
          }
        }
        setProblems([]);
        // Sent by hand (not as the form's action) so nothing the person ticked is cleared if the server has a complaint.
        const fd = new FormData(e.currentTarget);
        startTransition(() => dispatch(fd));
      }}
    >
      <div className="pf-steps" aria-hidden="true">
        {STEPS.map((s, i) => (
          <span key={s} className={`pf-dot${i <= step ? " on" : ""}`} />
        ))}
      </div>
      <p className="pf-count" aria-live="polite">
        Step {step + 1} of {STEPS.length}
      </p>
      <h3 className="pf-title" ref={titleRef} tabIndex={-1}>
        {STEPS[step]}
      </h3>

      {(problems.length > 0 || (state?.errors && state.errors.length > 0)) && (
        <ul className="alert alert-error form-errors" role="alert">
          {(problems.length ? problems : (state?.errors ?? [])).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div hidden={step !== 0} className="pf-step">
        <Choices name="role" legend="What describes you best?" options={ROLES} required />
        <Choices name="system" legend="Which computer will you use oovi on?" hint="We build for Windows first. This tells us what to build next." options={SYSTEMS} required />
        <Choices name="teamSize" legend="How big is your team?" options={TEAM_SIZES.map((t) => ({ value: t.value, label: t.label }))} />
        <div className="field">
          <label htmlFor="organization">
            Your company or project <span className="pf-opt">(optional)</span>
          </label>
          <input id="organization" name="organization" className="input" maxLength={120} autoComplete="organization" />
        </div>
      </div>

      <div hidden={step !== 1} className="pf-step">
        <Choices name="uses" legend="What will you use oovi for?" options={USES} multi max={6} required />
        <Choices name="languages" legend="Which languages will you talk to oovi in?" options={LANGUAGES} multi />
        <Choices name="tools" legend="Which AI tools do you use today?" options={TOOLS} multi />
      </div>

      <div hidden={step !== 2} className="pf-step">
        <Choices name="heard" legend="Where did you hear about oovi?" options={HEARD} required onChange={setHeard} />
        {heard[0] === "other" && (
          <div className="field">
            <label htmlFor="heardOther">Where? (a few words)</label>
            <input id="heardOther" name="heardOther" className="input" maxLength={80} />
          </div>
        )}
        <fieldset className="pf-group">
          <legend>
            How was your first try with oovi?<span className="pf-req"> *</span>
          </legend>
          <div className="pf-faces">
            {FACES.map((f) => (
              <label key={f.value} className="pf-face">
                <input type="radio" name="experience" value={f.value} checked={face === f.value} onChange={() => setFace(f.value)} />
                <span>
                  <span className="pf-em" aria-hidden="true">
                    {f.icon}
                  </span>
                  {f.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="pf-group">
          <legend>
            How useful could oovi be for your work?<span className="pf-opt"> (optional)</span>
          </legend>
          <div className="pf-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className={`pf-star${n <= stars ? " on" : ""}`} title={`${n} of 5`}>
                <input type="radio" name="usefulness" value={n} checked={stars === n} onChange={() => setStars(n)} aria-label={`${n} of 5 stars`} />
                <span aria-hidden="true">★</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Choices name="improve" legend="What should we improve first?" options={IMPROVE} multi max={3} />
      </div>

      <div hidden={step !== 3} className="pf-step">
        <Choices name="payMethods" legend="How can you pay online?" hint="So we know which payment methods to support." options={PAY_METHODS} multi required />
        <Choices name="pay" legend="If oovi saves you time, what would you pay per month?" options={PAY} />
        <Choices name="mobile" legend="Would you use oovi on your phone?" options={MOBILE} />
        <Choices name="call" legend="Can we talk for 15 minutes about your experience?" options={CALL} />
        <div className="field">
          <label htmlFor="contact">
            WhatsApp or Telegram <span className="pf-opt">(optional, only if you said yes)</span>
          </label>
          <input id="contact" name="contact" className="input" maxLength={80} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="extra">
            Anything else you’d like us to know? <span className="pf-opt">(optional)</span>
          </label>
          <textarea id="extra" name="extra" className="input" rows={3} maxLength={1000} />
        </div>
        <label className="check">
          <input type="checkbox" name="quote" />
          <span>You may quote my feedback, without my name.</span>
        </label>
        <label className="check">
          <input type="checkbox" name="feedback" />
          <span>
            I’ll send feedback about problems and improvements.<span className="pf-req"> *</span>
          </span>
        </label>
      </div>

      <div className="pf-nav">
        {step > 0 ? (
          <button type="button" className="btn btn-light btn-md" onClick={() => go(step - 1)}>
            Back
          </button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn btn-dark btn-md" onClick={next}>
            Next
          </button>
        ) : (
          <button type="submit" className="btn btn-dark btn-lg" disabled={pending}>
            {pending ? "Sending…" : "Send my request"}
          </button>
        )}
      </div>
    </form>
  );
}
