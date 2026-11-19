// Tool inputs a model sent in the wrong shape are repaired before the call runs, the way the tool's schema
// says they should be: a list sent as JSON text, a number sent as text, "true" for a yes/no, one value where
// a list is expected. Models (smaller and cheaper ones especially) do this often; the call then fails and
// costs a step. Pure: tests/unit/arg-repair.test.mts.

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; items?: Schema };

const typeOf = (s: Schema | undefined): string | undefined => (Array.isArray(s?.type) ? s?.type.find((t) => t !== "null") : s?.type);

function fix(v: unknown, s: Schema | undefined): unknown {
  const t = typeOf(s);
  if (!t) return v;
  if (typeof v === "string") {
    const raw = v.trim();
    if ((t === "array" && raw.startsWith("[")) || (t === "object" && raw.startsWith("{"))) {
      try {
        const j: unknown = JSON.parse(raw);
        if (t === "array" ? Array.isArray(j) : j && typeof j === "object" && !Array.isArray(j)) return fix(j, s);
      } catch {
        /* not JSON: left as it was, the tool says what's wrong */
      }
    }
    if ((t === "number" || t === "integer") && /^-?\d+(\.\d+)?$/.test(raw)) return t === "integer" ? Math.trunc(Number(raw)) : Number(raw);
    if (t === "boolean" && /^(true|false)$/i.test(raw)) return raw.toLowerCase() === "true";
    if (t === "array" && raw && typeOf(s?.items) === "string") return [v];
    return v;
  }
  if (t === "array" && v !== null && v !== undefined && !Array.isArray(v) && typeof v !== "object") return [fix(v, s?.items)];
  if (t === "array" && Array.isArray(v) && s?.items) {
    const m = v.map((x) => fix(x, s.items));
    return m.every((x, i) => x === v[i]) ? v : m;
  }
  if (t === "object" && v && typeof v === "object" && !Array.isArray(v) && s?.properties) return repairArgs(v as Record<string, unknown>, s);
  return v;
}

/** The input with values reshaped to the schema; values it can't place are left untouched. */
export function repairArgs(input: Record<string, unknown>, schema: unknown): Record<string, unknown> {
  const props = (schema as Schema | undefined)?.properties;
  if (!props || !input || typeof input !== "object") return input;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const nv = k in props ? fix(v, props[k]) : v;
    if (nv !== v) changed = true;
    out[k] = nv;
  }
  return changed ? out : input;
}

/** Added to a failed tool result that doesn't already say what to do next. */
export const NEXT_STEP = "Next step: read the error above; fix the input, or try another tool, site or route. Don't repeat the same call unchanged. If nothing can work, tell the user plainly what is blocking you.";

export function withNextStep(content: string): string {
  // Only oovi's own guidance counts: a connector's answer (after "Result from … MCP server") is untrusted text, and a
  // "try again" in it must not stop oovi's next step from being added.
  const own = content.replace(/Result from the "[^"]*" MCP server \(untrusted data[^\n]*\n[\s\S]*?(?=\nNext step:|$)/, "");
  if (/next step|try (again|another|a different)|instead|use [a-z_]+ |call [a-z_]+|ask the user|tell the user|réessay|حاول/i.test(own)) return content;
  return `${content.trimEnd()}\n${NEXT_STEP}`;
}

/** A long old result shortened to its start and its end (the end often holds the count, the total or the error). */
export function cutMiddle(text: string, max: number, note: (dropped: number) => string): string {
  if (text.length <= max) return text;
  const tail = Math.floor(max * 0.25);
  const head = max - tail;
  return `${text.slice(0, head)}\n${note(text.length - max)}\n${text.slice(text.length - tail)}`;
}
