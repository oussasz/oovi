"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicSettings, SettingsPatch } from "@/lib/settings";
import { resizeImage } from "@/lib/client";
import { LOCALES, NATIVE_NAMES, type Locale } from "@/lib/i18n";
import { announceLanguage, useI18n } from "./I18n";
import ComputerFilesSettings from "./ComputerFilesSettings";
import DesktopControlSettings from "./DesktopControlSettings";
import Icon, { type IconName } from "./Icon";
import MemorySettings from "./MemorySettings";
import ModelsSettings from "./ModelsSettings";
import TelegramSettings from "./TelegramSettings";
import { UpdateCard } from "./Updates";

type Accounts = { signInOpen: boolean; sites: string[]; updatedAt?: number };
type Tab = "profile" | "models" | "memory" | "telegram" | "accounts" | "search" | "browser" | "computer" | "safety" | "language" | "data" | "about";
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
  { id: "memory", icon: "bulb" },
  { id: "telegram", icon: "send" },
  { id: "accounts", icon: "globe" },
  { id: "search", icon: "zoomIn" },
  { id: "browser", icon: "cursor" },
  { id: "computer", icon: "server" },
  { id: "safety", icon: "shield" },
  { id: "language", icon: "lang" },
  { id: "data", icon: "box" },
  { id: "about", icon: "info" },
];

export default function SettingsForm() {
  const [s, setS] = useState<PublicSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [searchKeys, setSearchKeys] = useState({ brave: "", tavily: "" });
  const [e2bKey, setE2bKey] = useState("");
  const [acc, setAcc] = useState<Accounts | null>(null);
  const [accBusy, setAccBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("profile");
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

  const apply = useCallback((next: PublicSettings) => setS(next), []);

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
      .then((next: PublicSettings) => apply(next))
      .catch((e) => setMsg({ ok: false, text: String(e) }));
    void loadAcc();
    try {
      const saved = localStorage.getItem("oovi.settings.tab") as Tab | null;
      if (saved && TABS.some((t) => t.id === saved)) setTab(saved);
    } catch {
      /* storage unavailable */
    }
  }, [loadAcc, apply]);

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
    if (!s) return false;
    setSaving(true);
    if (!quiet) setMsg(null);
    try {
      const next = await post({
        search: { provider: s.search.provider, searxngUrl: s.search.searxngUrl, braveKey: searchKeys.brave || undefined, tavilyKey: searchKeys.tavily || undefined },
        browser: s.browser,
        approvals: s.approvals,
        maxSteps: s.maxSteps,
        maxTurns: s.maxTurns,
        language: s.language,
        crashReports: s.crashReports,
        usageStats: s.usageStats,
        ...(e2bKey.trim() ? { sandbox: { e2bKey: e2bKey.trim() } } : {}),
      });
      setSearchKeys({ brave: "", tavily: "" });
      setE2bKey("");
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

  if (!s) return <main className="settings">{msg ? <p className="msg-err">{msg.text}</p> : t("common.loading")}</main>;

  const current = TABS.find((t) => t.id === tab) ?? TABS[0]!;

  // ---------- sections ----------

  const modelsSection = <ModelsSettings s={s} onSaved={apply} onMsg={setMsg} />;

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

  const computerSection = (
    <>
      <p className="lead">{t("settings.vm.lead")}</p>
      <div className="card">
        <ul className="vm-points">
          <li>{t("settings.vm.p1")}</li>
          <li>{t("settings.vm.p2")}</li>
          <li>{t("settings.vm.p3")}</li>
        </ul>
        <label className="field">
          <span>
            {t("settings.vm.key")}{" "}
            <a href="https://e2b.dev/dashboard?tab=keys" target="_blank" rel="noreferrer noopener">
              {t("common.getOne")}
            </a>
          </span>
          <input type="password" autoComplete="off" value={e2bKey} placeholder={s.sandbox?.hasKey ? t("settings.vm.saved", { hint: s.sandbox.keyHint ?? "" }) : t("common.pasteKey")} onChange={(e) => setE2bKey(e.target.value)} />
          <span className="hint">{s.sandbox?.hasKey ? t("settings.vm.on") : t("settings.vm.off")}</span>
        </label>
        {s.sandbox?.hasKey && (
          <button
            className="btn sm"
            onClick={() =>
              void post({ sandbox: { clearKey: true } })
                .then(() => setMsg({ ok: true, text: t("settings.vm.removed") }))
                .catch((e: Error) => setMsg({ ok: false, text: e.message }))
            }
          >
            {t("settings.vm.remove")}
          </button>
        )}
        <p className="note">{t("settings.vm.note")}</p>
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
      <ComputerFilesSettings />
      <DesktopControlSettings />
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
      <UpdateCard />
      <div className="card">
        <label className="check">
          <input type="checkbox" checked={s.crashReports !== false} onChange={(e) => setS({ ...s, crashReports: e.target.checked })} />
          <span>{t("settings.about.crash")}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.usageStats !== false} onChange={(e) => setS({ ...s, usageStats: e.target.checked })} />
          <span>{t("settings.about.usage")}</span>
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
    memory: <MemorySettings />,
    telegram: <TelegramSettings />,
    accounts: accountsSection,
    search: searchSection,
    browser: browserSection,
    computer: computerSection,
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
            {tab !== "profile" && tab !== "data" && tab !== "models" && tab !== "memory" && tab !== "telegram" && (
              <button className="btn primary" onClick={() => void save()} disabled={saving}>{t("common.save")}</button>
            )}
            {msg && <span className={msg.ok ? "msg-ok" : "msg-err"}>{msg.text}</span>}
          </div>
        </section>
      </div>
    </main>
  );
}
