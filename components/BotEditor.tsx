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
import Icon from "./Icon";

const PRESETS: { role: string; tools: BotInput["tools"]; instructions: string }[] = [
  {
    role: "Personal assistant",
    tools: { web: true, browser: true },
    instructions:
      "You are the user's personal assistant and team leader. Understand what they really want, keep track of their preferences, answer directly when you can, delegate bigger jobs to the right teammates and combine their work into one clear answer. Always end with a clear result or next step.",
  },
  { role: "Researcher", tools: { web: true, browser: true }, instructions: "Find accurate, current information on the web. Check more than one source and list the URLs you used. Keep notes short and factual." },
  { role: "Writer", tools: { web: false, browser: false }, instructions: "Turn notes and ideas into clear, friendly writing. Match the tone the user asks for. Use short paragraphs." },
  { role: "Critic", tools: { web: true, browser: false }, instructions: "Review work from the user or teammates. Point out errors, gaps and risks, then suggest concrete fixes. Be direct but kind." },
  { role: "Social manager", tools: { web: true, browser: true, accounts: true }, instructions: "Draft posts and replies in the user's voice. Show the exact text and get the user's OK before posting anything. Keep replies short, friendly and on-topic." },
  { role: "Planner", tools: { web: true, browser: false }, instructions: "Break goals into clear steps with dates, owners and risks. Keep plans realistic and short." },
  { role: "Shopper", tools: { web: true, browser: true }, instructions: "Compare products and prices across shops. Reply with a short table and links. Never buy anything." },
  { role: "Coder", tools: { web: false, browser: false }, instructions: "Write clean, working code with short explanations. Ask before making big assumptions." },
];

