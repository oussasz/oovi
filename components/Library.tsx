"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import Icon from "./Icon";

type Skill = { slug: string; name: string; description: string; body: string; source?: string; uses: number; updatedAt: number };
type Server = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  trusted: boolean;
  envKeys: string[];
  headerKeys: string[];
  status: "connected" | "error" | "idle";
  error?: string;
  tools: { name: string; description?: string }[];
};
type Field = { name: string; description?: string; required?: boolean; secret?: boolean };
type RegItem = {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  repo?: string;
  install: { transport: "stdio"; command: string; args: string[]; env: Field[] } | { transport: "http"; url: string; headers: Field[] };
};
type Draft = { name: string; transport: "stdio" | "http"; command: string; args: string; url: string; fields: Field[]; values: Record<string, string>; extra: string };
type SkillDraft = { slug?: string; name: string; description: string; body: string };

const emptyDraft: Draft = { name: "", transport: "stdio", command: "npx", args: "", url: "", fields: [], values: {}, extra: "" };

const isMac = () => typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

const PRESETS: { label: string; hint: string; draft: () => Partial<Draft> }[] = [
  {
    label: "Files on your computer",
    hint: "Read and write files in one folder. Edit the folder path at the end.",
    draft: () => ({ name: "Files", transport: "stdio", command: "npx", args: `-y @modelcontextprotocol/server-filesystem ${isMac() ? "/Users/YOU/Documents" : "C:\\Users\\YOU\\Documents"}` }),
  },
  { label: "Memory", hint: "A knowledge graph your bots can store facts in.", draft: () => ({ name: "Memory", transport: "stdio", command: "npx", args: "-y @modelcontextprotocol/server-memory" }) },
  {
    label: "GitHub",
    hint: "Issues, pull requests and code. Needs a GitHub token.",
    draft: () => ({ name: "GitHub", transport: "http", url: "https://api.githubcopilot.com/mcp/", fields: [{ name: "Authorization", description: "Bearer YOUR_GITHUB_TOKEN", required: true, secret: true }] }),
  },
];

