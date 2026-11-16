"use client";

import { useState, useTransition } from "react";
import { applyAsExpert, type ExpertFormState } from "./actions";
import { SignaturePad } from "./SignaturePad";

/** Controlled on purpose, and sent without React's form reset: a refused request must not lose anything that was typed, ticked or drawn. */
/** `config` comes from the server page (lib/expert-form.ts), so the browser never imports the server-only checks. */
export type ExpertFormConfig = {
  version: string;
  text: readonly string[];
  limits: { name: number; email: number; url: number; field: number; bio: number; knownAs: number };
};

export function ExpertForm({ config }: { config: ExpertFormConfig }) {
  const { version: CONSENT_VERSION, text: CONSENT_TEXT, limits: LIMITS } = config;
  const [state, setState] = useState<ExpertFormState>(null);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [field, setField] = useState("");
  const [bio, setBio] = useState("");
  const [knownAs, setKnownAs] = useState("");
  const [signedName, setSignedName] = useState("");
  const [signature, setSignature] = useState("");
  const [typedOnly, setTypedOnly] = useState(false);
  const [consent, setConsent] = useState(false);

  if (state?.ok) {
    return (
      <div className="form" role="status">
        <p className="alert alert-ok">Thank you. Your request was sent. We’ll read it and write to the email address you gave us.</p>
        <p className="muted">Nothing is published with your name until we have agreed the details with you in writing.</p>
      </div>
    );
  }


  return (
    <form
      className="form ex-form"
      noValidate
      onSubmit={(e) => {
        // Sent by hand (not as a form action): React empties a form after an action, which would untick boxes the person ticked.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          try {
            setState(await applyAsExpert(null, fd));
          } catch {
            setState({ errors: ["Something went wrong. Please try again."] });
          }
        });
      }}
    >
      {state?.errors && state.errors.length > 0 && (
        <ul className="alert alert-error form-errors" role="alert">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="field">
        <label htmlFor="ex-name">Your full name</label>
        <input id="ex-name" name="name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.name} autoComplete="name" required />
      </div>
      <div className="field">
        <label htmlFor="ex-email">Your email</label>
        <input id="ex-email" name="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={LIMITS.email} autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="ex-url">A link to your public profile</label>
        <input id="ex-url" name="profileUrl" type="url" inputMode="url" className="input" value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} maxLength={LIMITS.url} placeholder="https://www.linkedin.com/in/…" required />
        <span className="ex-hint">LinkedIn, your website, anything public that shows who you are.</span>
      </div>
      <div className="field">
        <label htmlFor="ex-field">What are you an expert in?</label>
        <input id="ex-field" name="field" className="input" value={field} onChange={(e) => setField(e.target.value)} maxLength={LIMITS.field} placeholder="For example: startups, tax law, nutrition" required />
      </div>
      <div className="field">
        <label htmlFor="ex-bio">A short bio</label>
        <textarea id="ex-bio" name="bio" className="input" rows={5} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={LIMITS.bio} required />
        <span className="ex-hint">{bio.trim().length}/{LIMITS.bio}. Who you help, and how.</span>
      </div>

      <div className="field">
        <label htmlFor="ex-known">
          How should your assistant be known? <span className="pf-opt">(optional)</span>
        </label>
        <input id="ex-known" name="knownAs" className="input" value={knownAs} onChange={(e) => setKnownAs(e.target.value)} maxLength={LIMITS.knownAs} placeholder="For example: your name, or a nickname" />
      </div>

      <section className="ex-consent" aria-labelledby="ex-consent-h">
        <h2 id="ex-consent-h">Before you sign</h2>
        <ul>
          {CONSENT_TEXT.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="ex-hint">Version {CONSENT_VERSION}. See also our <a href="/privacy">Privacy Policy</a>.</p>
        <label className="check">
          <input type="checkbox" name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I have read this and I agree.</span>
        </label>
      </section>

      <div className="field">
        <label htmlFor="ex-signed">Type your full name to sign</label>
        <input id="ex-signed" name="signedName" className="input" value={signedName} onChange={(e) => setSignedName(e.target.value)} maxLength={LIMITS.name} autoComplete="off" required />
      </div>

      <div className="field">
        <span className="label" id="ex-sign-l">
          Draw your signature
        </span>
        <SignaturePad onChange={setSignature} disabled={typedOnly} />
        <label className="check">
          <input type="checkbox" name="typedOnly" checked={typedOnly} onChange={(e) => setTypedOnly(e.target.checked)} />
          <span>I can’t draw a signature here. My typed name is my signature.</span>
        </label>
      </div>

      <input type="hidden" name="signature" value={typedOnly ? "" : signature} />
      <input type="hidden" name="consentVersion" value={CONSENT_VERSION} />
      {/* A trap for scripts: people never see or reach this field. */}
      <div className="ex-trap" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <button type="submit" className="btn btn-dark btn-md" disabled={pending}>
        {pending ? "Sending…" : "Send my request"}
      </button>
    </form>
  );
}