const MOODS: { mood: Mood; label: string }[] = [
  { mood: "idle", label: "Idle" },
  { mood: "thinking", label: "Thinking" },
  { mood: "working", label: "Working" },
  { mood: "asking", label: "Asking" },
  { mood: "happy", label: "Done" },
  { mood: "sad", label: "Stuck" },
];

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

  if (!d) return <div className="page center muted">{error ?? "Loading…"}</div>;

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
    if (!d || !confirm(`Delete ${d.name}? Their 1:1 chat is deleted and they leave every group.`)) return;
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

  const def = settings ? `Default (${PROVIDERS[settings.active].label} · ${settings.providers[settings.active]?.model || PROVIDERS[settings.active].model})` : "Default";
  const provider = d.provider;

  return (
    <div className="page editor">
      <aside className="editor-preview">
        <div className="preview-card">
          <Face face={d.face} mood={mood} size={176} interactive title={`${d.name || "New bot"}: press to squish`} />
          <div className="preview-name">{d.name || "New bot"}</div>
          <div className="preview-role" style={{ background: FACE_COLORS[d.face.color] }}>{d.role || "No role yet"}</div>
          <p className="hint">Press the slime to squish it.</p>
          <div className="mood-row" role="group" aria-label="Preview expression">
            {MOODS.map((m) => (
              <button key={m.mood} type="button" className={`chip${mood === m.mood ? " on" : ""}`} onClick={() => setMood(m.mood)}>
                {m.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => setFace(randomFace())}>
            <Icon name="shuffle" size={16} /> Shuffle look
          </button>
        </div>
      </aside>

      <div className="editor-form">
        <h1>{isNew ? "New bot" : `Edit ${d.name}`}</h1>

        {isNew && (
          <div className="presets">
            <div className="opt-label">Start from a role</div>
            <div className="chip-row">
              {PRESETS.map((p) => (
                <button key={p.role} type="button" className={`chip${d.role === p.role ? " on" : ""}`} onClick={() => set({ role: p.role, instructions: p.instructions, tools: { accounts: false, ...p.tools } })}>
                  {p.role}
                </button>
              ))}
            </div>
          </div>
        )}

        <section className="card">
          <h2>About</h2>
          <div className="grid2">
            <label className="field">
              Name
              <input value={d.name} maxLength={24} placeholder="e.g. Scout" onChange={(e) => set({ name: e.target.value.replace(/\s+/g, "") })} />
              <span className="hint">One word. In groups, people type @{d.name || "Name"} to call this bot.</span>
            </label>
            <label className="field">
              Role
              <input value={d.role} maxLength={40} placeholder="e.g. Researcher" onChange={(e) => set({ role: e.target.value })} />
              <span className="hint">Shown to teammates so they know when to ask.</span>
            </label>
          </div>
          <label className="field">
            Instructions
            <textarea rows={5} value={d.instructions} placeholder="What should this bot focus on? How should it talk? What should it never do?" onChange={(e) => set({ instructions: e.target.value })} />
          </label>
        </section>

        <section className="card">
          <h2>Look</h2>
          <div className="opt-group">
            <div className="opt-label">Color</div>
            <div className="swatches">
              {FACE_COLORS.map((c, i) => (
                <button key={c} type="button" className={`swatch${d.face.color === i ? " on" : ""}`} style={{ background: c }} onClick={() => setFace({ color: i })} aria-label={`Color ${i + 1}`} aria-pressed={d.face.color === i} />
              ))}
            </div>
          </div>
          {options("Body", SHAPES, "shape")}
          {options("Hair", HAIR, "hair")}
          {options("Eyes", EYES, "eyes")}
          {options("Cheeks", CHEEKS, "cheeks")}
          {options("Mouth", MOUTHS, "mouth")}
          {options("Nose", NOSES, "nose")}
          {options("On the head", TOPS, "top")}
          {options("On the face", WEAR, "wear")}
        </section>

        <section className="card">
          <h2>Brain</h2>
          <p className="muted">Mix models in one group, for example Grok for research and Claude for writing. If this model fails or hits a limit, the backup models from Settings take over automatically.</p>
          <div className="grid2">
            <label className="field">
              Model provider
              <select value={provider ?? ""} onChange={(e) => set({ provider: (e.target.value || undefined) as ProviderId | undefined, model: undefined })}>
                <option value="">{def}</option>
                {PROVIDER_IDS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDERS[p].label}
                    {PROVIDERS[p].needsKey && !settings?.providers[p]?.hasKey ? " (no key yet)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Model
              <input
                value={d.model ?? ""}
                disabled={!provider}
                placeholder={provider ? settings?.providers[provider]?.model || PROVIDERS[provider].model || "model name" : "Uses the default"}
                onChange={(e) => set({ model: e.target.value || undefined })}
              />
            </label>
          </div>
        </section>

        <section className="card">
          <h2>Abilities</h2>
          <label className="toggle">
            <input type="checkbox" checked={d.tools.web} onChange={(e) => set({ tools: { ...d.tools, web: e.target.checked } })} />
            <span className="toggle-ui" />
            <span>
              <b>Web search</b>
              <span className="hint">Look things up with your search provider.</span>
            </span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={d.tools.browser} onChange={(e) => set({ tools: { ...d.tools, browser: e.target.checked, accounts: e.target.checked && !!d.tools.accounts } })} />
            <span className="toggle-ui" />
            <span>
              <b>Browser</b>
              <span className="hint">Open pages, read them, click, type and download files. Clicks and typing ask you first.</span>
            </span>
          </label>
          <label className={`toggle${d.tools.browser ? "" : " disabled"}`}>
            <input type="checkbox" disabled={!d.tools.browser} checked={!!d.tools.accounts} onChange={(e) => set({ tools: { ...d.tools, accounts: e.target.checked } })} />
            <span className="toggle-ui" />
            <span>
              <b>Use my signed-in accounts</b>
              <span className="hint">
                Post, reply to comments and download as you, on sites you signed in to under <Link href="/settings">Settings → Your accounts</Link>. This bot asks before <b>every</b> click and keystroke, and never sees your passwords.
              </span>
            </span>
          </label>

          <div className="opt-label" style={{ marginTop: 14 }}>Tools from MCP servers</div>
          {servers.length === 0 ? (
            <p className="note">
              No MCP servers yet. Add some (files, GitHub, Notion…) in <Link href="/library">Skills &amp; tools</Link>.
            </p>
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
                    title={srv.enabled ? undefined : "This server is turned off in Skills & tools"}
                    onClick={() => set({ tools: { ...d.tools, mcp: on ? (d.tools.mcp ?? []).filter((x) => x !== srv.id) : [...(d.tools.mcp ?? []), srv.id] } })}
                    aria-pressed={on}
                  >
                    {on && <Icon name="check" size={14} />} {srv.name}
                  </button>
                );
              })}
            </div>
          )}
          <p className="note">Every bot can also use and save skills from your library.</p>
        </section>

        <div className="savebar">
          <button className="btn primary" onClick={save} disabled={saving || !d.name}>
            {isNew ? "Create bot" : "Save"}
          </button>
          {!isNew && (
            <Link className="btn" href={`/c/dm-${id}`}>
              Chat with {d.name}
            </Link>
          )}
          {saved && <span className="msg-ok">Saved.</span>}
          {error && <span className="msg-err">{error}</span>}
          <span className="spacer" />
          {!isNew && (
            <button className="btn danger" onClick={remove}>
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
