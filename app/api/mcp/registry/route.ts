import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Field = { name: string; description?: string; required?: boolean; secret?: boolean };
type Install = { transport: "stdio"; command: string; args: string[]; env: Field[] } | { transport: "http"; url: string; headers: Field[] };
export type RegistryItem = { name: string; title?: string; description?: string; version?: string; repo?: string; install: Install };

// The registry's JSON has changed shape over time (camelCase / snake_case,
// wrapped / unwrapped), so read it loosely.
type Loose = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const arr = (v: unknown) => (Array.isArray(v) ? (v as Loose[]) : []);

function fields(list: Loose[]): Field[] {
  return list
    .map((f) => ({ name: str(f.name) ?? "", description: str(f.description), required: Boolean(f.isRequired ?? f.is_required), secret: Boolean(f.isSecret ?? f.is_secret) }))
    .filter((f) => f.name);
}

function toItem(raw: Loose): RegistryItem | null {
  const s = ((raw.server as Loose | undefined) ?? raw) as Loose;
  const meta = (raw._meta as Loose | undefined)?.["io.modelcontextprotocol.registry/official"] as Loose | undefined;
  if (meta && meta.isLatest === false) return null;
  const name = str(s.name);
  if (!name) return null;

  let install: Install | null = null;
  for (const p of arr(s.packages)) {
    const type = str(p.registryType ?? p.registry_type ?? p.registry_name);
    const id = str(p.identifier ?? p.name);
    if (!id) continue;
    const env = fields(arr(p.environmentVariables ?? p.environment_variables));
    if (type === "npm") install = { transport: "stdio", command: "npx", args: ["-y", id], env };
    else if (type === "pypi") install = { transport: "stdio", command: "uvx", args: [id], env };
    if (install) break;
  }
  if (!install) {
    const r = arr(s.remotes).find((x) => {
      const t = str(x.type ?? x.transport_type);
      return t === "streamable-http" || t === "sse" || t === "http";
    });
    const url = r ? str(r.url) : undefined;
    if (r && url) install = { transport: "http", url, headers: fields(arr(r.headers)) };
  }
  if (!install) return null;

  const repo = s.repository as Loose | undefined;
  return { name, title: str(s.title), description: str(s.description), version: str(s.version ?? (s.version_detail as Loose | undefined)?.version), repo: repo ? str(repo.url) : undefined, install };
}

/** Search the official MCP registry (registry.modelcontextprotocol.io). */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  try {
    const res = await fetch(`https://registry.modelcontextprotocol.io/v0/servers?limit=50${q ? `&search=${encodeURIComponent(q)}` : ""}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`The MCP registry answered ${res.status}.`);
    const j = (await res.json()) as { servers?: unknown[] };
    const seen = new Set<string>();
    const items: RegistryItem[] = [];
    for (const raw of j.servers ?? []) {
      const item = raw && typeof raw === "object" ? toItem(raw as Loose) : null;
      if (item && !seen.has(item.name)) {
        seen.add(item.name);
        items.push(item);
      }
    }
    return Response.json({ items });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
