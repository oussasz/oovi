"use client";

// Settings > AI models: connected providers, the models you switched on (in the
// order oovi tries them, with prices), and one-click free models.
import { useCallback, useEffect, useMemo, useState } from "react";
import { chainOf, enabledRefs, isConnected, priceText, providerModels, refKey, sameRef, type ModelInfo } from "@/lib/model-list";
import { PROVIDER_IDS, PROVIDERS, providerName, type ProviderId } from "@/lib/providers-meta";
import type { ModelRef, PublicSettings, SettingsPatch } from "@/lib/settings";
import { useI18n } from "./I18n";
import Icon from "./Icon";

type Msg = { ok: boolean; text: string } | null;

export default function ModelsSettings({ s, onSaved, onMsg }: { s: PublicSettings; onSaved: (next: PublicSettings) => void; onMsg: (m: Msg) => void }) {
  const { t } = useI18n();
  const [lists, setLists] = useState<Partial<Record<ProviderId, ModelInfo[]>>>({});
  const [listErr, setListErr] = useState<Partial<Record<ProviderId, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [urls, setUrls] = useState<Partial<Record<ProviderId, string>>>({});
  const [editing, setEditing] = useState<ProviderId | null>(null);
  const [from, setFrom] = useState<ProviderId | "">("");
  const [query, setQuery] = useState("");

  const chain = useMemo(() => chainOf(s), [s]);
  const connectedIds = useMemo(() => PROVIDER_IDS.filter((p) => isConnected(s, p)), [s]);
  const labels = { free: t("models.free"), perM: t("models.perM") };

  const post = useCallback(
    async (patch: SettingsPatch) => {
      const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error(await r.text());
      const next = (await r.json()) as PublicSettings;
      onSaved(next);
      return next;
    },
    [onSaved],
  );

  const load = useCallback(
    async (p: ProviderId, fresh = false): Promise<ModelInfo[]> => {
      try {
        const r = await fetch(`/api/models?provider=${p}${fresh ? "&fresh=1" : ""}`);
        const j = (await r.json()) as { models?: ModelInfo[]; error?: string };
        if (!r.ok || !j.models) throw new Error(j.error ?? "");
        setLists((m) => ({ ...m, [p]: j.models }));
        setListErr((e) => ({ ...e, [p]: undefined }));
        return j.models;
      } catch (e) {
        setListErr((x) => ({ ...x, [p]: (e as Error).message || t("models.cantLoad") }));
        return [];
      }
    },
    [t],
  );

  // Model lists (with prices) for every connected provider.
  useEffect(() => {
    for (const p of connectedIds) if (!lists[p] && !listErr[p]) void load(p);
    if ((!from || !connectedIds.includes(from)) && connectedIds[0]) setFrom(connectedIds[0]);
  }, [connectedIds, lists, listErr, load, from]);

  const info = (r: ModelRef) => lists[r.provider]?.find((m) => m.id === r.model);

  /** Save a new order (and set of models): first = main, the rest = backups in order. */
  async function saveChain(next: ModelRef[]) {
    const providers: NonNullable<SettingsPatch["providers"]> = {};
    for (const p of new Set([...connectedIds, ...next.map((r) => r.provider)])) {
      const models = next.filter((r) => r.provider === p).map((r) => r.model);
      const cur = s.providers[p]?.model;
      providers[p] = { models, model: next[0]?.provider === p ? next[0].model : cur && models.includes(cur) ? cur : (models[0] ?? "") };
    }
    return post({ ...(next[0] ? { active: next[0].provider } : {}), providers, fallbacks: next.slice(1) });
  }

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    onMsg(null);
    try {
      await fn();
    } catch (e) {
      onMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const move = (i: number, d: number) =>
    run(`move-${i}`, async () => {
      const next = [...chain];
      const [x] = next.splice(i, 1);
      if (x) next.splice(Math.max(0, Math.min(next.length, i + d)), 0, x);
      await saveChain(next);
    });

  const remove = (r: ModelRef) =>
    run(`rm-${refKey(r)}`, async () => {
      await saveChain(chain.filter((x) => !sameRef(x, r)));
      onMsg({ ok: true, text: t("models.removed", { model: r.model }) });
    });

  const add = (r: ModelRef) =>
    run(`add-${refKey(r)}`, async () => {
      if (chain.some((x) => sameRef(x, r))) return;
      await saveChain([...chain, r]);
      onMsg({ ok: true, text: t("models.addedMsg", { model: r.model }) });
    });

  const test = (r: ModelRef) =>
    run(`test-${refKey(r)}`, async () => {
      const j = (await fetch("/api/settings/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(r) }).then((x) => x.json())) as { ok: boolean; ms?: number; error?: string; note?: string };
      onMsg(j.ok ? { ok: true, text: `${t("models.works", { model: r.model, ms: j.ms ?? 0 })}${j.note ? ` ${j.note}` : ""}` } : { ok: false, text: j.error ?? t("models.failed") });
    });

  const connect = (p: ProviderId) =>
    run(`connect-${p}`, async () => {
      const key = (keys[p] ?? "").trim();
      const url = (urls[p] ?? "").trim();
      if (PROVIDERS[p].needsKey && !key && !s.providers[p]?.hasKey) throw new Error(t("models.needKey"));
      const wasConnected = isConnected(s, p);
      const patch: NonNullable<SettingsPatch["providers"]>[ProviderId] = {};
      if (key) patch.apiKey = key;
      if (urls[p] !== undefined) patch.baseUrl = url;
      if (!wasConnected && !PROVIDERS[p].needsKey) patch.models = [PROVIDERS[p].model].filter(Boolean);
      let next = await post({ providers: { [p]: patch } });
      // First model ever: make it the main one.
      if (!isConnected(s, s.active) && isConnected(next, p)) next = await post({ active: p });
      setKeys((k) => ({ ...k, [p]: "" }));
      setEditing(null);
      setFrom(p);
      void load(p, true);
      onMsg({ ok: true, text: t("models.connectedMsg", { provider: providerName(p), model: providerModels(next, p).join(", ") || "-" }) });
    });

  const disconnect = (p: ProviderId) =>
    run(`disc-${p}`, async () => {
      await saveChain(chain.filter((r) => r.provider !== p));
      await post({ providers: { [p]: PROVIDERS[p].needsKey ? { clearKey: true } : { models: [], model: "", baseUrl: "" } } });
      setLists((m) => ({ ...m, [p]: undefined }));
      onMsg({ ok: true, text: t("models.disconnected", { provider: providerName(p) }) });
    });

  const addFree = () =>
    run("free", async () => {
      const sources = (["gemini", "openrouter"] as ProviderId[]).filter((p) => isConnected(s, p));
      if (!sources.length) throw new Error(t("models.needFreeKey"));
      const picks: ModelRef[] = [];
      for (const p of sources) {
        const list = await load(p, true);
        const best =
          p === "gemini"
            ? list.filter((m) => /flash/.test(m.id) && !/preview|exp|thinking|8b/.test(m.id)).sort((a, b) => Number(/latest/.test(b.id)) - Number(/latest/.test(a.id)) || b.id.localeCompare(a.id)).slice(0, 2)
            : list.filter((m) => m.free && m.tools).sort((a, b) => (b.context ?? 0) - (a.context ?? 0)).slice(0, 3);
        for (const m of best) picks.push({ provider: p, model: m.id });
      }
      const next = [...chain, ...picks.filter((r) => !chain.some((x) => sameRef(x, r)))];
      await saveChain(next);
      onMsg({ ok: true, text: t("models.freeDone", { count: next.length - chain.length }) });
    });

  const pickList = from ? (lists[from] ?? []) : [];
  const q = query.trim().toLowerCase();
  const shown = pickList.filter((m) => !q || m.id.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q)).slice(0, 60);
  const enabled = enabledRefs(s);
  const nice = (m: ModelInfo | undefined, id: string) => (m?.name ? m.name.replace(/^[^:]+:\s*/, "") : id);

  return (
    <>
      <p className="lead">{t("models.lead")}</p>

      {/* ---- your models, in order ---- */}
      <div className="card">
        <h3 className="card-h">{t("models.yours")}</h3>
        {chain.length === 0 ? (
          <p className="note">{t("models.none")}</p>
        ) : (
          <>
            <p className="note">{t("models.yoursHint")}</p>
            <ol className="mlist">
              {chain.map((r, i) => {
                const m = info(r);
                return (
                  <li key={refKey(r)} className="mrow">
                    <span className="fb-num">{i + 1}</span>
                    <div className="mrow-main">
                      <b>{nice(m, r.model)}</b>
                      <span className="muted">
                        {providerName(r.provider)}
                        {m?.name ? ` · ${r.model}` : ""}
                      </span>
                    </div>
                    {i === 0 && <span className="badge ok">{t("models.main")}</span>}
                    {m?.tools === false && <span className="badge">{t("models.noTools")}</span>}
                    <span className="mprice">{priceText(m, labels)}</span>
                    <div className="mrow-actions">
                      <button className="icon-btn sm" onClick={() => void move(i, -1)} disabled={i === 0 || !!busy} title={t("models.up")} aria-label={t("models.up")}>↑</button>
                      <button className="icon-btn sm" onClick={() => void move(i, 1)} disabled={i === chain.length - 1 || !!busy} title={t("models.down")} aria-label={t("models.down")}>↓</button>
                      <button className="btn sm" onClick={() => void test(r)} disabled={!!busy}>
                        {busy === `test-${refKey(r)}` ? t("models.testing") : t("models.test")}
                      </button>
                      <button className="icon-btn sm" onClick={() => void remove(r)} disabled={!!busy} title={t("common.remove")} aria-label={t("common.remove")}>
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="note">{t("models.priceHint")}</p>
          </>
        )}
      </div>

      {/* ---- add a model ---- */}
      <div className="card">
        <h3 className="card-h">{t("models.add")}</h3>
        {connectedIds.length === 0 ? (
          <p className="note">{t("models.pickProvider")}</p>
        ) : (
          <>
            <div className="mpick-bar">
              <div className="seg-tabs" role="tablist">
                {connectedIds.map((p) => (
                  <button key={p} role="tab" aria-selected={from === p} className={from === p ? "on" : ""} onClick={() => setFrom(p)}>
                    {providerName(p)}
                  </button>
                ))}
              </div>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("models.search")} aria-label={t("models.search")} />
            </div>
            {from && listErr[from] && <p className="msg-err">{listErr[from]}</p>}
            {from && !lists[from] && !listErr[from] && <p className="note">{t("models.loading")}</p>}
            <ul className="mpick">
              {shown.map((m) => {
                const r = { provider: from as ProviderId, model: m.id };
                const on = enabled.some((x) => sameRef(x, r));
                return (
                  <li key={m.id}>
                    <div className="mrow-main">
                      <b>{nice(m, m.id)}</b>
                      <span className="muted">{m.name ? m.id : ""}</span>
                    </div>
                    {m.tools === false && <span className="badge">{t("models.noTools")}</span>}
                    <span className="mprice">{priceText(m, labels)}</span>
                    {on ? (
                      <span className="badge ok">{t("models.added")}</span>
                    ) : (
                      <button className="btn sm" onClick={() => void add(r)} disabled={!!busy}>
                        <Icon name="plus" size={14} /> {t("common.add")}
                      </button>
                    )}
                  </li>
                );
              })}
              {from && lists[from] && shown.length === 0 && <li className="note">{t("models.noMatch")}</li>}
            </ul>
          </>
        )}
      </div>

      {/* ---- providers ---- */}
      <div className="card">
        <h3 className="card-h">{t("models.providers")}</h3>
        <div className="prov-grid">
          {PROVIDER_IDS.map((p) => {
            const meta = PROVIDERS[p];
            const on = isConnected(s, p);
            const open = editing === p;
            const hint = s.providers[p]?.keyHint;
            return (
              <div key={p} className={`prov-card${on ? " on" : ""}`}>
                <div className="prov-top">
                  <b>{providerName(p)}</b>
                  {meta.free && <span className="badge ok">{t("models.freeTier")}</span>}
                  <span className="spacer" />
                  <span className={`prov-state${on ? " on" : ""}`}>{on ? `${t("models.connected")}${hint ? ` ${hint}` : ""}` : t("models.notConnected")}</span>
                </div>
                {meta.note && <p className="note">{meta.note}</p>}
                {open ? (
                  <div className="prov-form">
                    {(meta.needsKey || p === "custom") && (
                      <label className="field">
                        {t("models.keyLabel")}{" "}
                        {meta.keyUrl && (
                          <a href={meta.keyUrl} target="_blank" rel="noreferrer noopener">
                            {t("models.getKey")}
                          </a>
                        )}
                        <input type="password" autoComplete="off" value={keys[p] ?? ""} placeholder={s.providers[p]?.hasKey ? t("settings.models.keyPlaceholderSaved") : t("common.pasteKey")} onChange={(e) => setKeys({ ...keys, [p]: e.target.value })} />
                      </label>
                    )}
                    {(!meta.baseUrl || p === "ollama") && (
                      <label className="field">
                        {t("models.serverAddress")}
                        <input value={urls[p] ?? s.providers[p]?.baseUrl ?? ""} placeholder={meta.baseUrl || "https://…/v1"} onChange={(e) => setUrls({ ...urls, [p]: e.target.value })} />
                      </label>
                    )}
                    <div className="row-btns">
                      <button className="btn primary sm" onClick={() => void connect(p)} disabled={!!busy}>
                        {busy === `connect-${p}` ? t("common.loading") : t("models.save")}
                      </button>
                      <button className="btn sm" onClick={() => setEditing(null)}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="row-btns">
                    <button className={`btn sm${on ? "" : " primary"}`} onClick={() => setEditing(p)} disabled={!!busy}>
                      {on ? (meta.needsKey ? t("models.changeKey") : t("models.edit")) : t("models.connect")}
                    </button>
                    {on && (
                      <button className="btn sm" onClick={() => void disconnect(p)} disabled={!!busy}>
                        {t("models.disconnect")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- free models ---- */}
      <div className="card">
        <h3 className="card-h">{t("models.freeSetup")}</h3>
        <p className="note">{t("models.freeSetupText")}</p>
        <button className="btn" onClick={() => void addFree()} disabled={!!busy}>
          {busy === "free" ? t("models.finding") : t("models.freeButton")}
        </button>
      </div>
    </>
  );
}
