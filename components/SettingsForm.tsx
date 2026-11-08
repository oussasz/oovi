"use client";

import { useCallback, useEffect, useState } from "react";
import { PROVIDER_IDS, PROVIDERS, providerName, type ProviderId } from "@/lib/providers-meta";
import type { ModelRef, PublicSettings, SettingsPatch } from "@/lib/settings";
import { resizeImage } from "@/lib/client";
import { LOCALES, NATIVE_NAMES, type Locale } from "@/lib/i18n";
import { announceLanguage, useI18n } from "./I18n";
import Icon, { type IconName } from "./Icon";

type Draft = { apiKey: string; model: string; baseUrl: string };
type ModelInfo = { id: string; name?: string; free?: boolean; tools?: boolean; context?: number };
type Accounts = { signInOpen: boolean; sites: string[]; updatedAt?: number };
type Tab = "profile" | "models" | "free" | "accounts" | "search" | "browser" | "safety" | "language" | "data" | "about";
type Account = { loggedIn: boolean; cloudUrl: string; appVersion?: string; user: { email: string; name: string; image: string | null } | null };

/** "Français (French)": the language's own name, plus its name in the UI language when different. */
function languageLabel(id: Locale, uiTag: string): string {
  const native = NATIVE_NAMES[id];
  let local = "";
  try {
    local = new Intl.DisplayNames(uiTag, { type: "language" }).of(id) ?? "";
  } catch {
    /* Intl.DisplayNames unavailable */
  }
  return local && local.toLowerCase() !== native.toLowerCase() ? `${native} (${local})` : native;
}

// Labels and hints come from the dictionary: settings.tab.<id> and settings.tab.<id>.hint.
const TABS: { id: Tab; icon: IconName }[] = [
  { id: "profile", icon: "user" },
  { id: "models", icon: "cpu" },
  { id: "free", icon: "spark" },
  { id: "accounts", icon: "globe" },
  { id: "search", icon: "zoomIn" },
  { id: "browser", icon: "cursor" },
  { id: "safety", icon: "shield" },
  { id: "language", icon: "lang" },
  { id: "data", icon: "box" },
  { id: "about", icon: "info" },
];

const sameRef = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.model === b.model;

