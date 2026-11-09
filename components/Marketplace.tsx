"use client";

// Marketplace: connectors (MCP), skills and plugins (ready-made bot teams),
// each with "Yours" and "Discover", plus the bots' shared memory.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { CONNECTOR_CATEGORIES, CONNECTORS, PLUGINS, SKILLS, mergeById, type CatalogConnector, type CatalogField, type CatalogPlugin, type CatalogSkill, type ConnectorCategory } from "@/lib/catalog";
import { api, refreshSidebar } from "@/lib/client";
import { ANTHROPIC_LOGO, MCP_LOGO, OOVI_LOGO, githubOwnerLogo, logoFor } from "@/lib/logos";
import "@/lib/desktop";
import { FaceStack } from "./Face";
import { useI18n } from "./I18n";
import Icon from "./Icon";

type Tab = "connectors" | "skills" | "plugins" | "memory";
type View = "yours" | "discover";
type Skill = { slug: string; name: string; description: string; body: string; source?: string; uses: number };
type Server = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  enabled: boolean;
  trusted: boolean;
  status: "connected" | "error" | "idle";
  /** Sign-in connectors. */
  auth?: "oauth";
  signedIn?: boolean;
  error?: string;
  tools: { name: string; description?: string }[];
};
type RegField = { name: string; description?: string; required?: boolean; secret?: boolean };
type RegItem = {
  name: string;
  title?: string;
  description?: string;
  repo?: string;
  install: { transport: "stdio"; command: string; args: string[]; env: RegField[] } | { transport: "http"; url: string; headers: RegField[] };
};
type RemoteSkill = { id: string; name: string; description: string; url: string; by: string };
type Installed = { plugins: { id: string; groupId: string }[]; skills: string[]; node: boolean; catalog?: { connectors: CatalogConnector[]; skills: CatalogSkill[]; plugins: CatalogPlugin[] } };
type Mem = { user: string; memory: string; limits: { user: number; memory: number } };
type LessonView = { id: string; text: string; botName?: string; source: "reflection" | "feedback"; score: number; updatedAt: number };
type SkillDraft = { slug?: string; name: string; description: string; body: string };
type Custom = { name: string; transport: "stdio" | "http"; command: string; args: string; url: string; secrets: string };
type Msg = { ok: boolean; text: string; link?: { href: string; label: string } };

