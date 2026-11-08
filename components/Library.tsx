"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useI18n } from "./I18n";
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

// Label: lib.preset.<id>; hint: lib.preset.<id>.hint.
const PRESETS: { id: "files" | "memory" | "github"; draft: () => Partial<Draft> }[] = [
  {
    id: "files",
    draft: () => ({ name: "Files", transport: "stdio", command: "npx", args: `-y @modelcontextprotocol/server-filesystem ${isMac() ? "/Users/YOU/Documents" : "C:\\Users\\YOU\\Documents"}` }),
  },
  { id: "memory", draft: () => ({ name: "Memory", transport: "stdio", command: "npx", args: "-y @modelcontextprotocol/server-memory" }) },
  {
    id: "github",
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
  const [mem, setMem] = useState<{ user: string; memory: string; limits: { user: number; memory: number } } | null>(null);
  const { t, rich } = useI18n();

  useEffect(() => {
    api<{ user: string; memory: string; limits: { user: number; memory: number } }>("/api/memory").then(setMem).catch(() => {});
  }, []);

  const saveMemory = (target: "user" | "memory") =>
    mem &&
    run(`mem-${target}`, async () => {
      setMem(await api("/api/memory", { method: "PUT", body: JSON.stringify({ target, text: mem[target] }) }));
      return t("lib.memorySaved");
    });

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
      return t("lib.skillSaved");
    });

  const importSkill = () =>
    run("import", async () => {
      const s = await api<Skill>("/api/skills", { method: "POST", body: JSON.stringify({ url: importUrl }) });
      setImportUrl("");
      return t("lib.installedSkill", { name: s.name });
    });

  // ---------- MCP ----------
  const search = () =>
    run("search", async () => {
      const r = await api<{ items: RegItem[] }>(`/api/mcp/registry?q=${encodeURIComponent(q)}`);
      setResults(r.items);
      return r.items.length ? "" : t("lib.nothingFound");
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
      if (missing.length) throw new Error(t("lib.fillIn", { fields: missing.join(", ") }));
      const body =
        draft.transport === "stdio"
          ? { name: draft.name, transport: "stdio", command: draft.command, args: parseArgs(draft.args), env: kv }
          : { name: draft.name, transport: "http", url: draft.url, headers: kv };
      const { id } = await api<{ id: string }>("/api/mcp", { method: "POST", body: JSON.stringify(body) });
      setDraft(null);
      const r = await api<{ ok: boolean; tools?: string[]; error?: string }>(`/api/mcp/${id}`, { method: "POST" });
      if (!r.ok) throw new Error(t("lib.notStarted", { error: r.error ?? "" }));
      return t("lib.connected", { count: r.tools?.length ?? 0 });
    });

  return (
    <main className="settings library">
      <h1>{t("lib.title")}</h1>
      <p className="lead">{t("lib.lead")}</p>

      <h2>{t("lib.memory")}</h2>
      <div className="card">
        <p className="muted">{rich("lib.memoryIntro", { about: <b>{t("lib.memoryAbout")}</b>, notes: <b>{t("lib.memoryNotes")}</b>, sep: <code>§</code> })}</p>
        {mem ? (
          <div className="grid">
            {(["user", "memory"] as const).map((k) => (
              <label key={k} className="field">
                {k === "user" ? t("lib.userLabel") : t("lib.memLabel")}
                <textarea rows={8} className="mono" value={mem[k]} onChange={(e) => setMem({ ...mem, [k]: e.target.value })} placeholder={k === "user" ? t("lib.userPh") : t("lib.memPh")} />
                <span className={`hint${mem[k].length > mem.limits[k] ? " msg-err" : ""}`}>
                  {t("lib.chars", { n: mem[k].length, max: mem.limits[k] })}
                </span>
                <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => void saveMemory(k)} disabled={busy !== null || mem[k].length > mem.limits[k]}>
                  {t("common.save")}
                </button>
              </label>
            ))}
          </div>
        ) : (
          <p className="note">{t("common.loading")}</p>
        )}
      </div>

      <h2>{t("lib.skills")}</h2>
      <div className="card">
        <p className="muted">{rich("lib.skillsIntro", { learn: <b>{t("lib.learn")}</b>, format: <code>SKILL.md</code> })}</p>
        <div className="row-btns">
          <button className="btn primary" onClick={() => setEditing({ name: "", description: "", body: "" })}>
            <Icon name="plus" size={16} /> {t("lib.newSkill")}
          </button>
          <a className="btn" href="https://github.com/anthropics/skills" target="_blank" rel="noreferrer noopener">
            {t("lib.browseSkills")}
          </a>
        </div>
        <div className="fb-add" style={{ gridTemplateColumns: "1fr auto" }}>
          <label className="field">
            {t("lib.installFrom")}
            <input value={importUrl} placeholder="https://github.com/owner/repo/tree/main/skills/my-skill" onChange={(e) => setImportUrl(e.target.value)} />
          </label>
          <button className="btn" onClick={() => void importSkill()} disabled={!importUrl.trim() || busy !== null}>
            {busy === "import" ? t("lib.installing") : t("lib.install")}
          </button>
        </div>

        {editing && (
          <div className="skill-editor">
            <div className="grid">
              <label className="field">
                {t("common.name")}
                <input value={editing.name} maxLength={80} placeholder={t("lib.skillNamePh")} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </label>
              <label className="field">
                {t("lib.whenToUse")}
                <input value={editing.description} maxLength={500} placeholder={t("lib.whenPh")} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </label>
            </div>
            <label className="field">
              {t("lib.instructionsMd")}
              <textarea rows={10} className="mono" value={editing.body} placeholder={t("lib.bodyPh")} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            </label>
            <div className="row-btns">
              <button className="btn primary" onClick={() => void saveSkill()} disabled={busy !== null || !editing.name.trim() || !editing.description.trim() || !editing.body.trim()}>
                {t("lib.saveSkill")}
              </button>
              <button className="btn" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
            </div>
          </div>
        )}

        <div className="lib-list">
          {skills.length === 0 && <p className="note">{t("lib.noSkills")}</p>}
          {skills.map((s) => (
            <div key={s.slug} className="lib-item">
              <div className="lib-main">
                <b>{s.name}</b>
                <span>{s.description}</span>
                <span className="tags">
                  <span className="tag">{t("lib.used", { n: s.uses })}</span>
                  {s.source === "learned" && <span className="tag ok">{t("lib.learned")}</span>}
                  {s.source && s.source !== "learned" && s.source !== "you" && <span className="tag">{t("lib.installed")}</span>}
                </span>
              </div>
              <button className="icon-btn sm" onClick={() => setEditing({ slug: s.slug, name: s.name, description: s.description, body: s.body })} aria-label={t("lib.editX", { name: s.name })} title={t("common.edit")}>
                <Icon name="edit" size={16} />
              </button>
              <button className="icon-btn sm" onClick={() => confirm(t("lib.confirmDeleteSkill", { name: s.name })) && void run(`del-${s.slug}`, async () => void (await api(`/api/skills/${s.slug}`, { method: "DELETE" })))} aria-label={t("lib.deleteX", { name: s.name })} title={t("common.delete")}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <h2>{t("lib.mcp")}</h2>
      <div className="card">
        <p className="muted">{t("lib.mcpIntro")}</p>
        <div className="opt-label">{t("lib.quickAdd")}</div>
        <div className="chip-row">
          {PRESETS.map((p) => (
            <button key={p.id} className="chip big" title={t(`lib.preset.${p.id}.hint`)} onClick={() => setDraft({ ...emptyDraft, ...p.draft() })}>
              <Icon name="plus" size={14} /> {t(`lib.preset.${p.id}`)}
            </button>
          ))}
          <button className="chip big" onClick={() => setDraft({ ...emptyDraft })}>
            <Icon name="plus" size={14} /> {t("lib.custom")}
          </button>
        </div>

        <div className="fb-add" style={{ gridTemplateColumns: "1fr auto", marginTop: 12 }}>
          <label className="field">
            {t("lib.searchRegistry")}
            <input value={q} placeholder={t("lib.searchPh")} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
          </label>
          <button className="btn" onClick={() => void search()} disabled={busy !== null}>
            {busy === "search" ? t("lib.searching") : t("lib.search")}
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
                    <span className="tag">{r.install.transport === "http" ? t("lib.remote") : r.install.command}</span>
                    {r.repo && (
                      <a className="tag" href={r.repo} target="_blank" rel="noreferrer noopener">
                        {t("lib.source")}
                      </a>
                    )}
                  </span>
                </div>
                <button className="btn sm" onClick={() => fromRegistry(r)}>{t("common.add")}</button>
              </div>
            ))}
          </div>
        )}

        {draft && (
          <div className="skill-editor">
            <div className="grid">
              <label className="field">
                {t("common.name")}
                <input value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="field">
                {t("lib.kind")}
                <select value={draft.transport} onChange={(e) => setDraft({ ...draft, transport: e.target.value as Draft["transport"] })}>
                  <option value="stdio">{t("lib.kindStdio")}</option>
                  <option value="http">{t("lib.kindHttp")}</option>
                </select>
              </label>
              {draft.transport === "stdio" ? (
                <>
                  <label className="field">
                    {t("lib.command")}
                    <input value={draft.command} placeholder="npx" onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
                  </label>
                  <label className="field">
                    {t("lib.args")}
                    <input value={draft.args} placeholder="-y @scope/server-name" onChange={(e) => setDraft({ ...draft, args: e.target.value })} />
                  </label>
                </>
              ) : (
                <label className="field full">
                  {t("lib.url")}
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
                {draft.transport === "stdio" ? t("lib.extraEnv") : t("lib.extraHeaders")}
                <textarea rows={2} className="mono" value={draft.extra} onChange={(e) => setDraft({ ...draft, extra: e.target.value })} />
              </label>
            </div>
            <p className="note">{t("lib.secretsNote")}</p>
            <div className="row-btns">
              <button className="btn primary" onClick={() => void addServer()} disabled={busy !== null || !draft.name.trim() || (draft.transport === "stdio" ? !draft.command.trim() : !draft.url.trim())}>
                {busy === "add" ? t("lib.connecting") : t("lib.addConnect")}
              </button>
              <button className="btn" onClick={() => setDraft(null)}>{t("common.cancel")}</button>
            </div>
          </div>
        )}

        <div className="lib-list">
          {servers.length === 0 && <p className="note">{t("lib.noServers")}</p>}
          {servers.map((s) => (
            <div key={s.id} className="lib-item">
              <span className={`dot ${s.status === "connected" ? "ok" : s.status === "error" ? "err" : ""}`} title={t(`lib.status.${s.status}`)} />
              <div className="lib-main">
                <b>{s.name}</b>
                <span className="mono-sm">{s.transport === "stdio" ? `${s.command} ${(s.args ?? []).join(" ")}` : s.url}</span>
                {s.error && <span className="msg-err" style={{ fontSize: 12.5 }}>{s.error}</span>}
                {s.tools.length > 0 && <span className="note">{t("lib.toolsList", { count: s.tools.length, names: `${s.tools.slice(0, 8).map((x) => x.name).join(", ")}${s.tools.length > 8 ? "…" : ""}` })}</span>}
                <span className="tags">
                  <label className="mini-check">
                    <input type="checkbox" checked={s.enabled} onChange={(e) => void run(`en-${s.id}`, async () => void (await api(`/api/mcp/${s.id}`, { method: "PUT", body: JSON.stringify({ enabled: e.target.checked }) })))} /> {t("lib.on")}
                  </label>
                  <label className="mini-check" title={t("lib.trustedTitle")}>
                    <input
                      type="checkbox"
                      checked={s.trusted}
                      onChange={(e) =>
                        (!e.target.checked || confirm(t("lib.confirmTrust", { name: s.name }))) &&
                        void run(`tr-${s.id}`, async () => void (await api(`/api/mcp/${s.id}`, { method: "PUT", body: JSON.stringify({ trusted: e.target.checked }) })))
                      }
                    />{" "}
                    {t("lib.trusted")}
                  </label>
                </span>
              </div>
              <button
                className="btn sm"
                disabled={busy !== null}
                onClick={() =>
                  void run(`test-${s.id}`, async () => {
                    const r = await api<{ ok: boolean; tools?: string[]; error?: string }>(`/api/mcp/${s.id}`, { method: "POST" });
                    if (!r.ok) throw new Error(r.error);
                    return t("lib.testResult", { name: s.name, count: r.tools?.length ?? 0 });
                  })
                }
              >
                {busy === `test-${s.id}` ? t("common.testing") : t("common.test")}
              </button>
              <button className="icon-btn sm" onClick={() => confirm(t("lib.confirmRemove", { name: s.name })) && void run(`rm-${s.id}`, async () => void (await api(`/api/mcp/${s.id}`, { method: "DELETE" })))} aria-label={t("lib.removeX", { name: s.name })} title={t("common.remove")}>
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
