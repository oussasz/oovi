// theOovi: which tool definitions the hosted-model route forwards to the provider.
// Pure (no imports) so it can be unit-tested on its own.
//
// Two kinds of entries are accepted, nothing else:
//   - the app's own tools: { name, description, input_schema, cache_control? }
//   - Anthropic's computer toolset (desktop control, Beta), at most once:
//     { type: "computer_toolset_20260801", configs?, cache_control? }
//     configs may only switch members on or off: { zoom: { enabled: false } }.

type Block = Record<string, unknown>;

export const MAX_TOOLS = 128;
export const COMPUTER_TOOLSET = "computer_toolset_20260801";
/** Anthropic: declaring the toolset with its default members adds about 4,520 input tokens. */
export const COMPUTER_TOOLSET_TOKENS = 4600;
const COMPUTER_MEMBERS = new Set([
  "screenshot",
  "zoom",
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "left_click_drag",
  "mouse_move",
  "left_mouse_down",
  "left_mouse_up",
  "cursor_position",
  "scroll",
  "type",
  "key",
  "hold_key",
  "wait",
]);

/** Keeps a cache_control mark only when it's the plain ephemeral kind. */
export function cleanCache(b: Block): Block {
  const out = { ...b };
  if ("cache_control" in out) {
    const cc = out.cache_control as { type?: unknown } | null;
    if (cc && typeof cc === "object" && cc.type === "ephemeral") out.cache_control = { type: "ephemeral" };
    else delete out.cache_control;
  }
  return out;
}

const isObject = (v: unknown): v is Block => !!v && typeof v === "object" && !Array.isArray(v);

/** The computer toolset entry with only the fields we allow, or null if anything about it is off. */
function cleanToolset(t: Block): Block | null {
  for (const k of Object.keys(t)) if (k !== "type" && k !== "configs" && k !== "cache_control") return null;
  if (t.type !== COMPUTER_TOOLSET) return null;
  const out: Block = { type: COMPUTER_TOOLSET };
  if (t.configs !== undefined) {
    if (!isObject(t.configs)) return null;
    const configs: Record<string, { enabled: boolean }> = {};
    for (const [member, v] of Object.entries(t.configs)) {
      if (!COMPUTER_MEMBERS.has(member) || !isObject(v)) return null;
      const keys = Object.keys(v);
      if (keys.length !== 1 || keys[0] !== "enabled" || typeof v.enabled !== "boolean") return null;
      configs[member] = { enabled: v.enabled };
    }
    // Anthropic refuses a toolset with every member switched off.
    if ([...COMPUTER_MEMBERS].every((m) => configs[m]?.enabled === false)) return null;
    if (Object.keys(configs).length) out.configs = configs;
  }
  if (t.cache_control !== undefined) out.cache_control = t.cache_control;
  return cleanCache(out);
}

/** The request's tools, cleaned; null when anything is malformed (the route answers 400). */
export function cleanTools(raw: unknown): Block[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_TOOLS) return null;
  const out: Block[] = [];
  let toolset = false;
  for (const t of raw) {
    if (!isObject(t)) return null;
    if ("type" in t) {
      const c = toolset ? null : cleanToolset(t);
      if (!c) return null;
      toolset = true;
      out.push(c);
      continue;
    }
    const { name, description, input_schema, cache_control } = t;
    if (typeof name !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(name)) return null;
    // Anthropic refuses another tool named "computer" next to the toolset; refuse it in any case.
    if (name === "computer") return null;
    if (!input_schema || typeof input_schema !== "object") return null;
    out.push(cleanCache({ name, description: typeof description === "string" ? description : "", input_schema, ...(cache_control ? { cache_control } : {}) }));
  }
  return out;
}

export const hasComputerToolset = (tools: Block[]) => tools.some((t) => t.type === COMPUTER_TOOLSET);

/**
 * Claude models that accept computer_toolset_20260801: Haiku 5.5, Sonnet 5.5, Opus 5.5,
 * Opus 5, Sonnet 5, Opus 4.8, and Fable / Mythos 5.x (Anthropic's computer use docs).
 */
export function supportsComputerToolset(model: string): boolean {
  const m = model.trim().toLowerCase().match(/^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d+))?(?:$|[-@])/);
  if (!m) return false;
  const v = Number(m[2]) + Number(m[3] && m[3].length <= 2 ? m[3] : 0) / 10;
  if (m[1] === "fable" || m[1] === "mythos") return v >= 5;
  if (m[1] === "haiku") return v >= 5.5;
  if (m[1] === "opus") return v >= 4.8;
  return v >= 5;
}