const parseArgs = (s: string) => [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");

/** A brand's logo on a white tile. Falls back to the MCP logo if the image can't load. */
function Logo({ src, size = 44 }: { src: string | undefined; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="mk-logo" style={{ width: size, height: size, borderRadius: Math.round(size * 0.27) }} aria-hidden>
      <img src={!failed && src ? src : MCP_LOGO} alt="" loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}

/** Logo for a skill: its publisher (oovi, Anthropic, or the GitHub owner it came from). */
function skillLogo(source: string | undefined): string {
  if (source && /github\.com\/anthropics\//i.test(source)) return ANTHROPIC_LOGO;
  return githubOwnerLogo(source) ?? OOVI_LOGO;
}

function regToConnector(r: RegItem): CatalogConnector {
  const short = (r.title || r.name.split("/").pop() || r.name).replace(/[-_]/g, " ").slice(0, 40);
  const by = r.name.split("/")[0] ?? "";
  if (r.install.transport === "stdio") {
    const fields: CatalogField[] = r.install.env.map((e) => ({ key: e.name, label: e.name, placeholder: e.description, secret: e.secret, to: "env", name: e.name }));
    return { id: r.name, name: short, by, description: r.description ?? "", category: "dev", transport: "stdio", command: r.install.command, args: r.install.args, needsNode: r.install.command === "npx", fields, docs: r.repo };
  }
  const fields: CatalogField[] = r.install.headers.map((h) => ({ key: h.name, label: h.name, placeholder: h.description, secret: h.secret, to: "header", name: h.name, template: "{value}" }));
  return { id: r.name, name: short, by, description: r.description ?? "", category: "dev", transport: "http", url: r.install.url, fields, docs: r.repo };
}

export default function Marketplace() {
  const { t, rich, tag } = useI18n();
  const [tab, setTab] = useState<Tab>("connectors");
  const [view, setView] = useState<View>("discover");
  const [q, setQ] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [inst, setInst] = useState<Installed>({ plugins: [], skills: [], node: true });
  const [remote, setRemote] = useState<RemoteSkill[] | null>(null);
  const [registry, setRegistry] = useState<RegItem[] | null>(null);
  const [installing, setInstalling] = useState<CatalogConnector | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<SkillDraft | null>(null);
  const [importUrl, setImportUrl] = useState<string | null>(null);
  const [custom, setCustom] = useState<Custom | null>(null);
  const [mem, setMem] = useState<Mem | null>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [cat, setCat] = useState<ConnectorCategory | "all">("all");
  const [waiting, setWaiting] = useState<{ id: string; name: string; authUrl: string; since: number } | null>(null);
  const [soonItem, setSoonItem] = useState<CatalogConnector | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("oovi.market") ?? "{}") as { tab?: Tab; view?: View };
      if (saved.tab) setTab(saved.tab);
      if (saved.view) setView(saved.view);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const pick = (nextTab: Tab, nextView: View = view) => {
    setTab(nextTab);
    setView(nextView);
    setQ("");
    setMenu(false);
    try {
      localStorage.setItem("oovi.market", JSON.stringify({ tab: nextTab, view: nextView }));
    } catch {
      /* storage unavailable */
    }
  };

  // Built-in catalog plus items published from the oovi admin console.
  const allConnectors = useMemo(() => mergeById(CONNECTORS, inst.catalog?.connectors ?? []), [inst.catalog]);
  const allSkills = useMemo(() => mergeById(SKILLS, inst.catalog?.skills ?? []), [inst.catalog]);
  const allPlugins = useMemo(() => mergeById(PLUGINS, inst.catalog?.plugins ?? []), [inst.catalog]);
  const [lessons, setLessons] = useState<LessonView[] | null>(null);
  const [learning, setLearning] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, m, c] = await Promise.all([api<Skill[]>("/api/skills"), api<Server[]>("/api/mcp"), api<Installed>("/api/catalog")]);
      setSkills(s);
      setServers(m);
      setInst(c);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === "memory" && !mem) api<Mem>("/api/memory").then(setMem).catch(() => {});
    if (tab === "memory" && !lessons) {
      api<{ lessons: LessonView[] }>("/api/lessons").then((r) => setLessons(r.lessons)).catch(() => setLessons([]));
      api<{ learning?: boolean }>("/api/settings").then((s) => setLearning(s.learning !== false)).catch(() => {});
    }
    if (tab === "skills" && view === "discover" && !remote)
      api<{ skills: RemoteSkill[] }>("/api/catalog?remote=anthropic")
        .then((r) => setRemote(r.skills))
        .catch(() => setRemote([]));
  }, [tab, view, mem, remote, lessons]);

  // Search the official MCP registry as you type (Connectors > Discover).
  useEffect(() => {
    if (tab !== "connectors" || view !== "discover" || q.trim().length < 2) {
      setRegistry(null);
      return;
    }
    const timer = setTimeout(() => {
      api<{ items: RegItem[] }>(`/api/mcp/registry?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setRegistry(r.items))
        .catch(() => setRegistry([]));
    }, 400);
    return () => clearTimeout(timer);
  }, [q, tab, view]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  async function run(key: string, fn: () => Promise<string | void | Omit<Msg, "ok">>) {
    setBusy(key);
    setMsg(null);
    try {
      const out = await fn();
      if (typeof out === "string" && out) setMsg({ ok: true, text: out });
      else if (out && typeof out === "object") setMsg({ ok: true, ...out });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  // ---------- connectors ----------
  const hasServer = (name: string) => servers.some((s) => s.name.toLowerCase() === name.toLowerCase());

  const addConnector = (c: CatalogConnector, vals: Record<string, string>) =>
    run(`add-${c.id}`, async () => {
      const fromCatalog = allConnectors.some((x) => x.id === c.id);
      const missing = (c.fields ?? []).filter((f) => !f.optional && !vals[f.key]?.trim()).map((f) => f.label);
      if (fromCatalog && missing.length) throw new Error(t("mk.fillIn", { fields: missing.join(", ") }));
      const env: Record<string, string> = {};
      const headers: Record<string, string> = {};
      for (const f of c.fields ?? []) {
        const v = (vals[f.key] ?? "").trim();
        if (!v) continue;
        if (f.to === "env" && f.name) env[f.name] = v;
        if (f.to === "header" && f.name) headers[f.name] = (f.template ?? "{value}").replace("{value}", v);
      }
      const args = (c.args ?? []).map((a) => a.replace(/\{(\w+)\}/g, (_, k: string) => (vals[k] ?? "").trim())).filter((a) => a !== "");
      const body = c.transport === "stdio" ? { name: c.name, transport: "stdio", command: c.command, args, env } : { name: c.name, transport: "http", url: c.url, headers };
      const { id } = await api<{ id: string }>("/api/mcp", { method: "POST", body: JSON.stringify(body) });
      setInstalling(null);
      const r = await api<{ ok: boolean; tools?: string[]; error?: string }>(`/api/mcp/${id}`, { method: "POST" });
      if (!r.ok) throw new Error(t("mk.addedButError", { name: c.name, error: r.error ?? "" }));
      return t("mk.connectorAdded", { name: c.name, count: r.tools?.length ?? 0 });
    });

  /** Open the service's sign-in page in the browser and wait for it to send the user back. */
  async function beginSignIn(id: string, name: string): Promise<Omit<Msg, "ok">> {
    const r = await api<{ authUrl?: string; ok?: boolean; tools?: string[]; error?: string }>(`/api/mcp/${id}/oauth`, { method: "POST" });
    if (r.authUrl) {
      window.open(r.authUrl, "_blank", "noopener,noreferrer");
      setWaiting({ id, name, authUrl: r.authUrl, since: Date.now() });
      return { text: t("mk.finishInBrowser", { name }), link: { href: r.authUrl, label: t("mk.openSignIn") } };
    }
    if (r.ok) return { text: t("mk.connectorAdded", { name, count: r.tools?.length ?? 0 }) };
    throw new Error(r.error ?? t("mk.signInFailed", { name }));
  }

  const signIn = (id: string, name: string) => run(`signin-${id}`, () => beginSignIn(id, name));

  const addOAuth = (c: CatalogConnector) =>
    run(`add-${c.id}`, async () => {
      let id = servers.find((s) => s.name.toLowerCase() === c.name.toLowerCase())?.id;
      if (!id) id = (await api<{ id: string }>("/api/mcp", { method: "POST", body: JSON.stringify({ name: c.name, transport: "http", url: c.url, auth: "oauth" }) })).id;
      return beginSignIn(id, c.name);
    });

  // While the user signs in in the browser, watch for the connector to come alive.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (Date.now() - waiting.since > 10 * 60 * 1000) {
        setWaiting(null);
        return;
      }
      api<Server[]>("/api/mcp")
        .then((list) => {
          setServers(list);
          const s = list.find((x) => x.id === waiting.id);
          if (s?.signedIn && s.status === "connected") {
            setWaiting(null);
            setMsg({ ok: true, text: t("mk.connectorAdded", { name: waiting.name, count: s.tools.length }) });
          }
        })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [waiting, t]);

  function startInstall(c: CatalogConnector) {
    setValues({});
    if (c.soon) return setSoonItem(c);
    if (c.oauth) return void addOAuth(c);
    if (!c.fields?.length && !(c.needsNode && !inst.node)) void addConnector(c, {});
    else setInstalling(c);
  }

  const addCustom = (c: Custom) =>
    run("custom", async () => {
      const kv: Record<string, string> = {};
      for (const line of c.secrets.split(/\r?\n/)) {
        const m = c.transport === "stdio" ? line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/) : line.match(/^\s*([\w.-]+)\s*:\s*(.*)$/);
        if (m?.[1]) kv[m[1]] = (m[2] ?? "").trim();
      }
      const body = c.transport === "stdio" ? { name: c.name, transport: "stdio", command: c.command, args: parseArgs(c.args), env: kv } : { name: c.name, transport: "http", url: c.url, headers: kv };
      const { id } = await api<{ id: string }>("/api/mcp", { method: "POST", body: JSON.stringify(body) });
      setCustom(null);
      const r = await api<{ ok: boolean; tools?: string[]; error?: string }>(`/api/mcp/${id}`, { method: "POST" });
      if (!r.ok) throw new Error(t("mk.addedButError", { name: c.name, error: r.error ?? "" }));
      return t("mk.connectorAdded", { name: c.name, count: r.tools?.length ?? 0 });
    });

  // ---------- skills ----------
  const skillHave = (name: string) => skills.some((s) => s.name.toLowerCase() === name.toLowerCase());
  const addCatalogSkill = (id: string, name: string) =>
    run(`sk-${id}`, async () => {
      await api("/api/catalog", { method: "POST", body: JSON.stringify({ kind: "skill", id }) });
      return t("lib.installedSkill", { name });
    });

  const saveSkill = (d: SkillDraft) =>
    run("skill", async () => {
      const body = JSON.stringify({ name: d.name, description: d.description, body: d.body });
      if (d.slug) await api(`/api/skills/${d.slug}`, { method: "PUT", body });
      else await api("/api/skills", { method: "POST", body });
      setEditing(null);
      return t("lib.skillSaved");
    });

  // ---------- plugins ----------
  const pluginGroup = (id: string) => inst.plugins.find((p) => p.id === id)?.groupId;
  const addPlugin = (p: CatalogPlugin) =>
    run(`pl-${p.id}`, async () => {
      const r = await api<{ groupId: string; bots: string[] }>("/api/catalog", { method: "POST", body: JSON.stringify({ kind: "plugin", id: p.id }) });
      refreshSidebar();
      return { text: t("mk.teamAdded", { name: p.name, bots: r.bots.join(", ") }), link: { href: `/c/${r.groupId}`, label: t("mk.openGroup", { name: p.group }) } };
    });

  // ---------- helpers ----------
  const ql = q.trim().toLowerCase();
  const match = (...xs: (string | undefined)[]) => !ql || xs.some((x) => (x ?? "").toLowerCase().includes(ql));

  const card = (key: string, avatar: React.ReactNode, title: React.ReactNode, desc: string, by: string, action: React.ReactNode, extra?: React.ReactNode) => (
    <div key={key} className="mk-card">
      {avatar}
      <div className="mk-card-main">
        <b>{title}</b>
        <p>{desc}</p>
        {extra}
        {by && <small>{t("mk.by", { by })}</small>}
      </div>
      <div className="mk-card-act">{action}</div>
    </div>
  );
  const plus = (onClick: () => void, label: string) => (
    <button className="mk-plus" onClick={onClick} disabled={!!busy} title={label} aria-label={label}>
      <Icon name="plus" size={16} />
    </button>
  );
  const done = (label: string) => (
    <span className="mk-done" title={label} aria-label={label}>
      <Icon name="check" size={16} />
    </span>
  );
  const verified = (on?: boolean) =>
    on ? (
      <span className="mk-verified" title={t("mk.verified")} aria-label={t("mk.verified")}>
        ✓
      </span>
    ) : null;

  const addMenu: { label: string; onClick?: () => void; href?: string }[] =
    tab === "connectors"
      ? [{ label: t("mk.customConnector"), onClick: () => setCustom({ name: "", transport: "http", command: "npx", args: "", url: "", secrets: "" }) }]
      : tab === "skills"
        ? [
            { label: t("mk.writeSkill"), onClick: () => setEditing({ name: "", description: "", body: "" }) },
            { label: t("mk.importSkill"), onClick: () => setImportUrl("") },
          ]
        : tab === "plugins"
          ? [{ label: t("mk.newBot"), href: "/bots/new" }]
          : [];

  // ---------- views ----------
  const shownConnectors = allConnectors.filter((c) => (cat === "all" || !!ql || c.category === cat) && match(c.name, c.description, c.by));
  const zapier = allConnectors.find((c) => c.id === "zapier")!;
  const connectorAction = (c: CatalogConnector) =>
    hasServer(c.name) ? (
      done(t("mk.added"))
    ) : c.soon ? (
      <button className="mk-soon" onClick={() => setSoonItem(c)}>
        {t("mk.soon")}
      </button>
    ) : (
      plus(() => startInstall(c), t("mk.addX", { name: c.name }))
    );
  const connectorExtra = (c: CatalogConnector) =>
    c.needsNode && !inst.node ? <span className="mk-warn">{t("mk.needsNode")}</span> : c.oauth ? <span className="mk-hint">{t("mk.oneClick")}</span> : undefined;

  const discoverConnectors = (
    <>
      {!ql && (
        <div className="mk-feature">
          <div>
            <small>{t("mk.featured")}</small>
            <h3>{t("mk.featureAppsTitle")}</h3>
            <p>{t("mk.featureApps")}</p>
            {hasServer(zapier.name) ? (
              done(t("mk.added"))
            ) : (
              <button className="btn" onClick={() => startInstall(zapier)} disabled={!!busy}>
                {t("mk.connectWith", { name: zapier.name })}
              </button>
            )}
          </div>
          <Logo src={logoFor("zapier")} size={84} />
        </div>
      )}
      {!ql && (
        <div className="mk-cats" role="tablist">
          {(["all", ...CONNECTOR_CATEGORIES] as const).map((k) => (
            <button key={k} role="tab" aria-selected={cat === k} className={cat === k ? "on" : ""} onClick={() => setCat(k)}>
              {t(`mk.cat.${k}`)}
            </button>
          ))}
        </div>
      )}
      <div className="mk-section-head">
        <h3>{ql ? t("mk.matches") : t("mk.topConnectors")}</h3>
        <span className="mk-count">{shownConnectors.length}</span>
      </div>
      <div className="mk-grid">
        {shownConnectors.map((c) =>
          card(
            c.id,
            <Logo src={c.logo ?? logoFor(c.id)} />,
            <>
              {c.name} {verified(c.verified)}
            </>,
            c.description,
            c.by,
            connectorAction(c),
            connectorExtra(c),
          ),
        )}
      </div>
      {ql.length >= 2 && (
        <>
          <div className="mk-section-head">
            <h3>{t("mk.registry")}</h3>
            {registry && <span className="mk-count">{registry.length}</span>}
          </div>
          {!registry ? (
            <p className="note">{t("lib.searching")}</p>
          ) : registry.length === 0 ? (
            <p className="note">{t("lib.nothingFound")}</p>
          ) : (
            <div className="mk-grid">
              {registry.slice(0, 30).map((r) => {
                const c = regToConnector(r);
                return card(r.name, <Logo src={githubOwnerLogo(r.repo)} />, c.name, c.description, c.by, hasServer(c.name) ? done(t("mk.added")) : plus(() => startInstall(c), t("mk.addX", { name: c.name })), <span className="mk-hint">{t("mk.unchecked")}</span>);
              })}
            </div>
          )}
        </>
      )}
      {!ql && <p className="note">{t("mk.searchHint")}</p>}
    </>
  );

  const yourConnectors = (
    <div className="mk-list">
      {servers.length === 0 && <p className="note">{t("mk.noConnectors")}</p>}
      {servers
        .filter((s) => match(s.name))
        .map((s) => (
          <div key={s.id} className="mk-row">
            <Logo src={logoFor(allConnectors.find((c) => c.name.toLowerCase() === s.name.toLowerCase())?.id ?? "") ?? MCP_LOGO} size={40} />
            <div className="mk-card-main">
              <b>
                <span className={`dot ${s.status === "connected" ? "ok" : s.status === "error" ? "err" : ""}`} /> {s.name}
              </b>
              <p>{s.auth === "oauth" && !s.signedIn ? t("mk.notSignedIn") : s.status === "error" ? s.error : s.tools.length ? t("mk.toolsCount", { count: s.tools.length }) : t("mk.notStarted")}</p>
              <div className="tags">
                <label className="mini-check">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => void run(`en-${s.id}`, async () => void (await api(`/api/mcp/${s.id}`, { method: "PUT", body: JSON.stringify({ enabled: e.target.checked }) })))} /> {t("lib.on")}
                </label>
                <label className="mini-check" title={t("lib.trustedTitle")}>
                  <input
                    type="checkbox"
                    checked={s.trusted}
                    onChange={(e) => {
                      if (e.target.checked && !confirm(t("lib.confirmTrust", { name: s.name }))) return;
                      void run(`tr-${s.id}`, async () => void (await api(`/api/mcp/${s.id}`, { method: "PUT", body: JSON.stringify({ trusted: e.target.checked }) })));
                    }}
                  />{" "}
                  {t("mk.alwaysAllow")}
                </label>
              </div>
            </div>
            <div className="mk-card-act">
              {s.auth === "oauth" && (!s.signedIn || s.status === "error") && (
                <button className="btn sm primary" disabled={!!busy} onClick={() => void signIn(s.id, s.name)}>
                  {s.signedIn ? t("mk.signInAgain") : t("mk.connect")}
                </button>
              )}
              <button
                className="btn sm"
                disabled={!!busy}
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
              <button
                className="icon-btn sm"
                onClick={() => {
                  if (confirm(t("lib.confirmRemove", { name: s.name }))) void run(`rm-${s.id}`, async () => void (await api(`/api/mcp/${s.id}`, { method: "DELETE" })));
                }}
                title={t("common.remove")}
                aria-label={t("common.remove")}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </div>
        ))}
      <p className="note">{t("mk.connectorsHowto")}</p>
    </div>
  );

  const featuredSkill = allSkills[0]!;
  const discoverSkills = (
    <>
      {!ql && (
        <div className="mk-feature">
          <div>
            <small>{t("mk.fromOovi")}</small>
            <h3>{featuredSkill.name}</h3>
            <p>{featuredSkill.description}</p>
            {skillHave(featuredSkill.name) ? (
              done(t("mk.added"))
            ) : (
              <button className="btn" onClick={() => void addCatalogSkill(featuredSkill.id, featuredSkill.name)}>
                {t("common.add")}
              </button>
            )}
          </div>
          <Logo src={OOVI_LOGO} size={84} />
        </div>
      )}
      <div className="mk-section-head">
        <h3>{t("mk.ooviSkills")}</h3>
        <span className="mk-count">{allSkills.length}</span>
      </div>
      <div className="mk-grid">
        {allSkills.filter((s) => match(s.name, s.description)).map((s) =>
          card(s.id, <Logo src={OOVI_LOGO} />, s.name, s.description, "oovi", skillHave(s.name) ? done(t("mk.added")) : plus(() => void addCatalogSkill(s.id, s.name), t("mk.addX", { name: s.name }))),
        )}
      </div>
      <div className="mk-section-head">
        <h3>{t("mk.anthropicSkills")}</h3>
        {remote && <span className="mk-count">{remote.length}</span>}
      </div>
      {!remote ? (
        <p className="note">{t("common.loading")}</p>
      ) : remote.length === 0 ? (
        <p className="note">{t("mk.cantLoadRemote")}</p>
      ) : (
        <div className="mk-grid">
          {remote
            .filter((s) => match(s.name, s.description))
            .map((s) =>
              card(
                s.id,
                <Logo src={ANTHROPIC_LOGO} />,
                <>
                  {s.name} {verified(true)}
                </>,
                s.description,
                s.by,
                skillHave(s.name)
                  ? done(t("mk.added"))
                  : plus(
                      () =>
                        void run(`rs-${s.id}`, async () => {
                          const k = await api<Skill>("/api/skills", { method: "POST", body: JSON.stringify({ url: s.url }) });
                          return t("lib.installedSkill", { name: k.name });
                        }),
                      t("mk.addX", { name: s.name }),
                    ),
              ),
            )}
        </div>
      )}
    </>
  );

  const yourSkills = (
    <div className="mk-list">
      {skills.length === 0 && <p className="note">{t("lib.noSkills")}</p>}
      {skills
        .filter((s) => match(s.name, s.description))
        .map((s) => (
          <div key={s.slug} className="mk-row">
            <Logo src={skillLogo(s.source)} size={40} />
            <div className="mk-card-main">
              <b>{s.name}</b>
              <p>{s.description}</p>
              <div className="tags">
                <span className="tag">{t("lib.used", { n: s.uses })}</span>
                {s.source === "learned" && <span className="tag ok">{t("lib.learned")}</span>}
              </div>
            </div>
            <div className="mk-card-act">
              <button className="icon-btn sm" onClick={() => setEditing({ slug: s.slug, name: s.name, description: s.description, body: s.body })} title={t("common.edit")} aria-label={t("lib.editX", { name: s.name })}>
                <Icon name="edit" size={16} />
              </button>
              <button
                className="icon-btn sm"
                onClick={() => {
                  if (confirm(t("lib.confirmDeleteSkill", { name: s.name }))) void run(`del-${s.slug}`, async () => void (await api(`/api/skills/${s.slug}`, { method: "DELETE" })));
                }}
                title={t("common.delete")}
                aria-label={t("lib.deleteX", { name: s.name })}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </div>
        ))}
      <p className="note">{rich("lib.skillsIntro", { learn: <b>{t("lib.learn")}</b>, format: <code>SKILL.md</code> })}</p>
    </div>
  );

  const pluginCard = (p: CatalogPlugin) => {
    const gid = pluginGroup(p.id);
    return card(
      p.id,
      <span className="mk-faces">
        <FaceStack faces={p.bots.map((b) => b.face)} size={52} />
      </span>,
      p.name,
      p.description,
      "oovi",
      gid ? (
        <Link className="btn sm" href={`/c/${gid}`}>
          {t("mk.open")}
        </Link>
      ) : (
        <button className="btn sm primary" disabled={!!busy} onClick={() => void addPlugin(p)}>
          {busy === `pl-${p.id}` ? t("common.loading") : t("mk.addTeam")}
        </button>
      ),
      <>
        <div className="mk-team">
          {p.bots.map((b) => (
            <span key={b.name} className="tag">
              {b.name} · {b.role}
            </span>
          ))}
        </div>
        {p.usesFolder && <span className="mk-hint">{t("mk.usesFolder")}</span>}
      </>,
    );
  };

  const featuredPlugin = allPlugins[0]!;
  const discoverPlugins = (
    <>
      {!ql && (
        <div className="mk-feature">
          <div>
            <small>{t("mk.featured")}</small>
            <h3>{featuredPlugin.name}</h3>
            <p>{featuredPlugin.description}</p>
            {pluginGroup(featuredPlugin.id) ? (
              <Link className="btn" href={`/c/${pluginGroup(featuredPlugin.id)}`}>
                {t("mk.open")}
              </Link>
            ) : (
              <button className="btn" disabled={!!busy} onClick={() => void addPlugin(featuredPlugin)}>
                {t("mk.addTeam")}
              </button>
            )}
          </div>
          <FaceStack faces={featuredPlugin.bots.map((b) => b.face)} size={96} />
        </div>
      )}
      <div className="mk-section-head">
        <h3>{t("mk.teams")}</h3>
        <span className="mk-count">{allPlugins.length}</span>
      </div>
      <div className="mk-grid">{allPlugins.filter((p) => match(p.name, p.description)).map(pluginCard)}</div>
    </>
  );

  const yourPlugins = (
    <div className="mk-list">
      {inst.plugins.length === 0 && <p className="note">{t("mk.noTeams")}</p>}
      {inst.plugins.map((ip) => {
        const p = allPlugins.find((x) => x.id === ip.id);
        if (!p) return null;
        return (
          <div key={ip.id} className="mk-row">
            <span className="mk-faces">
              <FaceStack faces={p.bots.map((b) => b.face)} size={44} />
            </span>
            <div className="mk-card-main">
              <b>{p.name}</b>
              <p>{p.description}</p>
            </div>
            <div className="mk-card-act">
              <Link className="btn sm" href={`/c/${ip.groupId}`}>
                {t("mk.open")}
              </Link>
              <button
                className="icon-btn sm"
                title={t("common.remove")}
                aria-label={t("common.remove")}
                onClick={() => {
                  if (!confirm(t("mk.confirmRemoveTeam", { name: p.name }))) return;
                  void run(`rmp-${p.id}`, async () => {
                    await fetch(`/api/catalog?plugin=${encodeURIComponent(p.id)}`, { method: "DELETE" });
                    refreshSidebar();
                    return t("mk.teamRemoved", { name: p.name });
                  });
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const lessonsCard = (
    <div className="card">
      <h3>{t("lib.lessons")}</h3>
      <p className="muted">{t("lib.lessonsIntro")}</p>
      {learning !== null && (
        <label className="check">
          <input
            type="checkbox"
            checked={learning}
            onChange={(e) => {
              const on = e.target.checked;
              setLearning(on);
              api("/api/settings", { method: "POST", body: JSON.stringify({ learning: on }) }).catch((x: Error) => setMsg({ ok: false, text: x.message }));
            }}
          />
          <span>{t("lib.learnToggle")}</span>
        </label>
      )}
      {lessons === null ? (
        <p className="note">{t("common.loading")}</p>
      ) : lessons.length === 0 ? (
        <p className="note">{t("lib.lessonsEmpty")}</p>
      ) : (
        <ul className="lessons">
          {lessons.map((l) => (
            <li key={l.id}>
              <div>
                <span>{l.text}</span>
                <small>
                  {[l.botName ? t("lib.byBot", { name: l.botName }) : "", l.source === "feedback" ? t("lib.fromFeedback") : "", new Date(l.updatedAt).toLocaleDateString(tag)].filter(Boolean).join(" · ")}
                </small>
              </div>
              <button
                className="btn sm"
                disabled={!!busy}
                onClick={() =>
                  void run(`lesson-${l.id}`, async () => {
                    setLessons((await api<{ lessons: LessonView[] }>(`/api/lessons?id=${encodeURIComponent(l.id)}`, { method: "DELETE" })).lessons);
                  })
                }
              >
                {t("lib.forget")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const memoryView = (
    <>
    <div className="card">
      <p className="muted">{rich("lib.memoryIntro", { about: <b>{t("lib.memoryAbout")}</b>, notes: <b>{t("lib.memoryNotes")}</b>, sep: <code>§</code> })}</p>
      {mem ? (
        <div className="grid">
          {(["user", "memory"] as const).map((k) => (
            <label key={k} className="field">
              {k === "user" ? t("lib.userLabel") : t("lib.memLabel")}
              <textarea rows={10} className="mono" value={mem[k]} onChange={(e) => setMem({ ...mem, [k]: e.target.value })} placeholder={k === "user" ? t("lib.userPh") : t("lib.memPh")} />
              <span className={`hint${mem[k].length > mem.limits[k] ? " msg-err" : ""}`}>{t("lib.chars", { n: mem[k].length, max: mem.limits[k] })}</span>
              <button
                className="btn sm"
                style={{ alignSelf: "flex-start" }}
                disabled={!!busy || mem[k].length > mem.limits[k]}
                onClick={() =>
                  void run(`mem-${k}`, async () => {
                    setMem(await api<Mem>("/api/memory", { method: "PUT", body: JSON.stringify({ target: k, text: mem[k] }) }));
                    return t("lib.memorySaved");
                  })
                }
              >
                {t("common.save")}
              </button>
            </label>
          ))}
        </div>
      ) : (
        <p className="note">{t("common.loading")}</p>
      )}
    </div>
    {lessonsCard}
    </>
  );

  const views: Record<Exclude<Tab, "memory">, Record<View, React.ReactNode>> = {
    connectors: { discover: discoverConnectors, yours: yourConnectors },
    skills: { discover: discoverSkills, yours: yourSkills },
    plugins: { discover: discoverPlugins, yours: yourPlugins },
  };
  const counts: Record<Exclude<Tab, "memory">, number> = { connectors: servers.length, skills: skills.length, plugins: inst.plugins.length };

  return (
    <main className="settings market">
      <h1>{t("mk.title")}</h1>
      <p className="lead">{t("mk.lead")}</p>

      <div className="mk-top">
        <div className="mk-tabs" role="tablist">
          {(["connectors", "skills", "plugins", "memory"] as Tab[]).map((x) => (
            <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? "on" : ""} onClick={() => pick(x)}>
              {t(`mk.tab.${x}`)}
            </button>
          ))}
        </div>
        {tab !== "memory" && (
          <div className="seg-tabs">
            <button className={view === "yours" ? "on" : ""} onClick={() => pick(tab, "yours")}>
              {t("mk.yours")}
              {counts[tab] > 0 && <span className="mk-count sm">{counts[tab]}</span>}
            </button>
            <button className={view === "discover" ? "on" : ""} onClick={() => pick(tab, "discover")}>
              {t("mk.discover")}
            </button>
          </div>
        )}
      </div>

      {tab !== "memory" && (
        <div className="mk-bar">
          <label className="mk-search">
            <Icon name="zoomIn" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("mk.search")} aria-label={t("mk.search")} />
          </label>
          {addMenu.length > 0 && (
            <div className="mk-menu" ref={menuRef}>
              <button className="btn" onClick={() => setMenu(!menu)} aria-expanded={menu}>
                <Icon name="plus" size={16} /> {t("common.add")}
              </button>
              {menu && (
                <div className="mk-menu-pop" role="menu">
                  {addMenu.map((m) =>
                    m.href ? (
                      <Link key={m.label} role="menuitem" href={m.href} onClick={() => setMenu(false)}>
                        {m.label}
                      </Link>
                    ) : (
                      <button
                        key={m.label}
                        role="menuitem"
                        onClick={() => {
                          setMenu(false);
                          m.onClick?.();
                        }}
                      >
                        {m.label}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {waiting && tab === "connectors" && (
        <div className="notice mk-waiting" role="status">
          <span className="mk-spin" aria-hidden />
          <span>{t("mk.waitingFor", { name: waiting.name })}</span>
          <a className="btn sm" href={waiting.authUrl} target="_blank" rel="noreferrer noopener">
            {t("mk.openSignIn")}
          </a>
          <button className="btn sm" onClick={() => setWaiting(null)}>
            {t("common.cancel")}
          </button>
        </div>
      )}

      {tab === "memory" ? memoryView : views[tab][view]}

      {soonItem && (
        <div className="mk-modal" role="dialog" aria-modal="true" aria-label={soonItem.name} onMouseDown={(e) => e.target === e.currentTarget && setSoonItem(null)}>
          <div className="mk-sheet">
            <div className="mk-sheet-head">
              <Logo src={soonItem.logo ?? logoFor(soonItem.id)} />
              <div>
                <h3>{soonItem.name}</h3>
                <p className="note">{soonItem.description}</p>
              </div>
            </div>
            <p>{soonItem.soon}</p>
            <div className="row-btns">
              {(["zapier", "pipedream"] as const).map((gid) => {
                const g = allConnectors.find((c) => c.id === gid)!;
                return hasServer(g.name) ? (
                  <span key={gid} className="tag ok">
                    {t("mk.alreadyConnected", { name: g.name })}
                  </span>
                ) : (
                  <button
                    key={gid}
                    className={`btn${gid === "zapier" ? " primary" : ""}`}
                    disabled={!!busy}
                    onClick={() => {
                      setSoonItem(null);
                      startInstall(g);
                    }}
                  >
                    {t("mk.connectWith", { name: g.name })}
                  </button>
                );
              })}
              <button className="btn" onClick={() => setSoonItem(null)}>
                {t("mk.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- install a connector ---- */}
      {installing && (
        <div className="mk-modal" role="dialog" aria-modal="true" aria-label={installing.name} onMouseDown={(e) => e.target === e.currentTarget && setInstalling(null)}>
          <div className="mk-sheet">
            <div className="mk-sheet-head">
              <Logo src={installing.logo ?? logoFor(installing.id) ?? githubOwnerLogo(installing.docs)} />
              <div>
                <h3>
                  {installing.name} {verified(installing.verified)}
                </h3>
                <p className="note">{installing.description}</p>
              </div>
            </div>
            {installing.needsNode && !inst.node && (
              <div className="notice small">
                {t("mk.nodeMissing")}{" "}
                <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer noopener">
                  nodejs.org
                </a>
              </div>
            )}
            {(installing.fields ?? []).map((f) => (
              <label key={f.key} className="field">
                <span>
                  {f.label}{" "}
                  {f.help && (
                    <a href={f.help} target="_blank" rel="noreferrer noopener">
                      {t("mk.getIt")}
                    </a>
                  )}
                </span>
                <span className="mk-field-row">
                  <input type={f.secret ? "password" : "text"} autoComplete="off" value={values[f.key] ?? ""} placeholder={f.placeholder ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                  {f.folder && typeof window !== "undefined" && window.oovi?.pickFolder && (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() =>
                        void window.oovi?.pickFolder(values[f.key]).then((p) => {
                          if (p) setValues((v) => ({ ...v, [f.key]: p }));
                        })
                      }
                    >
                      {t("folder.choose")}
                    </button>
                  )}
                </span>
              </label>
            ))}
            <p className="note">{t("mk.secretsNote")}</p>
            <div className="row-btns">
              <button className="btn primary" disabled={!!busy} onClick={() => void addConnector(installing, values)}>
                {busy?.startsWith("add-") ? t("lib.connecting") : t("mk.connect")}
              </button>
              <button className="btn" onClick={() => setInstalling(null)}>
                {t("common.cancel")}
              </button>
              {installing.docs && (
                <a className="link-btn" href={installing.docs} target="_blank" rel="noreferrer noopener">
                  {t("mk.docs")}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- custom connector ---- */}
      {custom && (
        <div className="mk-modal" role="dialog" aria-modal="true" aria-label={t("mk.customConnector")} onMouseDown={(e) => e.target === e.currentTarget && setCustom(null)}>
          <div className="mk-sheet">
            <h3>{t("mk.customConnector")}</h3>
            <p className="note">{t("lib.mcpIntro")}</p>
            <div className="grid">
              <label className="field">
                {t("common.name")}
                <input value={custom.name} maxLength={40} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
              </label>
              <label className="field">
                {t("lib.kind")}
                <select value={custom.transport} onChange={(e) => setCustom({ ...custom, transport: e.target.value as Custom["transport"] })}>
                  <option value="http">{t("lib.kindHttp")}</option>
                  <option value="stdio">{t("lib.kindStdio")}</option>
                </select>
              </label>
              {custom.transport === "stdio" ? (
                <>
                  <label className="field">
                    {t("lib.command")}
                    <input value={custom.command} placeholder="npx" onChange={(e) => setCustom({ ...custom, command: e.target.value })} />
                  </label>
                  <label className="field">
                    {t("lib.args")}
                    <input value={custom.args} placeholder="-y @scope/server-name" onChange={(e) => setCustom({ ...custom, args: e.target.value })} />
                  </label>
                </>
              ) : (
                <label className="field full">
                  {t("lib.url")}
                  <input value={custom.url} placeholder="https://…/mcp" onChange={(e) => setCustom({ ...custom, url: e.target.value })} />
                </label>
              )}
              <label className="field full">
                {custom.transport === "stdio" ? t("lib.extraEnv") : t("lib.extraHeaders")}
                <textarea rows={2} className="mono" value={custom.secrets} onChange={(e) => setCustom({ ...custom, secrets: e.target.value })} />
              </label>
            </div>
            <p className="note">{t("mk.secretsNote")}</p>
            <div className="row-btns">
              <button className="btn primary" disabled={!!busy || !custom.name.trim() || (custom.transport === "stdio" ? !custom.command.trim() : !custom.url.trim())} onClick={() => void addCustom(custom)}>
                {busy === "custom" ? t("lib.connecting") : t("mk.connect")}
              </button>
              <button className="btn" onClick={() => setCustom(null)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- write / edit a skill ---- */}
      {editing && (
        <div className="mk-modal" role="dialog" aria-modal="true" aria-label={t("mk.writeSkill")} onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="mk-sheet wide">
            <h3>{editing.slug ? editing.name : t("mk.writeSkill")}</h3>
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
              <textarea rows={12} className="mono" value={editing.body} placeholder={t("lib.bodyPh")} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            </label>
            <div className="row-btns">
              <button className="btn primary" onClick={() => void saveSkill(editing)} disabled={!!busy || !editing.name.trim() || !editing.description.trim() || !editing.body.trim()}>
                {t("lib.saveSkill")}
              </button>
              <button className="btn" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- import a skill from a link ---- */}
      {importUrl !== null && (
        <div className="mk-modal" role="dialog" aria-modal="true" aria-label={t("mk.importSkill")} onMouseDown={(e) => e.target === e.currentTarget && setImportUrl(null)}>
          <div className="mk-sheet">
            <h3>{t("mk.importSkill")}</h3>
            <label className="field">
              {t("lib.installFrom")}
              <input value={importUrl} placeholder="https://github.com/owner/repo/tree/main/skills/my-skill" onChange={(e) => setImportUrl(e.target.value)} />
            </label>
            <div className="row-btns">
              <button
                className="btn primary"
                disabled={!!busy || !importUrl.trim()}
                onClick={() =>
                  void run("import", async () => {
                    const s = await api<Skill>("/api/skills", { method: "POST", body: JSON.stringify({ url: importUrl }) });
                    setImportUrl(null);
                    return t("lib.installedSkill", { name: s.name });
                  })
                }
              >
                {busy === "import" ? t("lib.installing") : t("lib.install")}
              </button>
              <button className="btn" onClick={() => setImportUrl(null)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && (
        <div className={`notice${msg.ok ? "" : " error"} mk-toast`} role="status">
          <span>
            {msg.text}{" "}
            {msg.link &&
              (/^https?:/.test(msg.link.href) ? (
                <a href={msg.link.href} className="text-link" target="_blank" rel="noreferrer noopener">
                  {msg.link.label}
                </a>
              ) : (
                <Link href={msg.link.href} className="text-link">
                  {msg.link.label}
                </Link>
              ))}
          </span>
          <button className="icon-btn sm" onClick={() => setMsg(null)} aria-label={t("mk.close")}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </main>
  );
}
