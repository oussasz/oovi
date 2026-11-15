"use client";

import { useActionState, useState } from "react";
import { saveReleaseNotes, type NotesState } from "@/app/admin/releases/actions";
import { MAX_HEADLINE, SECTION_FIELD, SECTION_TITLES, type SectionTitle } from "@/lib/release-notes";

const HELP: Record<SectionTitle, string> = {
  New: "Things a person can do now that they couldn’t before.",
  Improved: "Things that were already there and are now better.",
  Fixed: "What was wrong, in the user’s words (“a click was refused after you approved it”).",
  "Good to know": "Limits, privacy, anything that avoids a surprise. Leave empty if there is nothing.",
};

export type EditorInitial = { headline: string; texts: Record<SectionTitle, string>; hidden: boolean };

/** Controlled, because React empties a form after an action: a refused save must not lose what was typed. */
export function ReleaseNotesEditor({ version, initial }: { version: string; initial: EditorInitial }) {
  const [state, action, pending] = useActionState<NotesState, FormData>(saveReleaseNotes, null);
  const [headline, setHeadline] = useState(initial.headline);
  const [texts, setTexts] = useState(initial.texts);
  const [hidden, setHidden] = useState(initial.hidden);

  return (
    <form action={action} className="adm-form adm-friendly">
      <input type="hidden" name="version" value={version} />
      <div className="field">
        <label htmlFor="rn-headline">Headline (optional)</label>
        <input id="rn-headline" className="input" name="headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={MAX_HEADLINE} placeholder="Bots finish what you ask" />
        <p className="adm-sub">One short line under the version number. What is the one thing this version is about?</p>
      </div>
      {SECTION_TITLES.map((t) => (
        <div className="field" key={t}>
          <label htmlFor={`rn-${SECTION_FIELD[t]}`}>{t}</label>
          <textarea
            id={`rn-${SECTION_FIELD[t]}`}
            className="input"
            name={SECTION_FIELD[t]}
            rows={t === "Good to know" ? 3 : 6}
            value={texts[t]}
            onChange={(e) => setTexts({ ...texts, [t]: e.target.value })}
          />
          <p className="adm-sub">{HELP[t]} One point per line. Start with a short title in **bold**, then one sentence.</p>
        </div>
      ))}
      <div className="field">
        <label className="adm-check">
          <input type="checkbox" name="hidden" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hide this version on the website
        </label>
        <p className="adm-sub">For a version with nothing a person would notice, or one that only repeats the next one.</p>
      </div>
      <div className="adm-form-foot">
        <button type="submit" className="btn btn-dark btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {state?.errors && state.errors.length > 0 && (
        <ul className="adm-errors" role="alert">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
