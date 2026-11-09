// Marketplace catalog shapes and validation. Shared by the admin editor (live
// checks in the browser) and the server actions (the real check), so no server
// imports here. Keep in sync with the desktop app's lib/catalog.ts types.

export const CATALOG_KINDS = ["connector", "skill", "plugin"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export const CONNECTOR_CATEGORIES = [
  "everything",
  "google-microsoft",
  "productivity",
  "files",
  "design",
  "sales",
  "finance",
  "dev",
  "docs",
  "local",
] as const;
export const SKILL_CATEGORIES = ["work", "writing", "research", "coding", "life"] as const;
export const FIELD_TARGETS = ["env", "header", "arg"] as const;
export const FACE_KEYS = ["color", "shape", "hair", "eyes", "nose", "mouth", "cheeks", "top", "wear"] as const;

export type CatalogField = {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
  help?: string;
  to: (typeof FIELD_TARGETS)[number];
  name?: string;
  template?: string;
  folder?: boolean;
};

export type ConnectorData = {
  name: string;
  by: string;
  description: string;
  category: (typeof CONNECTOR_CATEGORIES)[number];
  transport: "http" | "stdio";
  url?: string;
  oauth?: boolean;
  command?: string;
  args?: string[];
  fields?: CatalogField[];
  needsNode?: boolean;
  docs?: string;
  verified?: boolean;
  /** true, or a short note on why it isn't available yet. */
  soon?: boolean | string;
  logo?: string;
};

export type SkillData = {
  name: string;
  description: string;
  category: (typeof SKILL_CATEGORIES)[number];
  body: string;
};

export type Face = Record<(typeof FACE_KEYS)[number], number>;

export type PluginBot = {
  name: string;
  role: string;
  instructions: string;
  lead?: boolean;
  tools: { web: boolean; browser: boolean; accounts?: boolean };
  face: Face;
};

export type PluginData = {
  name: string;
  description: string;
  group: string;
  skills: string[];
  connectors?: string[];
  usesFolder?: boolean;
  bots: PluginBot[];
};

export type CatalogData = ConnectorData | SkillData | PluginData;

export type CatalogItem = {
  id: string;
  kind: CatalogKind;
  data: CatalogData;
  published: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
};

export const MAX_SKILL_BODY = 20_000;
export const MAX_DATA_JSON = 64 * 1024;
export const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SORT_MIN = -100_000;
export const SORT_MAX = 100_000;

export function isCatalogKind(v: unknown): v is CatalogKind {
  return typeof v === "string" && (CATALOG_KINDS as readonly string[]).includes(v);
}

export function validateCatalogId(id: unknown): string | null {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return "ID must be 1-64 characters: lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number.";
  }
  return null;
}

export function validateSort(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.trim()) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < SORT_MIN || n > SORT_MAX) return null;
  return n;
}

// ---------- small checkers ----------

type Obj = Record<string, unknown>;

class Checker {
  errors: string[] = [];
  private readonly obj: Obj;
  private readonly path: string;
  constructor(obj: Obj, path: string) {
    this.obj = obj;
    this.path = path;
  }

  private at(key: string) {
    return this.path ? `${this.path}.${key}` : key;
  }
  private fail(key: string, msg: string) {
    this.errors.push(`${this.at(key)} ${msg}`);
  }

  /** Reports keys that aren't part of the shape (usually typos). */
  only(keys: readonly string[]) {
    for (const k of Object.keys(this.obj)) {
      if (!keys.includes(k)) this.errors.push(`${this.at(k)} is not a known field.`);
    }
  }

  str(key: string, max: number, required: boolean, re?: RegExp, reMsg?: string) {
    const v = this.obj[key];
    if (v === undefined) {
      if (required) this.fail(key, "is required.");
      return;
    }
    if (typeof v !== "string") return this.fail(key, "must be text.");
    if (required && !v.trim()) return this.fail(key, "can't be empty.");
    if (v.length > max) return this.fail(key, `is too long (max ${max} characters).`);
    if (re && !re.test(v)) this.fail(key, reMsg ?? "has an invalid format.");
  }

  bool(key: string, required = false) {
    const v = this.obj[key];
    if (v === undefined) {
      if (required) this.fail(key, "is required.");
      return;
    }
    if (typeof v !== "boolean") this.fail(key, "must be true or false.");
  }

  oneOf(key: string, values: readonly string[], required = true) {
    const v = this.obj[key];
    if (v === undefined) {
      if (required) this.fail(key, `is required (one of: ${values.join(", ")}).`);
      return;
    }
    if (typeof v !== "string" || !values.includes(v)) this.fail(key, `must be one of: ${values.join(", ")}.`);
  }

