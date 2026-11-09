"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, refreshSidebar, scrollIntoArea } from "@/lib/client";
import { CHEEKS, EYES, FACE_COLORS, HAIR, MOUTHS, NOSES, SHAPES, TOPS, WEAR, normalizeFace, randomFace, type Face as FaceT, type Mood } from "@/lib/faces";
import { chainOf, enabledRefs, priceText, refKey, type ModelInfo } from "@/lib/model-list";
import { PROVIDER_IDS, PROVIDERS, providerName, type ProviderId } from "@/lib/providers-meta";
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
  const [lists, setLists] = useState<Partial<Record<ProviderId, ModelInfo[]>>>({});
  const [isMain, setIsMain] = useState(false);
  const [wasMain, setWasMain] = useState(false);
  const { t, rich } = useI18n();

  // Prices for the models the user switched on.
  useEffect(() => {
    if (!settings) return;
    for (const p of new Set(enabledRefs(settings).map((r) => r.provider))) {
      fetch(`/api/models?provider=${p}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ models: ModelInfo[] }>) : Promise.reject(new Error())))
        .then((j) => setLists((m) => ({ ...m, [p]: j.models })))
        .catch(() => {});
    }
  }, [settings]);

  useEffect(() => {
    (async () => {
      try {
        setSettings(await api<PublicSettings>("/api/settings"));
        setServers(await api<{ id: string; name: string; enabled: boolean; tools: unknown[] }[]>("/api/mcp").catch(() => []));
        const main = await api<{ botId: string | null }>("/api/main").catch(() => ({ botId: null }));
        setWasMain(!isNew && main.botId === id);
        setIsMain(!isNew && main.botId === id);
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

  // Opened from a chat link (oovi://bot/<name>): jump to Abilities, where connectors are switched on.
  const loaded = !!d;
  useEffect(() => {
    if (!loaded || window.location.hash !== "#abilities") return;
    const el = document.getElementById("abilities");
    if (!el) return;
    scrollIntoArea(el);
    el.classList.add("flash");
    const timer = setTimeout(() => el.classList.remove("flash"), 2400);
    return () => clearTimeout(timer);
  }, [loaded]);

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
      if (isMain && !wasMain) {
        await api("/api/main", { method: "PUT", body: JSON.stringify({ botId: bot.id }) });
        setWasMain(true);
      }
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

  const main = settings ? chainOf(settings)[0] : undefined;
  const def = main ? t("bot.defaultModel", { model: main.model, provider: providerName(main.provider) }) : t("bot.defaultPlain");
  const mine = settings ? enabledRefs(settings) : [];
  const picked = d.provider && d.model ? `${d.provider}:${d.model}` : "";
  const pickedMissing = !!picked && !mine.some((r) => refKey(r) === picked);
  const priceLabels = { free: t("models.free"), perM: t("models.perM") };
  const optionText = (p: ProviderId, model: string) => {
    const price = priceText(lists[p]?.find((m) => m.id === model), priceLabels);
    return price ? `${model}  ·  ${price}` : model;
  };

  return (
    <div className="page editor">
      <aside className="editor-preview">
        <div className="preview-card">
          <Face face={d.face} mood={mood} size={176} interactive title={t("bot.squishTitle", { name: d.name || t("common.newBot") })} />
          <div className="preview-name">
            {d.name || t("common.newBot")}
            {wasMain && (
              <span className="chief-tag" title={t("chief.what")}>
                {t("chief.title")}
              </span>
            )}
          </div>
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
        {wasMain && (
          <div className="chief-note">
            <span className="chief-tag">{t("chief.title")}</span>
            <p>{t("chief.is", { name: d.name })}</p>
          </div>
        )}

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
          <label className="field">
            {t("common.model")}
            <select
              value={picked}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return set({ provider: undefined, model: undefined });
                const i = v.indexOf(":");
                set({ provider: v.slice(0, i) as ProviderId, model: v.slice(i + 1) });
              }}
            >
              <option value="">{def}</option>
              {pickedMissing && d.provider && (
                <option value={picked}>
                  {t("bot.modelOff", { model: d.model ?? "", provider: providerName(d.provider) })}
                </option>
              )}
              {PROVIDER_IDS.filter((p) => mine.some((r) => r.provider === p)).map((p) => (
                <optgroup key={p} label={PROVIDERS[p].label}>
                  {mine
                    .filter((r) => r.provider === p)
                    .map((r) => (
                      <option key={refKey(r)} value={refKey(r)}>
                        {optionText(p, r.model)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <span className="hint">
              {mine.length === 0 ? t("bot.noModelsYet") : t("bot.modelHint")}{" "}
              <Link
                href="/settings"
                onClick={() => {
                  try {
                    localStorage.setItem("oovi.settings.tab", "models");
                  } catch {
                    /* storage unavailable */
                  }
                }}
              >
                {t("bot.manageModels")}
              </Link>
            </span>
          </label>
        </section>

        <section className="card" id="abilities">
          <h2>{t("bot.abilities")}</h2>
          <label className="toggle">
            <input type="checkbox" checked={isMain} disabled={wasMain} onChange={(e) => setIsMain(e.target.checked)} />
            <span className="toggle-ui" />
            <span>
              <b>{wasMain ? t("chief.title") : t("chief.make")}</b>
              <span className="hint">{wasMain ? t("chief.what") : t("chief.makeHint")}</span>
            </span>
          </label>
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
