"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, refreshSidebar } from "@/lib/client";
import { CHEEKS, EYES, FACE_COLORS, HAIR, MOUTHS, NOSES, SHAPES, TOPS, WEAR, normalizeFace, randomFace, type Face as FaceT, type Mood } from "@/lib/faces";
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from "@/lib/providers-meta";
import type { PublicSettings } from "@/lib/settings";
import type { Bot, BotInput } from "@/lib/types";
import Face from "./Face";
import { useI18n } from "./I18n";
import Icon from "./Icon";

// Role name: bot.preset.<id>; instructions: bot.preset.<id>.text (in the UI language).
const PRESETS: { id: "assistant" | "researcher" | "writer" | "critic" | "social" | "planner" | "shopper" | "coder"; tools: BotInput["tools"] }[] = [
  { id: "assistant", tools: { web: true, browser: true } },
  { id: "researcher", tools: { web: true, browser: true } },
  { id: "writer", tools: { web: false, browser: false } },
  { id: "critic", tools: { web: true, browser: false } },
  { id: "social", tools: { web: true, browser: true, accounts: true } },
  { id: "planner", tools: { web: true, browser: false } },
  { id: "shopper", tools: { web: true, browser: true } },
  { id: "coder", tools: { web: false, browser: false } },
];

// Labels: bot.mood.<mood>.
const MOODS = ["online", "thinking", "reading", "computer", "working", "asking", "happy", "sad", "sleeping"] as const satisfies readonly Mood[];