  https(key: string, required = false) {
    const v = this.obj[key];
    if (v === undefined) {
      if (required) this.fail(key, "is required.");
      return;
    }
    if (typeof v !== "string" || v.length > 2000 || !isHttpsUrl(v)) this.fail(key, "must be an https:// link.");
  }

  strArray(key: string, maxItems: number, maxLen: number, required: boolean, re?: RegExp, reMsg?: string) {
    const v = this.obj[key];
    if (v === undefined) {
      if (required) this.fail(key, "is required (a list, can be empty).");
      return;
    }
    if (!Array.isArray(v)) return this.fail(key, "must be a list of text values.");
    if (v.length > maxItems) return this.fail(key, `has too many entries (max ${maxItems}).`);
    v.forEach((item, i) => {
      if (typeof item !== "string" || !item || item.length > maxLen) {
        this.errors.push(`${this.at(key)}[${i}] must be text (1-${maxLen} characters).`);
      } else if (re && !re.test(item)) {
        this.errors.push(`${this.at(key)}[${i}] ${reMsg ?? "has an invalid format."}`);
      }
    });
  }

  int(key: string, min: number, max: number) {
    const v = this.obj[key];
    if (v === undefined) return this.fail(key, "is required.");
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
      this.fail(key, `must be a whole number from ${min} to ${max}.`);
    }
  }
}

export function isHttpsUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// ---------- per kind ----------

const CONNECTOR_KEYS = [
  "name",
  "by",
  "description",
  "category",
  "transport",
  "url",
  "oauth",
  "command",
  "args",
  "fields",
  "needsNode",
  "docs",
  "verified",
  "soon",
  "logo",
] as const;
const FIELD_KEYS = ["key", "label", "placeholder", "secret", "optional", "help", "to", "name", "template", "folder"] as const;

function validateConnector(d: Obj): string[] {
  const c = new Checker(d, "");
  c.only(CONNECTOR_KEYS);
  c.str("name", 80, true);
  c.str("by", 80, true);
  c.str("description", 600, true);
  c.oneOf("category", CONNECTOR_CATEGORIES);
  c.oneOf("transport", ["http", "stdio"]);
  c.https("url");
  c.bool("oauth");
  c.str("command", 200, false);
  c.strArray("args", 50, 500, false);
  c.bool("needsNode");
  c.https("docs");
  c.bool("verified");
  c.https("logo");
  if (d.soon !== undefined && typeof d.soon !== "boolean") c.str("soon", 400, false);

  const soon = d.soon === true || (typeof d.soon === "string" && d.soon.trim() !== "");
  if (!soon && d.transport === "http" && d.url === undefined) c.errors.push("url is required for an http connector.");
  if (!soon && d.transport === "stdio" && d.command === undefined) c.errors.push("command is required for a stdio connector.");

  if (d.fields !== undefined) {
    if (!Array.isArray(d.fields)) c.errors.push("fields must be a list.");
    else if (d.fields.length > 30) c.errors.push("fields has too many entries (max 30).");
    else {
      const seen = new Set<string>();
      d.fields.forEach((f, i) => {
        const path = `fields[${i}]`;
        if (!isObj(f)) return c.errors.push(`${path} must be an object.`);
        const fc = new Checker(f, path);
        fc.only(FIELD_KEYS);
        fc.str("key", 64, true, /^[A-Za-z0-9_.-]+$/, "may only use letters, numbers, dots, dashes and underscores.");
        fc.str("label", 80, true);
        fc.str("placeholder", 200, false);
        fc.bool("secret");
        fc.bool("optional");
        fc.bool("folder");
        fc.str("help", 500, false);
        fc.oneOf("to", FIELD_TARGETS);
        fc.str("name", 128, false);
        fc.str("template", 500, false);
        if ((f.to === "env" || f.to === "header") && f.name === undefined) {
          fc.errors.push(`${path}.name is required when "to" is "${String(f.to)}".`);
        }
        if (typeof f.key === "string") {
          if (seen.has(f.key)) fc.errors.push(`${path}.key "${f.key}" is used twice.`);
          seen.add(f.key);
        }
        c.errors.push(...fc.errors);
      });
    }
  }
  return c.errors;
}

const SKILL_KEYS = ["name", "description", "category", "body"] as const;

function validateSkill(d: Obj): string[] {
  const c = new Checker(d, "");
  c.only(SKILL_KEYS);
  c.str("name", 80, true);
  c.str("description", 600, true);
  c.oneOf("category", SKILL_CATEGORIES);
  c.str("body", MAX_SKILL_BODY, true);
  return c.errors;
}

