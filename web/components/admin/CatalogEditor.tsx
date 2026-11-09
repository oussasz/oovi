"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  CATALOG_KINDS,
  CATALOG_TEMPLATES,
  parseJsonText,
  validateCatalogData,
  validateCatalogId,
  type CatalogKind,
} from "@/lib/catalog";
import { saveCatalogItem, type SaveState } from "@/app/admin/marketplace/actions";
import { CatalogPreview } from "./CatalogPreview";

type Initial = { id: string; kind: CatalogKind; published: boolean; sort: number; dataText: string };

function SaveButton({ disabled, mode }: { disabled: boolean; mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-dark btn-md" disabled={disabled || pending}>
      {pending ? "Saving…" : mode === "create" ? "Create item" : "Save changes"}
    </button>
  );
}

export function CatalogEditor({ mode, initial }: { mode: "create" | "edit"; initial: Initial }) {
  const [state, action] = useActionState<SaveState, FormData>(saveCatalogItem, null);
  const [id, setId] = useState(initial.id);
  const [kind, setKind] = useState<CatalogKind>(initial.kind);
  const [text, setText] = useState(initial.dataText);
  const [touched, setTouched] = useState(false);
  // Controlled so a failed save (React resets forms after an action) keeps every value.
  const [sort, setSort] = useState(String(initial.sort));
  const [published, setPublished] = useState(initial.published);

  const check = useMemo(() => {
    const parsed = parseJsonText(text);
    if (!parsed.ok) return { value: null as unknown, errors: [parsed.error] };
    return { value: parsed.value, errors: validateCatalogData(kind, parsed.value) };
  }, [text, kind]);
  const idError = id ? validateCatalogId(id) : "Give the item an ID.";

  function changeKind(next: CatalogKind) {
    setKind(next);
    // Swap in the starter JSON if the admin hasn't typed anything of their own yet.
    if (mode === "create" && !touched) setText(JSON.stringify(CATALOG_TEMPLATES[next], null, 2));
  }

  function format() {
    const parsed = parseJsonText(text);
    if (parsed.ok) setText(JSON.stringify(parsed.value, null, 2));
  }

  const serverErrors = state?.errors ?? [];

  return (
    <form action={action} className="adm-editor">
      <input type="hidden" name="mode" value={mode} />
      <div className="card adm-card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="adm-fields">
          <div className="field">
            <label htmlFor="cat-id">ID</label>
            <input
              id="cat-id"
              name="id"
              className="input adm-mono"
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase())}
              readOnly={mode === "edit"}
              required
              maxLength={64}
              placeholder="e.g. notion"
              aria-describedby="cat-id-help"
            />
          </div>
          <div className="field">
            <label htmlFor="cat-kind">Kind</label>
            <select id="cat-kind" name="kind" className="input" value={kind} onChange={(e) => changeKind(e.target.value as CatalogKind)}>
              {CATALOG_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cat-sort">Order</label>
            <input id="cat-sort" name="sort" className="input" type="number" step={1} min={-100000} max={100000} value={sort} onChange={(e) => setSort(e.target.value)} />
          </div>
          <div className="field">
            <span className="label">Status</span>
            <label className="check" style={{ marginTop: 10 }}>
              <input type="checkbox" name="published" checked={published} onChange={(e) => setPublished(e.target.checked)} />
              Published
            </label>
          </div>
        </div>
        <p id="cat-id-help" className="fine">
          {mode === "edit"
            ? "The ID can't be changed. To rename, create a new item and delete this one."
            : "Lowercase letters, numbers, dots, dashes and underscores. The app uses it to recognise the item, so don't reuse old IDs."}{" "}
          Lower order numbers are shown first.
        </p>

        <div className="field">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <label htmlFor="cat-data">Data (JSON)</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={format}>
              Tidy JSON
            </button>
          </div>
          <textarea
            id="cat-data"
            name="data"
            className="input"
            spellCheck={false}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setTouched(true);
            }}
            aria-invalid={check.errors.length > 0}
            aria-describedby="cat-data-errors"
          />
        </div>

        <div id="cat-data-errors" aria-live="polite">
          {idError && id && <p className="alert alert-error">{idError}</p>}
          {check.errors.length > 0 ? (
            <div className="alert alert-error">
              <p style={{ marginBottom: 6 }}>Fix these before saving:</p>
              <ul className="adm-errors">
                {check.errors.slice(0, 30).map((e) => (
                  <li key={e}>{e}</li>
                ))}
                {check.errors.length > 30 && <li>…and {check.errors.length - 30} more</li>}
              </ul>
            </div>
          ) : (
            <p className="alert alert-ok">Looks good.</p>
          )}
          {serverErrors.length > 0 && (
            <div className="alert alert-error" role="alert" style={{ marginTop: 10 }}>
              <ul className="adm-errors">
                {serverErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="row-actions">
          <SaveButton mode={mode} disabled={check.errors.length > 0 || !!idError} />
        </div>
      </div>

      <aside className="adm-preview card adm-card" aria-label="Preview">
        <h2 style={{ marginBottom: 12 }}>Preview</h2>
        {check.value && typeof check.value === "object" && !Array.isArray(check.value) ? (
          <CatalogPreview kind={kind} data={check.value as Record<string, unknown>} />
        ) : (
          <p className="adm-empty">The preview appears when the JSON is valid.</p>
        )}
      </aside>
    </form>
  );
}