const parseArgs = (s: string) => [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");

export default function Library() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [editing, setEditing] = useState<SkillDraft | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RegItem[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api<Skill[]>("/api/skills"), api<Server[]>("/api/mcp")]);
      setSkills(s);
      setServers(m);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  // ---------- skills ----------
  const saveSkill = () =>
    editing &&
    run("skill", async () => {
      const body = JSON.stringify({ name: editing.name, description: editing.description, body: editing.body });
      if (editing.slug) await api(`/api/skills/${editing.slug}`, { method: "PUT", body });
      else await api("/api/skills", { method: "POST", body });
      setEditing(null);
      return "Skill saved.";
    });

  const importSkill = () =>
    run("import", async () => {
      const s = await api<Skill>("/api/skills", { method: "POST", body: JSON.stringify({ url: importUrl }) });
      setImportUrl("");
      return `Installed the skill "${s.name}".`;
    });

  // ---------- MCP ----------
  const search = () =>
    run("search", async () => {
      const r = await api<{ items: RegItem[] }>(`/api/mcp/registry?q=${encodeURIComponent(q)}`);
      setResults(r.items);
      return r.items.length ? "" : "Nothing found. Try another word.";
    });

  function fromRegistry(item: RegItem) {
    const short = (item.title || item.name.split("/").pop() || item.name).replace(/[-_]/g, " ").slice(0, 40);
    setDraft(
      item.install.transport === "stdio"
        ? { ...emptyDraft, name: short, transport: "stdio", command: item.install.command, args: item.install.args.join(" "), fields: item.install.env }
        : { ...emptyDraft, name: short, transport: "http", url: item.install.url, fields: item.install.headers },
    );
  }

  const addServer = () =>
    draft &&
    run("add", async () => {
      const kv: Record<string, string> = {};
      for (const f of draft.fields) if (draft.values[f.name]) kv[f.name] = draft.values[f.name] ?? "";
      for (const line of draft.extra.split(/\r?\n/)) {
        const m = draft.transport === "stdio" ? line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/) : line.match(/^\s*([\w.-]+)\s*:\s*(.*)$/);
        if (m?.[1]) kv[m[1]] = (m[2] ?? "").trim();
      }
      const missing = draft.fields.filter((f) => f.required && !kv[f.name]).map((f) => f.name);
      if (missing.length) throw new Error(`Fill in: ${missing.join(", ")}`);
      const body =
        draft.transport === "stdio"
          ? { name: draft.name, transport: "stdio", command: draft.command, args: parseArgs(draft.args), env: kv }
          : { name: draft.name, transport: "http", url: draft.url, headers: kv };
      const { id } = await api<{ id: string }>("/api/mcp", { method: "POST", body: JSON.stringify(body) });
      setDraft(null);
      const t = await api<{ ok: boolean; tools?: string[]; error?: string }>(`/api/mcp/${id}`, { method: "POST" });
      if (!t.ok) throw new Error(`Added, but it didn't start: ${t.error}`);
      return `Connected: ${t.tools?.length ?? 0} tools. Turn it on for a bot in the bot editor.`;
    });

  return (
    <main className="settings library">
      <h1>Library</h1>
      <p className="lead">Skills teach your bots how to do things; MCP servers give them new tools. Both work with every model.</p>

      <h2>Skills</h2>
      <div className="card">
        <p className="muted">
          A skill is a step-by-step procedure your bots load when it fits the request. Bots also <b>learn</b>: when you ask for the same kind of task again and again, they offer to save it as a skill (you approve), so next time is faster. Uses the standard <code>SKILL.md</code> format, so you can install skills others share.
        </p>
        <div className="row-btns">
          <button className="btn primary" onClick={() => setEditing({ name: "", description: "", body: "" })}>
            <Icon name="plus" size={16} /> New skill
          </button>
          <a className="btn" href="https://github.com/anthropics/skills" target="_blank" rel="noreferrer noopener">
            Browse shared skills
          </a>
        </div>
        <div className="fb-add" style={{ gridTemplateColumns: "1fr auto" }}>
          <label className="field">
            Install from a link (a SKILL.md file or a GitHub folder)
            <input value={importUrl} placeholder="https://github.com/owner/repo/tree/main/skills/my-skill" onChange={(e) => setImportUrl(e.target.value)} />
          </label>
          <button className="btn" onClick={() => void importSkill()} disabled={!importUrl.trim() || busy !== null}>
            {busy === "import" ? "Installing…" : "Install"}
          </button>
        </div>

        {editing && (
          <div className="skill-editor">
            <div className="grid">
              <label className="field">
                Name
                <input value={editing.name} maxLength={80} placeholder="e.g. Weekly LinkedIn post" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </label>
              <label className="field">
                When to use it
                <input value={editing.description} maxLength={500} placeholder="e.g. When I ask for my weekly LinkedIn update" onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </label>
            </div>
            <label className="field">
              Instructions (Markdown)
              <textarea rows={10} className="mono" value={editing.body} placeholder={"1. Ask which project to feature\n2. Draft 3 short options\n3. …"} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            </label>
            <div className="row-btns">
              <button className="btn primary" onClick={() => void saveSkill()} disabled={busy !== null || !editing.name.trim() || !editing.description.trim() || !editing.body.trim()}>
                Save skill
              </button>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="lib-list">
          {skills.length === 0 && <p className="note">No skills yet.</p>}
          {skills.map((s) => (
            <div key={s.slug} className="lib-item">
              <div className="lib-main">
                <b>{s.name}</b>
                <span>{s.description}</span>
                <span className="tags">
                  <span className="tag">used {s.uses}×</span>
                  {s.source === "learned" && <span className="tag ok">learned by a bot</span>}
                  {s.source && s.source !== "learned" && s.source !== "you" && <span className="tag">installed</span>}
                </span>
              </div>
              <button className="icon-btn sm" onClick={() => setEditing({ slug: s.slug, name: s.name, description: s.description, body: s.body })} aria-label={`Edit ${s.name}`} title="Edit">
                <Icon name="edit" size={16} />
              </button>
              <button className="icon-btn sm" onClick={() => confirm(`Delete the skill "${s.name}"?`) && void run(`del-${s.slug}`, async () => void (await api(`/api/skills/${s.slug}`, { method: "DELETE" })))} aria-label={`Delete ${s.name}`} title="Delete">
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <h2>MCP servers (tools)</h2>
      <div className="card">
        <p className="muted">
          Connect MCP servers to give bots new tools: your files, GitHub, databases, Notion, Slack and more. Turn them on per bot in the bot editor. Bots ask before every MCP action unless you mark a server as trusted.
        </p>
        <div className="opt-label">Quick add</div>
        <div className="chip-row">
          {PRESETS.map((p) => (
            <button key={p.label} className="chip big" title={p.hint} onClick={() => setDraft({ ...emptyDraft, ...p.draft() })}>
              <Icon name="plus" size={14} /> {p.label}
            </button>
          ))}
          <button className="chip big" onClick={() => setDraft({ ...emptyDraft })}>
            <Icon name="plus" size={14} /> Custom server
          </button>
        </div>

        <div className="fb-add" style={{ gridTemplateColumns: "1fr auto", marginTop: 12 }}>
          <label className="field">
            Search the official MCP registry
            <input value={q} placeholder="e.g. notion, postgres, slack, calendar" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
          </label>
          <button className="btn" onClick={() => void search()} disabled={busy !== null}>
            {busy === "search" ? "Searching…" : "Search"}
          </button>
        </div>
        {results && results.length > 0 && (
          <div className="lib-list">
            {results.slice(0, 20).map((r) => (
              <div key={r.name} className="lib-item">
                <div className="lib-main">
                  <b>{r.title || r.name}</b>
                  <span>{r.description}</span>
                  <span className="tags">
                    <span className="tag">{r.install.transport === "http" ? "remote" : r.install.command}</span>
                    {r.repo && (
                      <a className="tag" href={r.repo} target="_blank" rel="noreferrer noopener">
                        source
                      </a>
                    )}
                  </span>
                </div>
                <button className="btn sm" onClick={() => fromRegistry(r)}>Add</button>
              </div>
            ))}
          </div>
        )}

        {draft && (
          <div className="skill-editor">
            <div className="grid">
              <label className="field">
                Name
                <input value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="field">
                Kind
                <select value={draft.transport} onChange={(e) => setDraft({ ...draft, transport: e.target.value as Draft["transport"] })}>
                  <option value="stdio">Runs on this computer (command)</option>
                  <option value="http">Remote (URL)</option>
                </select>
              </label>
              {draft.transport === "stdio" ? (
                <>
                  <label className="field">
                    Command
                    <input value={draft.command} placeholder="npx" onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
                  </label>
                  <label className="field">
                    Arguments
                    <input value={draft.args} placeholder="-y @scope/server-name" onChange={(e) => setDraft({ ...draft, args: e.target.value })} />
                  </label>
                </>
              ) : (
                <label className="field full">
                  URL
                  <input value={draft.url} placeholder="https://…/mcp" onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
                </label>
              )}
              {draft.fields.map((f) => (
                <label key={f.name} className="field">
                  {f.name}
                  {f.required ? " *" : ""}
                  <input type={f.secret ? "password" : "text"} autoComplete="off" value={draft.values[f.name] ?? ""} placeholder={f.description ?? ""} onChange={(e) => setDraft({ ...draft, values: { ...draft.values, [f.name]: e.target.value } })} />
                </label>
              ))}
              <label className="field full">
                {draft.transport === "stdio" ? "Other environment variables (KEY=value, one per line)" : "Other headers (Name: value, one per line)"}
                <textarea rows={2} className="mono" value={draft.extra} onChange={(e) => setDraft({ ...draft, extra: e.target.value })} />
              </label>
            </div>
            <p className="note">Secrets are encrypted on this computer. Servers started with npx need Node.js installed (nodejs.org); uvx needs Python&apos;s uv.</p>
            <div className="row-btns">
              <button className="btn primary" onClick={() => void addServer()} disabled={busy !== null || !draft.name.trim() || (draft.transport === "stdio" ? !draft.command.trim() : !draft.url.trim())}>
                {busy === "add" ? "Connecting…" : "Add & connect"}
              </button>
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="lib-list">
          {servers.length === 0 && <p className="note">No servers yet.</p>}
          {servers.map((s) => (
            <div key={s.id} className="lib-item">
              <span className={`dot ${s.status === "connected" ? "ok" : s.status === "error" ? "err" : ""}`} title={s.status} />
              <div className="lib-main">
                <b>{s.name}</b>
                <span className="mono-sm">{s.transport === "stdio" ? `${s.command} ${(s.args ?? []).join(" ")}` : s.url}</span>
                {s.error && <span className="msg-err" style={{ fontSize: 12.5 }}>{s.error}</span>}
                {s.tools.length > 0 && <span className="note">{s.tools.length} tools: {s.tools.slice(0, 8).map((t) => t.name).join(", ")}{s.tools.length > 8 ? "…" : ""}</span>}
                <span className="tags">
                  <label className="mini-check">
                    <input type="checkbox" checked={s.enabled} onChange={(e) => void run(`en-${s.id}`, async () => void (await api(`/api/mcp/${s.id}`, { method: "PUT", body: JSON.stringify({ enabled: e.target.checked }) })))} /> on
                  </label>
                  <label className="mini-check" title="Trusted servers run without asking you first">
                    <input
                      type="checkbox"
                      checked={s.trusted}
                      onChange={(e) =>
                        (!e.target.checked || confirm(`Let bots use ${s.name} without asking you each time?`)) &&
                        void run(`tr-${s.id}`, async () => void (await api(`/api/mcp/${s.id}`, { method: "PUT", body: JSON.stringify({ trusted: e.target.checked }) })))
                      }
                    />{" "}
                    trusted
                  </label>
                </span>
              </div>
              <button
                className="btn sm"
                disabled={busy !== null}
                onClick={() =>
                  void run(`test-${s.id}`, async () => {
                    const t = await api<{ ok: boolean; tools?: string[]; error?: string }>(`/api/mcp/${s.id}`, { method: "POST" });
                    if (!t.ok) throw new Error(t.error);
                    return `${s.name}: ${t.tools?.length ?? 0} tools.`;
                  })
                }
              >
                {busy === `test-${s.id}` ? "Testing…" : "Test"}
              </button>
              <button className="icon-btn sm" onClick={() => confirm(`Remove ${s.name}?`) && void run(`rm-${s.id}`, async () => void (await api(`/api/mcp/${s.id}`, { method: "DELETE" })))} aria-label={`Remove ${s.name}`} title="Remove">
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {msg && <div className={`notice${msg.ok ? "" : " error"}`} style={{ position: "sticky", bottom: 12 }}>{msg.text}</div>}
    </main>
  );
}