export default function SettingsForm() {
  const [s, setS] = useState<PublicSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<ProviderId, Draft> | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [searchKeys, setSearchKeys] = useState({ brave: "", tavily: "" });
  const [models, setModels] = useState<Partial<Record<ProviderId, ModelInfo[]>>>({});
  const [loading, setLoading] = useState<ProviderId | "free" | null>(null);
  const [fb, setFb] = useState<ModelRef>({ provider: "openrouter", model: "" });
  const [acc, setAcc] = useState<Accounts | null>(null);
  const [accBusy, setAccBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("profile");
  const [open, setOpen] = useState<Set<ProviderId>>(new Set());
  const [account, setAccount] = useState<Account | null>(null);
  const [profile, setProfile] = useState<{ name: string; image: string | null }>({ name: "", image: null });
  const { t, rich, tag } = useI18n();

  useEffect(() => {
    fetch("/api/account")
      .then((r) => r.json())
      .then((a: Account) => {
        setAccount(a);
        setProfile({ name: a.user?.name ?? "", image: a.user?.image ?? null });
      })
      .catch(() => {});
  }, []);

  async function saveProfile() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/account", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) });
      const j = (await r.json()) as Account & { error?: string };
      if (!r.ok) throw new Error(j.error);
      setAccount(j);
      setMsg({ ok: true, text: t("settings.msg.profileSaved") });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || t("settings.msg.cantSave") });
    } finally {
      setSaving(false);
    }
  }

  async function signOutAccount() {
    if (!confirm(t("settings.confirm.signOutAccount"))) return;
    await fetch("/api/account", { method: "DELETE" });
    location.href = "/";
  }

  async function importBackup(file: File) {
    setMsg(null);
    try {
      const r = await fetch("/api/backup", { method: "POST", headers: { "content-type": "application/json" }, body: await file.text() });
      const j = (await r.json()) as { bots?: number; chats?: number; skills?: number; error?: string };
      if (!r.ok) throw new Error(j.error);
      setMsg({ ok: true, text: t("settings.msg.restored", { bots: j.bots ?? 0, chats: j.chats ?? 0, skills: j.skills ?? 0 }) });
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || t("settings.msg.cantRestore") });
    }
  }

  function apply(next: PublicSettings) {
    setS(next);
    setDrafts(Object.fromEntries(PROVIDER_IDS.map((id) => [id, { apiKey: "", model: next.providers[id]?.model ?? "", baseUrl: next.providers[id]?.baseUrl ?? "" }])) as Record<ProviderId, Draft>);
  }

  const loadAcc = useCallback(async () => {
    try {
      setAcc((await fetch("/api/accounts").then((r) => r.json())) as Accounts);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((next: PublicSettings) => {
        apply(next);
        setOpen(new Set([next.active]));
      })
      .catch((e) => setMsg({ ok: false, text: String(e) }));
    void loadAcc();
    try {
      const saved = localStorage.getItem("oovi.settings.tab") as Tab | null;
      if (saved && TABS.some((t) => t.id === saved)) setTab(saved);
    } catch {
      /* storage unavailable */
    }
  }, [loadAcc]);

  useEffect(() => {
    if (!acc?.signInOpen) return;
    const t = setInterval(() => void loadAcc(), 2500);
    return () => clearInterval(t);
  }, [acc?.signInOpen, loadAcc]);

  function pickTab(t: Tab) {
    setTab(t);
    setMsg(null);
    try {
      localStorage.setItem("oovi.settings.tab", t);
    } catch {
      /* storage unavailable */
    }
  }

  async function post(patch: SettingsPatch) {
    const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error(await r.text());
    const next = (await r.json()) as PublicSettings;
    apply(next);
    return next;
  }

  async function save(quiet = false): Promise<boolean> {
    if (!s || !drafts) return false;
    setSaving(true);
    if (!quiet) setMsg(null);
    try {
      const next = await post({
        active: s.active,
        providers: Object.fromEntries(PROVIDER_IDS.map((id) => [id, { apiKey: drafts[id].apiKey || undefined, model: drafts[id].model, baseUrl: drafts[id].baseUrl }])),
        fallbacks: s.fallbacks,
        search: { provider: s.search.provider, searxngUrl: s.search.searxngUrl, braveKey: searchKeys.brave || undefined, tavilyKey: searchKeys.tavily || undefined },
        browser: s.browser,
        approvals: s.approvals,
        maxSteps: s.maxSteps,
        maxTurns: s.maxTurns,
        language: s.language,
        crashReports: s.crashReports,
      });
      setSearchKeys({ brave: "", tavily: "" });
      announceLanguage(next.language ?? "auto"); // switch the UI language right away
      if (!quiet) setMsg({ ok: true, text: t("common.saved") });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!(await save())) return;
    setMsg({ ok: true, text: t("common.testing") });
    const r = (await fetch("/api/settings/test", { method: "POST" }).then((x) => x.json())) as { ok: boolean; provider: string; reply?: string; ms?: number; error?: string; model?: string };
    setMsg(r.ok ? { ok: true, text: t("settings.msg.answered", { model: r.model ?? r.provider, reply: r.reply ?? "", ms: r.ms ?? 0 }) } : { ok: false, text: r.error ?? t("settings.msg.failed") });
  }

  async function removeKey(id: ProviderId) {
    try {
      await post({ providers: { [id]: { clearKey: true } } });
      setMsg({ ok: true, text: t("settings.msg.keyRemoved", { provider: PROVIDERS[id].label }) });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function fetchModels(id: ProviderId): Promise<ModelInfo[]> {
    const r = await fetch(`/api/models?provider=${id}`);
    const j = (await r.json()) as { models?: ModelInfo[]; error?: string };
    if (!r.ok || !j.models) throw new Error(j.error ?? t("settings.msg.cantLoadModels"));
    setModels((m) => ({ ...m, [id]: j.models }));
    return j.models;
  }

  async function loadModels(id: ProviderId) {
    if (!(await save(true))) return;
    setLoading(id);
    try {
      const list = await fetchModels(id);
      const free = list.filter((m) => m.free).length;
      setMsg({ ok: true, text: free ? t("settings.msg.modelsLoadedFree", { provider: providerName(id), count: list.length, free }) : t("settings.msg.modelsLoaded", { provider: providerName(id), count: list.length }) });
    } catch (e) {
      setMsg({ ok: false, text: `${providerName(id)}: ${(e as Error).message}` });
    } finally {
      setLoading(null);
    }
  }

  /** One click: pick free Gemini + OpenRouter models as the main model and backups. */
  async function setupFree() {
    if (!s || !(await save(true))) return;
    const gem = !!s.providers.gemini?.hasKey;
    const or = !!s.providers.openrouter?.hasKey;
    if (!gem && !or) {
      setMsg({ ok: false, text: t("settings.msg.needFreeKey") });
      return;
    }
    setLoading("free");
    try {
      const picks: ModelRef[] = [];
      const problems: string[] = [];
      if (gem) {
        try {
          const list = (await fetchModels("gemini")).filter((m) => /flash/.test(m.id) && !/preview|exp|thinking|8b/.test(m.id)).sort((a, b) => b.id.localeCompare(a.id));
          for (const m of list.slice(0, 2)) picks.push({ provider: "gemini", model: m.id });
        } catch (e) {
          problems.push(`Gemini: ${(e as Error).message}`);
        }
      }
      if (or) {
        try {
          const list = (await fetchModels("openrouter")).filter((m) => m.free && m.tools).sort((a, b) => (b.context ?? 0) - (a.context ?? 0));
          for (const m of list.slice(0, 4)) picks.push({ provider: "openrouter", model: m.id });
        } catch (e) {
          problems.push(`OpenRouter: ${(e as Error).message}`);
        }
      }
      if (!picks.length) throw new Error(problems.join(" ") || t("settings.msg.noFreeModels"));
      const activeReady = !PROVIDERS[s.active].needsKey || !!s.providers[s.active]?.hasKey;
      const main = activeReady ? undefined : picks.shift();
      const fallbacks = [...picks, ...s.fallbacks].filter((r, i, all) => all.findIndex((x) => sameRef(x, r)) === i).slice(0, 12);
      await post({ ...(main ? { active: main.provider, providers: { [main.provider]: { model: main.model } } } : {}), fallbacks });
      const backups = t("settings.msg.freeBackups", { count: picks.length });
      const done = main ? t("settings.msg.freeDoneMain", { main: `${providerName(main.provider)} · ${main.model}`, backups }) : t("settings.msg.freeDone", { backups });
      setMsg({ ok: true, text: `${done}${problems.length ? ` (${problems.join(" ")})` : ""}` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(null);
    }
  }

  async function openSignIn() {
    setAccBusy(true);
    try {
      const r = await fetch("/api/accounts", { method: "POST" });
      const j = (await r.json()) as Accounts & { error?: string };
      if (!r.ok) throw new Error(j.error);
      setAcc(j);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setAccBusy(false);
    }
  }

  async function signOut() {
    if (!confirm(t("settings.confirm.signOutSites"))) return;
    setAccBusy(true);
    try {
      setAcc((await fetch("/api/accounts", { method: "DELETE" }).then((r) => r.json())) as Accounts);
      setMsg({ ok: true, text: t("settings.msg.signedOutAll") });
    } finally {
      setAccBusy(false);
    }
  }

  if (!s || !drafts) return <main className="settings">{msg ? <p className="msg-err">{msg.text}</p> : t("common.loading")}</main>;

  const setDraft = (id: ProviderId, patch: Partial<Draft>) => setDrafts({ ...drafts, [id]: { ...drafts[id], ...patch } });
  const primary: ModelRef = { provider: s.active, model: drafts[s.active].model || PROVIDERS[s.active].model || t("settings.noModel") };
  const setFallbacks = (fallbacks: ModelRef[]) => setS({ ...s, fallbacks });
  const move = (i: number, d: number) => {
    const next = [...s.fallbacks];
    const [x] = next.splice(i, 1);
    if (x) next.splice(Math.max(0, Math.min(next.length, i + d)), 0, x);
    setFallbacks(next);
  };
  const toggleCard = (id: ProviderId) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]!;

  // ---------- sections ----------

  const modelsSection = (
    <>
      <p className="lead">{t("settings.models.lead")}</p>
      {PROVIDER_IDS.map((id) => {
        const meta = PROVIDERS[id];
        const pub = s.providers[id];
        const d = drafts[id];
        const list = models[id];
        const isOpen = open.has(id);
        return (
          <div key={id} className={`card collapsible${s.active === id ? " active" : ""}${isOpen ? " open" : ""}`}>
            <div className="card-head">
              <label onClick={(e) => e.stopPropagation()}>
                <input type="radio" name="active" checked={s.active === id} onChange={() => setS({ ...s, active: id })} aria-label={t("settings.models.useAsMain", { provider: meta.label })} />
              </label>
              <button type="button" className="card-toggle" onClick={() => toggleCard(id)} aria-expanded={isOpen}>
                <span className="card-title">{meta.label}</span>
                <span className="card-sub">{d.model || meta.model}</span>
                <span className="spacer" />
                {meta.free && <span className="badge ok">{t("settings.models.freeTier")}</span>}
                {meta.needsKey ? pub?.hasKey ? <span className="badge ok">{t("settings.models.keySaved", { hint: pub.keyHint ?? "" })}</span> : <span className="badge">{t("settings.models.noKey")}</span> : <span className="badge">{t("settings.models.noKeyNeeded")}</span>}
                <Icon name="chevron" size={16} className="chev" />
              </button>
            </div>
            {isOpen && (
              <div className="card-body">
                {meta.note && <p className="note">{meta.note}</p>}
                <div className="grid">
                  <label className="field full">
                    {t("common.apiKey")} {meta.keyUrl && <a href={meta.keyUrl} target="_blank" rel="noreferrer noopener">{t("common.getOne")}</a>}
                    <input type="password" autoComplete="off" value={d.apiKey} placeholder={pub?.hasKey ? t("settings.models.keyPlaceholderSaved") : meta.needsKey ? t("common.pasteKey") : t("settings.models.optional")} onChange={(e) => setDraft(id, { apiKey: e.target.value })} />
                  </label>
                  <label className="field">
                    {t("common.model")}{" "}
                    {list && (
                      <span className="hint">
                        {list.some((m) => m.free) ? t("settings.models.availableFree", { count: list.length, free: list.filter((m) => m.free).length }) : t("settings.models.available", { count: list.length })}
                      </span>
                    )}
                    <input list={`models-${id}`} value={d.model} placeholder={meta.model || t("common.modelName")} onChange={(e) => setDraft(id, { model: e.target.value })} />
                  </label>
                  <label className="field">
                    {t("settings.models.baseUrl")}
                    <input value={d.baseUrl} placeholder={meta.baseUrl || "https://…/v1"} onChange={(e) => setDraft(id, { baseUrl: e.target.value })} />
                  </label>
                </div>
                <datalist id={`models-${id}`}>
                  {list?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {[m.free ? t("common.free") : "", m.tools === false ? t("common.noTools") : "", m.name ?? ""].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </datalist>
                <div className="row-btns">
                  <button className="btn sm" onClick={() => void loadModels(id)} disabled={loading !== null || (meta.needsKey && id !== "openrouter" && !pub?.hasKey && !d.apiKey)}>
                    {loading === id ? t("common.loading") : t("settings.models.load")}
                  </button>
                  {pub?.hasKey && (
                    <button className="btn sm" onClick={() => void removeKey(id)}>{t("settings.models.removeKey")}</button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  const freeSection = (
    <>
      <p className="lead">{t("settings.free.lead")}</p>
      <div className="card">
        <h3 className="card-h">{t("settings.free.setup")}</h3>
        <div className="free-steps">
          <div>
            <b>{t("settings.free.step1")}</b>
            {rich("settings.free.pasteUnder", {
              link: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener">Google AI Studio</a>,
              target: <button className="link-btn" onClick={() => { pickTab("models"); setOpen(new Set([...open, "gemini"])); }}>{t("settings.free.toGemini")}</button>,
            })}
          </div>
          <div>
            <b>{t("settings.free.step2")}</b>
            {rich("settings.free.pasteUnder", {
              link: <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer noopener">openrouter.ai/keys</a>,
              target: <button className="link-btn" onClick={() => { pickTab("models"); setOpen(new Set([...open, "openrouter"])); }}>{t("settings.free.toOpenRouter")}</button>,
            })}
          </div>
          <div>
            <b>{t("settings.free.step3")}</b>
            {t("settings.free.step3Text")}
          </div>
        </div>
        <button className="btn primary" onClick={() => void setupFree()} disabled={loading !== null || saving}>
          {loading === "free" ? t("settings.free.finding") : t("settings.free.setup")}
        </button>
      </div>

      <div className="card">
        <h3 className="card-h">{t("settings.free.order")}</h3>
        <div className="fb-list">
          {[primary, ...s.fallbacks].map((r, i) => (
            <div key={`${r.provider}:${r.model}:${i}`} className="fb-row">
              <span className="fb-num">{i + 1}</span>
              <b>{providerName(r.provider)}</b>
              <code>{r.model}</code>
              <span className="spacer" />
              {i === 0 ? (
                <span className="badge">{t("settings.free.main")}</span>
              ) : (
                <>
                  <button className="icon-btn sm" onClick={() => move(i - 1, -1)} disabled={i === 1} aria-label={t("settings.free.moveUp")} title={t("settings.free.moveUp")}>↑</button>
                  <button className="icon-btn sm" onClick={() => move(i - 1, 1)} disabled={i === s.fallbacks.length} aria-label={t("settings.free.moveDown")} title={t("settings.free.moveDown")}>↓</button>
                  <button className="icon-btn sm" onClick={() => setFallbacks(s.fallbacks.filter((_, j) => j !== i - 1))} aria-label={t("common.remove")} title={t("common.remove")}>
                    <Icon name="close" size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="fb-add">
          <label className="field">
            {t("settings.free.addBackup")}
            <select value={fb.provider} onChange={(e) => setFb({ provider: e.target.value as ProviderId, model: "" })}>
              {PROVIDER_IDS.map((p) => (
                <option key={p} value={p}>{providerName(p)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("common.model")}
            <input list={`fb-models-${fb.provider}`} value={fb.model} placeholder={PROVIDERS[fb.provider].model || t("common.modelName")} onChange={(e) => setFb({ ...fb, model: e.target.value })} />
            <datalist id={`fb-models-${fb.provider}`}>
              {models[fb.provider]?.map((m) => <option key={m.id} value={m.id}>{m.free ? t("common.free") : ""}</option>)}
            </datalist>
          </label>
          <button
            className="btn"
            disabled={!fb.model.trim()}
            onClick={() => {
              const ref = { provider: fb.provider, model: fb.model.trim() };
              if (!s.fallbacks.some((x) => sameRef(x, ref))) setFallbacks([...s.fallbacks, ref]);
              setFb({ ...fb, model: "" });
            }}
          >
            <Icon name="plus" size={16} /> {t("common.add")}
          </button>
        </div>
        <p className="note">{t("settings.free.note")}</p>
      </div>
    </>
  );

  const accountsSection = (
    <>
      <p className="lead">{rich("settings.acc.lead", { option: <b>{t("bot.accounts")}</b> })}</p>
      <div className="card">
        <div className="row-btns">
          <button className="btn primary" onClick={() => void openSignIn()} disabled={accBusy || !!acc?.signInOpen}>
            {acc?.signInOpen ? t("settings.acc.windowOpen") : t("settings.acc.open")}
          </button>
          {!!acc?.sites.length && (
            <button className="btn danger" onClick={() => void signOut()} disabled={accBusy}>
              {t("settings.acc.signOutAll")}
            </button>
          )}
        </div>
        {acc?.sites.length ? (
          <div className="site-chips">
            {acc.sites.map((x) => (
              <span key={x} className="tag">{x}</span>
            ))}
          </div>
        ) : (
          <p className="note">{t("settings.acc.none")}</p>
        )}
      </div>
      <div className="card">
        <h3 className="card-h">{t("settings.acc.safeTitle")}</h3>
        <ul className="plain-list">
          <li>{t("settings.acc.safe1")}</li>
          <li>{t("settings.acc.safe2")}</li>
          <li>{t("settings.acc.safe3")}</li>
          <li>{t("settings.acc.safe4")}</li>
        </ul>
      </div>
    </>
  );

  const searchSection = (
    <>
      <p className="lead">{t("settings.search.lead")}</p>
      <div className="card">
        <div className="grid">
          <label className="field">
            {t("settings.search.provider")}
            <select value={s.search.provider} onChange={(e) => setS({ ...s, search: { ...s.search, provider: e.target.value as PublicSettings["search"]["provider"] } })}>
              <option value="auto">{t("settings.search.auto")}</option>
              <option value="none">{t("settings.search.none")}</option>
              <option value="searxng">{t("settings.search.searxng")}</option>
              <option value="brave">{t("settings.search.brave")}</option>
              <option value="tavily">{t("settings.search.tavily")}</option>
            </select>
          </label>
          {s.search.provider === "searxng" && (
            <label className="field">
              {t("settings.search.searxngUrl")}
              <input value={s.search.searxngUrl} onChange={(e) => setS({ ...s, search: { ...s.search, searxngUrl: e.target.value } })} />
            </label>
          )}
          {s.search.provider === "brave" && (
            <label className="field">
              {t("settings.search.braveKey")} <a href="https://brave.com/search/api/" target="_blank" rel="noreferrer noopener">{t("common.getOne")}</a>
              <input type="password" autoComplete="off" value={searchKeys.brave} placeholder={s.search.hasBraveKey ? t("settings.search.savedReplace") : t("common.pasteKey")} onChange={(e) => setSearchKeys({ ...searchKeys, brave: e.target.value })} />
            </label>
          )}
          {s.search.provider === "tavily" && (
            <label className="field">
              {t("settings.search.tavilyKey")} <a href="https://app.tavily.com" target="_blank" rel="noreferrer noopener">{t("common.getOne")}</a>
              <input type="password" autoComplete="off" value={searchKeys.tavily} placeholder={s.search.hasTavilyKey ? t("settings.search.savedReplace") : t("common.pasteKey")} onChange={(e) => setSearchKeys({ ...searchKeys, tavily: e.target.value })} />
            </label>
          )}
        </div>
        {s.search.provider === "searxng" && <p className="note">{rich("settings.search.searxngNote", { cmd: <code>docker compose up -d</code> })}</p>}
      </div>
    </>
  );

  const browserSection = (
    <>
      <p className="lead">{t("settings.browser.lead")}</p>
      <div className="card">
        <div className="grid">
          <label className="field">
            {t("settings.browser.mode")}
            <select value={s.browser.mode} onChange={(e) => setS({ ...s, browser: { ...s.browser, mode: e.target.value as "local" | "docker" } })}>
              <option value="local">{t("settings.browser.local")}</option>
              <option value="docker">{t("settings.browser.docker")}</option>
            </select>
          </label>
          {s.browser.mode === "local" ? (
            <label className="field">
              {t("settings.browser.browser")}
              <select value={s.browser.channel} onChange={(e) => setS({ ...s, browser: { ...s.browser, channel: e.target.value as "auto" | "msedge" | "chrome" | "chromium" } })}>
                <option value="auto">{t("settings.browser.auto")}</option>
                <option value="msedge">{t("settings.browser.msedge")}</option>
                <option value="chrome">{t("settings.browser.chrome")}</option>
                <option value="chromium">{t("settings.browser.chromium")}</option>
              </select>
            </label>
          ) : (
            <label className="field">
              {t("settings.browser.sandbox")}
              <input value={s.browser.wsEndpoint} onChange={(e) => setS({ ...s, browser: { ...s.browser, wsEndpoint: e.target.value } })} />
            </label>
          )}
        </div>
        {s.browser.mode === "docker" && <p className="note">{rich("settings.browser.dockerNote", { cmd: <code>docker compose up -d</code> })}</p>}
        <label className="check">
          <input type="checkbox" checked={s.browser.allowPrivateNetwork} onChange={(e) => setS({ ...s, browser: { ...s.browser, allowPrivateNetwork: e.target.checked } })} />
          <span>{t("settings.browser.privateNet")}</span>
        </label>
      </div>
    </>
  );

  const safetySection = (
    <>
      <p className="lead">{t("settings.safety.lead")}</p>
      <div className="card">
        <label className="check">
          <input type="checkbox" checked={s.approvals.clicksAndTyping} onChange={(e) => setS({ ...s, approvals: { clicksAndTyping: e.target.checked } })} />
          <span>{t("settings.safety.ask")}</span>
        </label>
        <div className="grid">
          <label className="field">
            {t("settings.safety.maxSteps")}
            <input type="number" min={1} max={100} value={s.maxSteps} onChange={(e) => setS({ ...s, maxSteps: Number(e.target.value) })} />
            <span className="hint">{t("settings.safety.maxStepsHint")}</span>
          </label>
          <label className="field">
            {t("settings.safety.handoffs")}
            <input type="number" min={0} max={30} value={s.maxTurns} onChange={(e) => setS({ ...s, maxTurns: Number(e.target.value) })} />
            <span className="hint">{t("settings.safety.handoffsHint")}</span>
          </label>
        </div>
      </div>
    </>
  );

  const profileSection = (
    <>
      <p className="lead">{t("settings.profile.lead")}</p>
      <div className="card">
        <div className="avatar-pick">
          {profile.image ? <img src={profile.image} alt={t("common.yourPhoto")} className="avatar-img big" /> : <span className="avatar-initial">{(profile.name || "?").slice(0, 1).toUpperCase()}</span>}
          <div className="row-btns">
            <label className="btn sm">
              {t("settings.profile.changePhoto")}
              <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setProfile({ ...profile, image: await resizeImage(f).catch(() => profile.image) }); }} />
            </label>
            {profile.image && <button className="btn sm" onClick={() => setProfile({ ...profile, image: null })}>{t("settings.profile.removePhoto")}</button>}
          </div>
        </div>
        <label className="field">
          {t("common.yourName")}
          <input value={profile.name} maxLength={60} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
        </label>
        <p className="note">{t("settings.profile.signedInAs", { email: account?.user?.email ?? "…" })}</p>
        <div className="row-btns">
          <button className="btn primary" onClick={() => void saveProfile()} disabled={saving || !profile.name.trim()}>{t("settings.profile.save")}</button>
          <button className="btn danger" onClick={() => void signOutAccount()}>{t("settings.profile.signOut")}</button>
        </div>
      </div>
    </>
  );

  const languageSection = (
    <>
      <p className="lead">{t("settings.lang.lead")}</p>
      <div className="card">
        <label className="field">
          {t("settings.lang.label")}
          <select value={s.language ?? "auto"} onChange={(e) => setS({ ...s, language: e.target.value })}>
            <option value="auto">{t("settings.lang.auto")}</option>
            {LOCALES.map((id) => (
              <option key={id} value={id} lang={id}>{languageLabel(id, tag)}</option>
            ))}
          </select>
        </label>
      </div>
    </>
  );

  const dataSection = (
    <>
      <p className="lead">{t("settings.data.lead")}</p>
      <div className="card">
        <h3 className="card-h">{t("settings.data.backup")}</h3>
        <p className="note">{t("settings.data.backupNote")}</p>
        <div className="row-btns">
          <a className="btn primary" href="/api/backup" download>
            {t("settings.data.download")}
          </a>
          <label className="btn">
            {t("settings.data.restore")}
            <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importBackup(f); e.target.value = ""; }} />
          </label>
        </div>
      </div>
      <div className="card disabled-card" aria-disabled="true">
        <h3 className="card-h">{t("settings.data.sync")} <span className="badge">{t("settings.data.syncBadge")}</span></h3>
        <p className="note">{t("settings.data.syncNote")}</p>
      </div>
    </>
  );

  const aboutSection = (
    <>
      <p className="lead">{t("settings.about.lead", { version: account?.appVersion ?? "" })}</p>
      <div className="card">
        <label className="check">
          <input type="checkbox" checked={s.crashReports !== false} onChange={(e) => setS({ ...s, crashReports: e.target.checked })} />
          <span>{t("settings.about.crash")}</span>
        </label>
      </div>
      <div className="card">
        <div className="row-btns">
          <a className="btn" href={`${account?.cloudUrl ?? ""}/terms`} target="_blank" rel="noreferrer noopener">{t("common.terms")}</a>
          <a className="btn" href={`${account?.cloudUrl ?? ""}/privacy`} target="_blank" rel="noreferrer noopener">{t("common.privacy")}</a>
        </div>
      </div>
    </>
  );

  const sections: Record<Tab, React.ReactNode> = {
    profile: profileSection,
    models: modelsSection,
    free: freeSection,
    accounts: accountsSection,
    search: searchSection,
    browser: browserSection,
    safety: safetySection,
    language: languageSection,
    data: dataSection,
    about: aboutSection,
  };

  return (
    <main className="settings wide">
      <h1>{t("common.settings")}</h1>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("settings.sections")}>
          {TABS.map((x) => (
            <button key={x.id} className={tab === x.id ? "on" : ""} onClick={() => pickTab(x.id)} aria-current={tab === x.id ? "page" : undefined}>
              <Icon name={x.icon} size={18} />
              <span>
                <b>{t(`settings.tab.${x.id}`)}</b>
                <small>{t(`settings.tab.${x.id}.hint`)}</small>
              </span>
            </button>
          ))}
        </nav>

        <section className="settings-body" aria-label={t(`settings.tab.${current.id}`)}>
          <h2>{t(`settings.tab.${current.id}`)}</h2>
          {sections[tab]}
          <div className="savebar">
            {tab !== "profile" && tab !== "data" && (
              <button className="btn primary" onClick={() => void save()} disabled={saving}>{t("common.save")}</button>
            )}
            {(tab === "models" || tab === "free") && (
              <button className="btn" onClick={() => void test()} disabled={saving}>{t("settings.saveTest")}</button>
            )}
            {msg && <span className={msg.ok ? "msg-ok" : "msg-err"}>{msg.text}</span>}
          </div>
        </section>
      </div>
    </main>
  );
}
