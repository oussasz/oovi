"use client";

import { SKILL_CATEGORIES, type CatalogKind } from "@/lib/catalog";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A copy of `root` with the value at `path` replaced (the original is never changed). */
function setIn(root: Obj, path: (string | number)[], value: unknown): Obj {
  const [head, ...rest] = path;
  const copy: Obj | unknown[] = Array.isArray(root) ? [...root] : { ...root };
  const key = head as string;
  (copy as Obj)[key] = rest.length ? setIn(((copy as Obj)[key] ?? {}) as Obj, rest, value) : value;
  return copy as Obj;
}
/** Same, but an empty value removes the field (so the saved JSON stays tidy). */
const setOrDrop = (root: Obj, path: (string | number)[], value: unknown) => {
  if (value === "" || value === undefined || value === false) {
    const parent = path.slice(0, -1).reduce<unknown>((o, k) => (isObj(o) || Array.isArray(o) ? (o as Obj)[k as string] : undefined), root);
    if (!isObj(parent)) return root;
    const { [path[path.length - 1] as string]: _gone, ...kept } = parent;
    void _gone;
    return path.length === 1 ? kept : setIn(root, path.slice(0, -1), kept);
  }
  return setIn(root, path, value);
};

function Text({ id, label, help, value, onChange, rows, mono }: { id: string; label: string; help?: string; value: string; onChange: (v: string) => void; rows?: number; mono?: boolean }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {rows ? (
        <textarea id={id} className="input" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} style={{ resize: "vertical", lineHeight: 1.5 }} />
      ) : (
        <input id={id} className={`input${mono ? " adm-mono" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {help && <span className="fine">{help}</span>}
    </div>
  );
}

/**
 * The content of an item as ordinary fields (name, description, each bot's instructions...), so nobody has to edit
 * JSON by hand. Every change rewrites the JSON below it, which stays the single source of what is saved.
 */
export function CatalogFields({ kind, data, onChange }: { kind: CatalogKind; data: Obj; onChange: (next: Obj) => void }) {
  const set = (path: (string | number)[], v: unknown) => onChange(setOrDrop(data, path, v));

  if (kind === "skill") {
    return (
      <div className="adm-friendly">
        <div className="adm-fields adm-fields-wide">
          <Text id="f-name" label="Name" value={str(data.name)} onChange={(v) => set(["name"], v)} />
          <div className="field">
            <label htmlFor="f-cat">Category</label>
            <select id="f-cat" className="input" value={str(data.category)} onChange={(e) => set(["category"], e.target.value)}>
              {SKILL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Text id="f-desc" label="Short description" value={str(data.description)} onChange={(v) => set(["description"], v)} rows={2} />
        <Text id="f-body" label="Steps the bot follows" help="Plain text. Numbered steps work well." value={str(data.body)} onChange={(v) => set(["body"], v)} rows={14} />
      </div>
    );
  }

  if (kind === "connector") {
    return (
      <div className="adm-friendly">
        <div className="adm-fields adm-fields-wide">
          <Text id="f-name" label="Name" value={str(data.name)} onChange={(v) => set(["name"], v)} />
          <Text id="f-by" label="By" help="The company behind it." value={str(data.by)} onChange={(v) => set(["by"], v)} />
        </div>
        <Text id="f-desc" label="Short description" value={str(data.description)} onChange={(v) => set(["description"], v)} rows={2} />
        <Text id="f-docs" label="Documentation link" help="An https:// page." value={str(data.docs)} onChange={(v) => set(["docs"], v)} mono />
        <p className="fine">How it connects (address, command, keys to fill in) is in the JSON below.</p>
      </div>
    );
  }

  const bots = Array.isArray(data.bots) ? (data.bots as unknown[]) : [];
  const links = Array.isArray(data.links) ? (data.links as unknown[]) : [];
  return (
    <div className="adm-friendly">
      <div className="adm-fields adm-fields-wide">
        <Text id="f-name" label="Name" value={str(data.name)} onChange={(v) => set(["name"], v)} />
        <Text id="f-group" label="Group name" help="What the team's group is called in the app." value={str(data.group)} onChange={(v) => set(["group"], v)} />
      </div>
      <Text id="f-desc" label="Short description" value={str(data.description)} onChange={(v) => set(["description"], v)} rows={2} />

      <fieldset className="adm-fieldset">
        <legend>Links shown on its card</legend>
        {links.map((l, i) => (
          <div key={i} className="adm-fields adm-fields-wide" style={{ alignItems: "end", marginBottom: 8 }}>
            <Text id={`f-ll-${i}`} label="Text" value={isObj(l) ? str(l.label) : ""} onChange={(v) => set(["links", i, "label"], v)} />
            <Text id={`f-lu-${i}`} label="Address (https://)" value={isObj(l) ? str(l.url) : ""} onChange={(v) => set(["links", i, "url"], v)} mono />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set(["links"], links.filter((_, j) => j !== i).length ? links.filter((_, j) => j !== i) : "")}>
              Remove
            </button>
          </div>
        ))}
        {links.length < 10 && (
          <button type="button" className="btn btn-light btn-sm" onClick={() => onChange(setIn(data, ["links"], [...links, { label: "", url: "https://" }]))}>
            Add a link
          </button>
        )}
      </fieldset>

      {bots.map((b, i) => {
        const bot = isObj(b) ? b : {};
        const tools = isObj(bot.tools) ? bot.tools : {};
        return (
          <fieldset key={i} className="adm-fieldset">
            <legend>
              Bot {i + 1}: {str(bot.name) || "unnamed"}
            </legend>
            <div className="adm-fields adm-fields-wide">
              <Text id={`f-bn-${i}`} label="Name (one word)" value={str(bot.name)} onChange={(v) => set(["bots", i, "name"], v)} />
              <Text id={`f-br-${i}`} label="Role" value={str(bot.role)} onChange={(v) => set(["bots", i, "role"], v)} />
            </div>
            <Text id={`f-ba-${i}`} label="One line in its own voice (optional)" help="Shown on its card, e.g. a motto." value={str(bot.about)} onChange={(v) => set(["bots", i, "about"], v)} />
            <Text id={`f-bi-${i}`} label="Instructions" help="Who it is and how it works. This is the bot's whole personality." value={str(bot.instructions)} onChange={(v) => set(["bots", i, "instructions"], v)} rows={16} />
            <div className="row-actions" style={{ flexWrap: "wrap", gap: 18 }}>
              <label className="check">
                <input type="checkbox" checked={tools.web === true} onChange={(e) => onChange(setIn(data, ["bots", i, "tools", "web"], e.target.checked))} /> Can search the web
              </label>
              <label className="check">
                <input type="checkbox" checked={tools.browser === true} onChange={(e) => onChange(setIn(data, ["bots", i, "tools", "browser"], e.target.checked))} /> Can use the browser
              </label>
              <label className="check">
                <input type="checkbox" checked={tools.accounts === true} onChange={(e) => set(["bots", i, "tools", "accounts"], e.target.checked)} /> Can use the person's accounts
              </label>
              {bots.length > 1 && (
                <label className="check">
                  <input type="checkbox" checked={bot.lead === true} onChange={(e) => set(["bots", i, "lead"], e.target.checked)} /> Team lead
                </label>
              )}
            </div>
          </fieldset>
        );
      })}
      <p className="fine">The face and the skills are in the JSON below.</p>
    </div>
  );
}