const PLUGIN_KEYS = ["name", "description", "group", "skills", "connectors", "usesFolder", "bots"] as const;
const BOT_KEYS = ["name", "role", "instructions", "lead", "tools", "face"] as const;
const TOOL_KEYS = ["web", "browser", "accounts"] as const;

function validatePlugin(d: Obj): string[] {
  const c = new Checker(d, "");
  c.only(PLUGIN_KEYS);
  c.str("name", 80, true);
  c.str("description", 600, true);
  c.str("group", 80, true);
  c.strArray("skills", 50, 64, true, ID_RE, "must be a catalog ID.");
  c.strArray("connectors", 50, 64, false, ID_RE, "must be a catalog ID.");
  c.bool("usesFolder");

  if (!Array.isArray(d.bots)) {
    c.errors.push("bots is required (a list of 1 to 12 bots).");
    return c.errors;
  }
  if (d.bots.length < 1 || d.bots.length > 12) c.errors.push("bots must have 1 to 12 bots.");
  const names = new Set<string>();
  let leads = 0;
  d.bots.forEach((b, i) => {
    const path = `bots[${i}]`;
    if (!isObj(b)) return c.errors.push(`${path} must be an object.`);
    const bc = new Checker(b, path);
    bc.only(BOT_KEYS);
    bc.str("name", 24, true, /^[\p{L}\p{N}_-]+$/u, "must be one word (letters, numbers, - or _).");
    bc.str("role", 80, true);
    bc.str("instructions", 8000, true);
    bc.bool("lead");
    if (b.lead === true) leads += 1;
    if (typeof b.name === "string") {
      const key = b.name.toLowerCase();
      if (names.has(key)) bc.errors.push(`${path}.name "${b.name}" is used twice.`);
      names.add(key);
    }
    if (!isObj(b.tools)) bc.errors.push(`${path}.tools is required ({ "web": true, "browser": false }).`);
    else {
      const tc = new Checker(b.tools, `${path}.tools`);
      tc.only(TOOL_KEYS);
      tc.bool("web", true);
      tc.bool("browser", true);
      tc.bool("accounts");
      bc.errors.push(...tc.errors);
    }
    if (!isObj(b.face)) bc.errors.push(`${path}.face is required (${FACE_KEYS.join(", ")}).`);
    else {
      const fc = new Checker(b.face, `${path}.face`);
      fc.only(FACE_KEYS);
      for (const k of FACE_KEYS) fc.int(k, 0, 63);
      bc.errors.push(...fc.errors);
    }
    c.errors.push(...bc.errors);
  });
  if (leads > 1) c.errors.push("Only one bot can be the lead.");
  return c.errors;
}

/** Checks `data` against the shape for `kind`. Returns a list of readable problems (empty = valid). */
export function validateCatalogData(kind: CatalogKind, data: unknown): string[] {
  if (!isObj(data)) return ["Data must be a JSON object { ... }."];
  let size = 0;
  try {
    size = JSON.stringify(data).length;
  } catch {
    return ["Data could not be read as JSON."];
  }
  if (size > MAX_DATA_JSON) return [`Data is too large (max ${MAX_DATA_JSON / 1024} KB).`];
  switch (kind) {
    case "connector":
      return validateConnector(data);
    case "skill":
      return validateSkill(data);
    case "plugin":
      return validatePlugin(data);
  }
}

/** Parses JSON text, returning the value or a readable error. */
export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text.length > MAX_DATA_JSON * 2) return { ok: false, error: "That JSON is too large." };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: `That isn't valid JSON: ${(err as Error).message}` };
  }
}

/** Starter JSON for a new item of each kind. */
export const CATALOG_TEMPLATES: Record<CatalogKind, CatalogData> = {
  connector: {
    name: "Example",
    by: "Example Inc.",
    description: "What this connector lets bots do, in one sentence.",
    category: "productivity",
    transport: "http",
    url: "https://mcp.example.com/mcp",
    oauth: true,
    verified: false,
  },
  skill: {
    name: "Example skill",
    description: "What this skill helps with, in one sentence.",
    category: "work",
    body: "# Example skill\n\nStep-by-step instructions for the bot.",
  },
  plugin: {
    name: "Example team",
    description: "What this team does, in one sentence.",
    group: "Example team",
    skills: [],
    bots: [
      {
        name: "Lead",
        role: "Team lead",
        lead: true,
        instructions: "You lead the team. Plan the work and give each teammate one clear task.",
        tools: { web: true, browser: false },
        face: { color: 0, shape: 0, hair: 0, eyes: 1, nose: 0, mouth: 0, cheeks: 1, top: 0, wear: 0 },
      },
    ],
  },
};
