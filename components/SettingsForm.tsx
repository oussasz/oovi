"use client";

import { useCallback, useEffect, useState } from "react";
import { PROVIDER_IDS, PROVIDERS, providerName, type ProviderId } from "@/lib/providers-meta";
import type { ModelRef, PublicSettings, SettingsPatch } from "@/lib/settings";
import Icon from "./Icon";

type Draft = { apiKey: string; model: string; baseUrl: string };
type ModelInfo = { id: string; name?: string; free?: boolean; tools?: boolean; context?: number };
type Accounts = { signInOpen: boolean; sites: string[]; updatedAt?: number };

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
    fetch("/api/settings").then((r) => r.json()).then(apply).catch((e) => setMsg({ ok: false, text: String(e) }));
    void loadAcc();
  }, [loadAcc]);

  // While the sign-in window is open, keep the list of sites fresh.
  useEffect(() => {
    if (!acc?.signInOpen) return;
    const t = setInterval(() => void loadAcc(), 2500);
    return () => clearInterval(t);
  }, [acc?.signInOpen, loadAcc]);

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
      await post({
        active: s.active,
        providers: Object.fromEntries(PROVIDER_IDS.map((id) => [id, { apiKey: drafts[id].apiKey || undefined, model: drafts[id].model, baseUrl: drafts[id].baseUrl }])),
        fallbacks: s.fallbacks,
        search: { provider: s.search.provider, searxngUrl: s.search.searxngUrl, braveKey: searchKeys.brave || undefined, tavilyKey: searchKeys.tavily || undefined },
        browser: s.browser,
        approvals: s.approvals,
        maxSteps: s.maxSteps,
        maxTurns: s.maxTurns,
      });
      setSearchKeys({ brave: "", tavily: "" });
      if (!quiet) setMsg({ ok: true, text: "Saved." });
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
    setMsg({ ok: true, text: "Testing…" });
    const r = (await fetch("/api/settings/test", { method: "POST" }).then((x) => x.json())) as { ok: boolean; provider: string; reply?: string; ms?: number; error?: string; model?: string };
    setMsg(r.ok ? { ok: true, text: `${r.model ?? r.provider} answered “${r.reply}” in ${r.ms} ms.` } : { ok: false, text: r.error ?? "Failed." });
  }

  async function removeKey(id: ProviderId) {
    try {
      await post({ providers: { [id]: { clearKey: true } } });
      setMsg({ ok: true, text: `Removed the ${PROVIDERS[id].label} key.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function fetchModels(id: ProviderId): Promise<ModelInfo[]> {
    const r = await fetch(`/api/models?provider=${id}`);
    const j = (await r.json()) as { models?: ModelInfo[]; error?: string };
    if (!r.ok || !j.models) throw new Error(j.error ?? "Couldn't load models.");
    setModels((m) => ({ ...m, [id]: j.models }));
    return j.models;
  }

  async function loadModels(id: ProviderId) {
    if (!(await save(true))) return;
    setLoading(id);
    try {
      const list = await fetchModels(id);
      const free = list.filter((m) => m.free).length;
      setMsg({ ok: true, text: `${providerName(id)}: ${list.length} models${free ? `, ${free} free` : ""}. Pick one from the Model box.` });
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
      setMsg({ ok: false, text: "Paste a free Gemini key and/or a free OpenRouter key in the cards below first, then try again." });
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
      if (!picks.length) throw new Error(problems.join(" ") || "No free models found right now.");

      const activeReady = !PROVIDERS[s.active].needsKey || !!s.providers[s.active]?.hasKey;
      const main = activeReady ? undefined : picks.shift();
      const fallbacks = [...picks, ...s.fallbacks].filter((r, i, all) => all.findIndex((x) => sameRef(x, r)) === i).slice(0, 12);
      await post({ ...(main ? { active: main.provider, providers: { [main.provider]: { model: main.model } } } : {}), fallbacks });
      setMsg({
        ok: true,
        text: `Done: ${main ? `main model ${providerName(main.provider)} · ${main.model}, ` : ""}${picks.length} free backup model${picks.length === 1 ? "" : "s"}.${problems.length ? ` (${problems.join(" ")})` : ""}`,
      });
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
    if (!confirm("Sign out of every site in oovi's browser? Bots will lose access to your accounts until you sign in again.")) return;
    setAccBusy(true);
    try {
      setAcc((await fetch("/api/accounts", { method: "DELETE" }).then((r) => r.json())) as Accounts);
      setMsg({ ok: true, text: "Signed out of everything." });
    } finally {
      setAccBusy(false);
    }
  }

  if (!s || !drafts) return <main className="settings">{msg ? <p className="msg-err">{msg.text}</p> : "Loading…"}</main>;

  const setDraft = (id: ProviderId, patch: Partial<Draft>) => setDrafts({ ...drafts, [id]: { ...drafts[id], ...patch } });
  const primary: ModelRef = { provider: s.active, model: drafts[s.active].model || PROVIDERS[s.active].model || "(no model)" };
  const setFallbacks = (fallbacks: ModelRef[]) => setS({ ...s, fallbacks });
  const move = (i: number, d: number) => {
    const next = [...s.fallbacks];
    const [x] = next.splice(i, 1);
    if (x) next.splice(Math.max(0, Math.min(next.length, i + d)), 0, x);
    setFallbacks(next);
  };

  return (
    <main className="settings">
      <h1>Settings</h1>
      <p className="lead">Use your own API keys: you pay the provider per use (or nothing, with free models), never a subscription. Keys are encrypted and stay on this computer.</p>

      <h2>Free models &amp; automatic switching</h2>
      <div className="card">
        <p className="muted">
          Bots never get stuck: if a model is rate-limited, down, or can&apos;t use tools, oovi switches to the next model in your list and tries the first one again later.
        </p>
        <div className="free-steps">
          <div>
            <b>1. Free Gemini key</b>
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener">Google AI Studio</a>, then paste it in the Gemini card below.
          </div>
          <div>
            <b>2. Free OpenRouter key</b>
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer noopener">openrouter.ai/keys</a>, then paste it in the OpenRouter card below.
          </div>
          <div>
            <b>3. One click</b>
            oovi finds the free models that support tools and lines them up.
          </div>
        </div>
        <div className="row-btns">
          <button className="btn primary" onClick={() => void setupFree()} disabled={loading !== null || saving}>
            {loading === "free" ? "Finding free models…" : "Set up free models"}
          </button>
        </div>

        <div className="opt-label" style={{ marginTop: 14 }}>Model order</div>
        <div className="fb-list">
          {[primary, ...s.fallbacks].map((r, i) => (
            <div key={`${r.provider}:${r.model}:${i}`} className="fb-row">
              <span className="fb-num">{i + 1}</span>
              <b>{providerName(r.provider)}</b>
              <code>{r.model}</code>
              <span className="spacer" />
              {i === 0 ? (
                <span className="badge">main</span>
              ) : (
                <>
                  <button className="icon-btn sm" onClick={() => move(i - 1, -1)} disabled={i === 1} aria-label="Move up" title="Move up">↑</button>
                  <button className="icon-btn sm" onClick={() => move(i - 1, 1)} disabled={i === s.fallbacks.length} aria-label="Move down" title="Move down">↓</button>
                  <button className="icon-btn sm" onClick={() => setFallbacks(s.fallbacks.filter((_, j) => j !== i - 1))} aria-label="Remove" title="Remove">
                    <Icon name="close" size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="fb-add">
          <label className="field">
            Add backup
            <select value={fb.provider} onChange={(e) => setFb({ provider: e.target.value as ProviderId, model: "" })}>
              {PROVIDER_IDS.map((p) => (
                <option key={p} value={p}>{providerName(p)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Model
            <input list={`models-${fb.provider}`} value={fb.model} placeholder={PROVIDERS[fb.provider].model || "model name"} onChange={(e) => setFb({ ...fb, model: e.target.value })} />
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
            <Icon name="plus" size={16} /> Add
          </button>
        </div>
        <p className="note">The main model is the one picked below. Each bot can also have its own model; these backups then follow it. Remember to Save.</p>
      </div>

      <h2>Model providers</h2>
      {PROVIDER_IDS.map((id) => {
        const meta = PROVIDERS[id];
        const pub = s.providers[id];
        const d = drafts[id];
        const list = models[id];
        return (
          <div key={id} className={`card ${s.active === id ? "active" : ""}`}>
            <div className="card-head">
              <label>
                <input type="radio" name="active" checked={s.active === id} onChange={() => setS({ ...s, active: id })} />
                {meta.label}
              </label>
              <span style={{ display: "flex", gap: 6 }}>
                {meta.free && <span className="badge ok">free tier</span>}
                {meta.needsKey ? pub?.hasKey ? <span className="badge ok">Key saved {pub.keyHint}</span> : <span className="badge">No key</span> : <span className="badge">No key needed</span>}
              </span>
            </div>
            {meta.note && <p className="note">{meta.note}</p>}
            <div className="grid">
              <label className="field full">
                API key {meta.keyUrl && <a href={meta.keyUrl} target="_blank" rel="noreferrer noopener">(get one)</a>}
                <input type="password" autoComplete="off" value={d.apiKey} placeholder={pub?.hasKey ? "Saved. Type a new key to replace it." : meta.needsKey ? "Paste your key" : "Optional"} onChange={(e) => setDraft(id, { apiKey: e.target.value })} />
              </label>
              <label className="field">
                Model {list && <span className="hint">({list.length} available{list.some((m) => m.free) ? `, ${list.filter((m) => m.free).length} free` : ""})</span>}
                <input list={`models-${id}`} value={d.model} placeholder={meta.model || "model name"} onChange={(e) => setDraft(id, { model: e.target.value })} />
              </label>
              <label className="field">
                Base URL
                <input value={d.baseUrl} placeholder={meta.baseUrl || "https://…/v1"} onChange={(e) => setDraft(id, { baseUrl: e.target.value })} />
              </label>
            </div>
            <datalist id={`models-${id}`}>
              {list?.map((m) => (
                <option key={m.id} value={m.id}>
                  {[m.free ? "free" : "", m.tools === false ? "no tools" : "", m.name ?? ""].filter(Boolean).join(" · ")}
                </option>
              ))}
            </datalist>
            <div className="row-btns">
              <button className="btn sm" onClick={() => void loadModels(id)} disabled={loading !== null || (meta.needsKey && id !== "openrouter" && !pub?.hasKey && !d.apiKey)}>
                {loading === id ? "Loading…" : "Load models"}
              </button>
              {pub?.hasKey && (
                <button className="btn sm" onClick={() => void removeKey(id)}>Remove key</button>
              )}
            </div>
          </div>
        );
      })}

      <h2>Your accounts</h2>
      <div className="card">
        <p className="muted">
          Sign in once, yourself, in oovi&apos;s own browser window. Bots with <b>Use my signed-in accounts</b> turned on can then publish posts, reply to comments and download files for you. They ask before every click and keystroke, and never see your passwords.
        </p>
        <div className="row-btns">
          <button className="btn primary" onClick={() => void openSignIn()} disabled={accBusy || !!acc?.signInOpen}>
            {acc?.signInOpen ? "Sign-in window is open. Close it when you're done" : "Open sign-in browser"}
          </button>
          {!!acc?.sites.length && (
            <button className="btn danger" onClick={() => void signOut()} disabled={accBusy}>
              Sign out of everything
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
          <p className="note">No sites yet.</p>
        )}
        <p className="note">Downloaded files go to your Downloads/oovi folder and are never opened automatically. Some sites (Google, for example) may refuse sign-in from an automated browser.</p>
      </div>

      <h2>Web search</h2>
      <div className="card">
        <div className="grid">
          <label className="field">
            Search provider
            <select value={s.search.provider} onChange={(e) => setS({ ...s, search: { ...s.search, provider: e.target.value as PublicSettings["search"]["provider"] } })}>
              <option value="none">None (bots only open URLs)</option>
              <option value="searxng">SearXNG (free, self-hosted)</option>
              <option value="brave">Brave Search API (your key)</option>
              <option value="tavily">Tavily (your key)</option>
            </select>
          </label>
          {s.search.provider === "searxng" && (
            <label className="field">
              SearXNG address
              <input value={s.search.searxngUrl} onChange={(e) => setS({ ...s, search: { ...s.search, searxngUrl: e.target.value } })} />
            </label>
          )}
          {s.search.provider === "brave" && (
            <label className="field">
              Brave API key <a href="https://brave.com/search/api/" target="_blank" rel="noreferrer noopener">(get one)</a>
              <input type="password" autoComplete="off" value={searchKeys.brave} placeholder={s.search.hasBraveKey ? "Saved. Type to replace." : "Paste your key"} onChange={(e) => setSearchKeys({ ...searchKeys, brave: e.target.value })} />
            </label>
          )}
          {s.search.provider === "tavily" && (
            <label className="field">
              Tavily API key <a href="https://app.tavily.com" target="_blank" rel="noreferrer noopener">(get one)</a>
              <input type="password" autoComplete="off" value={searchKeys.tavily} placeholder={s.search.hasTavilyKey ? "Saved. Type to replace." : "Paste your key"} onChange={(e) => setSearchKeys({ ...searchKeys, tavily: e.target.value })} />
            </label>
          )}
        </div>
        {s.search.provider === "searxng" && <p className="note">Start it with <code>docker compose up -d</code> in the project folder.</p>}
      </div>

      <h2>Browser sandbox</h2>
      <div className="card">
        <div className="grid">
          <label className="field">
            Mode
            <select value={s.browser.mode} onChange={(e) => setS({ ...s, browser: { ...s.browser, mode: e.target.value as "local" | "docker" } })}>
              <option value="local">Local: headless browser with a fresh, empty profile</option>
              <option value="docker">Docker: browser runs in a container (safer)</option>
            </select>
          </label>
          {s.browser.mode === "local" ? (
            <label className="field">
              Browser
              <select value={s.browser.channel} onChange={(e) => setS({ ...s, browser: { ...s.browser, channel: e.target.value as "auto" | "msedge" | "chrome" | "chromium" } })}>
                <option value="auto">Auto: Chrome, then Edge, then Chromium</option>
                <option value="msedge">Microsoft Edge (installed)</option>
                <option value="chrome">Google Chrome (installed)</option>
                <option value="chromium">Chromium (npx playwright install chromium)</option>
              </select>
            </label>
          ) : (
            <label className="field">
              Sandbox address
              <input value={s.browser.wsEndpoint} onChange={(e) => setS({ ...s, browser: { ...s.browser, wsEndpoint: e.target.value } })} />
            </label>
          )}
        </div>
        {s.browser.mode === "docker" && <p className="note">Start the sandbox with <code>docker compose up -d</code>. Bots using your accounts always use the local browser.</p>}
        <label className="check">
          <input type="checkbox" checked={s.browser.allowPrivateNetwork} onChange={(e) => setS({ ...s, browser: { ...s.browser, allowPrivateNetwork: e.target.checked } })} />
          <span>Allow local network (localhost, 192.168.x.x…). Off by default so a web page can&apos;t make a bot reach your router or local services.</span>
        </label>
      </div>

      <h2>Safety</h2>
      <div className="card">
        <label className="check">
          <input type="checkbox" checked={s.approvals.clicksAndTyping} onChange={(e) => setS({ ...s, approvals: { clicksAndTyping: e.target.checked } })} />
          <span>Ask me before a bot types into a page, downloads, or clicks buttons (plain links don&apos;t ask). Bots using your accounts always ask.</span>
        </label>
        <div className="grid">
          <label className="field">
            Max steps per bot reply
            <input type="number" min={1} max={100} value={s.maxSteps} onChange={(e) => setS({ ...s, maxSteps: Number(e.target.value) })} />
            <span className="hint">One step = one model call. Stops runaway loops.</span>
          </label>
          <label className="field">
            Hand-offs per message (groups)
            <input type="number" min={0} max={30} value={s.maxTurns} onChange={(e) => setS({ ...s, maxTurns: Number(e.target.value) })} />
            <span className="hint">How many times bots may pass work to each other after one message.</span>
          </label>
        </div>
      </div>

      <div className="savebar">
        <button className="btn primary" onClick={() => void save()} disabled={saving}>Save</button>
        <button className="btn" onClick={() => void test()} disabled={saving}>Save &amp; test connection</button>
        {msg && <span className={msg.ok ? "msg-ok" : "msg-err"}>{msg.text}</span>}
      </div>
    </main>
  );
}