export default function BotEditor({ id }: { id: string }) {
  const router = useRouter();
  const isNew = id === "new";
  const [d, setD] = useState<BotInput | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [mood, setMood] = useState<Mood>("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [servers, setServers] = useState<{ id: string; name: string; enabled: boolean; tools: unknown[] }[]>([]);
  const [modelList, setModelList] = useState<Partial<Record<ProviderId, { id: string; free?: boolean; tools?: boolean }[]>>>({});
  const [modelState, setModelState] = useState<Partial<Record<ProviderId, "loading" | "error" | "ok">>>({});
  const [customModel, setCustomModel] = useState(false);
  const { t, rich } = useI18n();
  const pickedProvider = d?.provider;

  // Load the chosen provider's real model list for the dropdown.
  useEffect(() => {
    if (!pickedProvider || modelState[pickedProvider]) return;
    setModelState((s) => ({ ...s, [pickedProvider]: "loading" }));
    fetch(`/api/models?provider=${pickedProvider}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((j: { models: { id: string; free?: boolean; tools?: boolean }[] }) => {
        setModelList((m) => ({ ...m, [pickedProvider]: j.models }));
        setModelState((s) => ({ ...s, [pickedProvider]: "ok" }));
      })
      .catch(() => setModelState((s) => ({ ...s, [pickedProvider]: "error" })));
  }, [pickedProvider, modelState]);

  useEffect(() => {
    (async () => {
      try {
        setSettings(await api<PublicSettings>("/api/settings"));
        setServers(await api<{ id: string; name: string; enabled: boolean; tools: unknown[] }[]>("/api/mcp").catch(() => []));
        if (isNew) setD({ name: "", role: "", instructions: "", face: randomFace(), tools: { web: true, browser: true, accounts: false } });
        else {
          const { id: _id, createdAt: _c, ...rest } = await api<Bot>(`/api/bots/${id}`);
          setD({ ...rest, face: normalizeFace(rest.face) });
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id, isNew]);

  if (!d) return <div className="page center muted">{error ?? t("common.loading")}</div>;

  const set = (p: Partial<BotInput>) => {
    setD({ ...d, ...p });
    setSaved(false);
  };
  const setFace = (p: Partial<FaceT>) => set({ face: { ...d.face, ...p } });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify(d);
      const bot = isNew ? await api<Bot>("/api/bots", { method: "POST", body }) : await api<Bot>(`/api/bots/${id}`, { method: "PUT", body });
      refreshSidebar();
      if (isNew) router.push(`/c/dm-${bot.id}`);
      else setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!d || !confirm(t("bot.confirmDelete", { name: d.name }))) return;
    try {
      await api(`/api/bots/${id}`, { method: "DELETE" });
      refreshSidebar();
      router.push("/");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Thumbnails drop an accessory that would hide the part being picked
  // (a hat hides hair, sunglasses hide eyes) so every option is visible.
  const topName = TOPS[d.face.top];
  const wearName = WEAR[d.face.wear];
  const reveal = (key: keyof FaceT): Partial<FaceT> =>
    key === "hair" && (topName === "hat" || topName === "beret" || topName === "cap") ? { top: 0 } : key === "eyes" && (wearName === "shades" || wearName === "patch") ? { wear: 0 } : {};

  const options = (label: string, list: readonly string[], key: keyof FaceT) => (
    <div className="opt-group">
      <div className="opt-label">{label}</div>
      <div className="opt-grid">
        {list.map((name, i) => (
          <button type="button" key={name} className={`opt${d.face[key] === i ? " on" : ""}`} onClick={() => setFace({ [key]: i, ...reveal(key) })} title={name} aria-label={`${label}: ${name}`} aria-pressed={d.face[key] === i}>
            <Face face={{ ...d.face, [key]: i, ...reveal(key) }} size={48} />
          </button>
        ))}
      </div>
    </div>
  );

  const def = settings ? t("bot.default", { provider: PROVIDERS[settings.active].label, model: settings.providers[settings.active]?.model || PROVIDERS[settings.active].model }) : t("bot.defaultPlain");
  const provider = d.provider;

  return (
    <div className="page editor">
      <aside className="editor-preview">
        <div className="preview-card">
          <Face face={d.face} mood={mood} size={176} interactive title={t("bot.squishTitle", { name: d.name || t("common.newBot") })} />
          <div className="preview-name">{d.name || t("common.newBot")}</div>
          <div className="preview-role" style={{ background: FACE_COLORS[d.face.color] }}>{d.role || t("bot.noRole")}</div>
          <p className="hint">{t("bot.squishHint")}</p>
          <div className="mood-row" role="group" aria-label={t("bot.previewMood")}>
            {MOODS.map((m) => (
              <button key={m} type="button" className={`chip${mood === m ? " on" : ""}`} onClick={() => setMood(m)}>
                {t(`bot.mood.${m}`)}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => setFace(randomFace())}>
            <Icon name="shuffle" size={16} /> {t("bot.shuffleLook")}
          </button>
        </div>
      </aside>

      <div className="editor-form">
        <h1>{isNew ? t("common.newBot") : t("bot.editTitle", { name: d.name })}</h1>

        {isNew && (
          <div className="presets">
            <div className="opt-label">{t("bot.startFrom")}</div>
            <div className="chip-row">
              {PRESETS.map((p) => {
                const role = t(`bot.preset.${p.id}`);
                return (
                  <button key={p.id} type="button" className={`chip${d.role === role ? " on" : ""}`} onClick={() => set({ role, instructions: t(`bot.preset.${p.id}.text`), tools: { accounts: false, ...p.tools } })}>
                    {role}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <section className="card">
          <h2>{t("bot.about")}</h2>
          <div className="grid2">
            <label className="field">
              {t("common.name")}
              <input value={d.name} maxLength={24} placeholder={t("bot.namePh")} onChange={(e) => set({ name: e.target.value.replace(/\s+/g, "") })} />
              <span className="hint">{t("bot.nameHint", { name: d.name || t("bot.nameFallback") })}</span>
            </label>
            <label className="field">
              {t("bot.role")}
              <input value={d.role} maxLength={40} placeholder={t("bot.rolePh")} onChange={(e) => set({ role: e.target.value })} />
              <span className="hint">{t("bot.roleHint")}</span>
            </label>
          </div>
          <label className="field">
            {t("bot.instructions")}
            <textarea rows={5} value={d.instructions} placeholder={t("bot.instructionsPh")} onChange={(e) => set({ instructions: e.target.value })} />
          </label>
        </section>

        <section className="card">
          <h2>{t("bot.look")}</h2>
          <div className="opt-group">
            <div className="opt-label">{t("bot.color")}</div>
            <div className="swatches">
              {FACE_COLORS.map((c, i) => (
                <button key={c} type="button" className={`swatch${d.face.color === i ? " on" : ""}`} style={{ background: c }} onClick={() => setFace({ color: i })} aria-label={t("bot.colorN", { n: i + 1 })} aria-pressed={d.face.color === i} />
              ))}
            </div>
          </div>
          {options(t("bot.part.body"), SHAPES, "shape")}
          {options(t("bot.part.hair"), HAIR, "hair")}
          {options(t("bot.part.eyes"), EYES, "eyes")}
          {options(t("bot.part.cheeks"), CHEEKS, "cheeks")}
          {options(t("bot.part.mouth"), MOUTHS, "mouth")}
          {options(t("bot.part.nose"), NOSES, "nose")}
          {options(t("bot.part.top"), TOPS, "top")}
          {options(t("bot.part.wear"), WEAR, "wear")}
        </section>

        <section className="card">
          <h2>{t("bot.brain")}</h2>
          <p className="muted">{t("bot.brainSub")}</p>
          <div className="grid2">
            <label className="field">
              {t("bot.provider")}
              <select value={provider ?? ""} onChange={(e) => { setCustomModel(false); set({ provider: (e.target.value || undefined) as ProviderId | undefined, model: undefined }); }}>
                <option value="">{def}</option>
                {PROVIDER_IDS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDERS[p].label}
                    {PROVIDERS[p].needsKey && !settings?.providers[p]?.hasKey ? t("bot.noKeyYet") : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("common.model")}
              {!provider ? (
                <input value="" disabled placeholder={t("bot.usesDefault")} />
              ) : modelList[provider]?.length && !customModel ? (
                <select
                  value={d.model ?? ""}
                  onChange={(e) => (e.target.value === "__custom" ? setCustomModel(true) : set({ model: e.target.value || undefined }))}
                >
                  <option value="">{t("bot.providerDefault", { model: settings?.providers[provider]?.model || PROVIDERS[provider].model || t("bot.none") })}</option>
                  {d.model && !modelList[provider]?.some((m) => m.id === d.model) && <option value={d.model}>{d.model}</option>}
                  {modelList[provider]?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                      {m.free ? `  · ${t("common.free")}` : ""}
                      {m.tools === false ? `  · ${t("common.noTools")}` : ""}
                    </option>
                  ))}
                  <option value="__custom">{t("bot.otherModel")}</option>
                </select>
              ) : (
                <input
                  value={d.model ?? ""}
                  placeholder={settings?.providers[provider]?.model || PROVIDERS[provider].model || t("common.modelName")}
                  onChange={(e) => set({ model: e.target.value || undefined })}
                />
              )}
              {provider && modelState[provider] === "loading" && <span className="hint">{t("bot.loadingModels")}</span>}
              {provider && modelState[provider] === "error" && <span className="hint">{t("bot.cantList")}</span>}
            </label>
          </div>
        </section>

        <section className="card">
          <h2>{t("bot.abilities")}</h2>
          <label className="toggle">
            <input type="checkbox" checked={d.tools.web} onChange={(e) => set({ tools: { ...d.tools, web: e.target.checked } })} />
            <span className="toggle-ui" />
            <span>
              <b>{t("bot.web")}</b>
              <span className="hint">{t("bot.webHint")}</span>
            </span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={d.tools.browser} onChange={(e) => set({ tools: { ...d.tools, browser: e.target.checked, accounts: e.target.checked && !!d.tools.accounts } })} />
            <span className="toggle-ui" />
            <span>
              <b>{t("bot.browser")}</b>
              <span className="hint">{t("bot.browserHint")}</span>
            </span>
          </label>
          <label className={`toggle${d.tools.browser ? "" : " disabled"}`}>
            <input type="checkbox" disabled={!d.tools.browser} checked={!!d.tools.accounts} onChange={(e) => set({ tools: { ...d.tools, accounts: e.target.checked } })} />
            <span className="toggle-ui" />
            <span>
              <b>{t("bot.accounts")}</b>
              <span className="hint">{rich("bot.accountsHint", { link: <Link href="/settings">{t("bot.accountsLink")}</Link>, every: <b>{t("bot.every")}</b> })}</span>
            </span>
          </label>

          <div className="opt-label" style={{ marginTop: 14 }}>{t("bot.mcp")}</div>
          {servers.length === 0 ? (
            <p className="note">{rich("bot.noMcp", { link: <Link href="/library">{t("common.skillsTools")}</Link> })}</p>
          ) : (
            <div className="chip-row">
              {servers.map((srv) => {
                const on = (d.tools.mcp ?? []).includes(srv.id);
                return (
                  <button
                    key={srv.id}
                    type="button"
                    className={`chip big${on ? " on" : ""}`}
                    disabled={!srv.enabled}
                    title={srv.enabled ? undefined : t("bot.serverOff")}
                    onClick={() => set({ tools: { ...d.tools, mcp: on ? (d.tools.mcp ?? []).filter((x) => x !== srv.id) : [...(d.tools.mcp ?? []), srv.id] } })}
                    aria-pressed={on}
                  >
                    {on && <Icon name="check" size={14} />} {srv.name}
                  </button>
                );
              })}
            </div>
          )}
          <p className="note">{t("bot.skillsNote")}</p>
        </section>

        <div className="savebar">
          <button className="btn primary" onClick={save} disabled={saving || !d.name}>
            {isNew ? t("bot.create") : t("common.save")}
          </button>
          {!isNew && (
            <Link className="btn" href={`/c/dm-${id}`}>
              {t("bot.chatWith", { name: d.name })}
            </Link>
          )}
          {saved && <span className="msg-ok">{t("common.saved")}</span>}
          {error && <span className="msg-err">{error}</span>}
          <span className="spacer" />
          {!isNew && (
            <button className="btn danger" onClick={remove}>
              <Icon name="trash" size={16} /> {t("common.delete")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
