"use client";

// Tap a bot's face to edit it, a group's face to edit the group (owner, 2026-11-19). Like the computer's editors
// (components/BotEditor.tsx, GroupEditor.tsx), without what only the computer can do: no model or key choice (the
// phone and the web use theOovi), and "for all bots" features (control the computer, its files) shown as "On your
// computer". Saves go to the account's setup in the computer's own item shapes, only the fields changed here (read
// again and applied again on a conflict); the computer applies them at its next setup sync.
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { CHEEKS, EYES, FACE_COLORS, HAIR, MOUTHS, NOSES, SHAPES, TOPS, WEAR, normalizeFace, randomFace, slimeOf, type Face as FaceT } from "@/lib/faces";
import FaceView, { FaceStack } from "@/components/Face";
import { getSetup } from "../_lib/api";
import { BOT_LIMITS, botNameProblem, dmId, editBotItem, editGroupItem, type BotPatch } from "../_lib/core";
import { tap } from "../_lib/haptics";
import { to } from "../_lib/route";
import { Icon } from "./Icon";
import { ActionSheet, LargeTitle, NavBar, OfflineBar, Section, Spinner, Switch } from "./kit";
import { useM } from "./MobileApp";

type Key = Parameters<ReturnType<typeof useM>["t"]>[0];
type LookTab = "color" | "shape" | "hair" | "eyes" | "cheeks" | "mouth" | "nose" | "top" | "wear" | "picture";
const LOOK_TABS: LookTab[] = ["color", "shape", "hair", "eyes", "cheeks", "mouth", "nose", "top", "wear", "picture"];
const LOOK_LABEL: Record<LookTab, Key> = {
  color: "ed.bot.color",
  shape: "ed.bot.part.body",
  hair: "ed.bot.part.hair",
  eyes: "ed.bot.part.eyes",
  cheeks: "ed.bot.part.cheeks",
  mouth: "ed.bot.part.mouth",
  nose: "ed.bot.part.nose",
  top: "ed.bot.part.top",
  wear: "ed.bot.part.wear",
  picture: "ed.bot.ownPicture",
};
const LOOK_LIST = { shape: SHAPES, hair: HAIR, eyes: EYES, cheeks: CHEEKS, mouth: MOUTHS, nose: NOSES, top: TOPS, wear: WEAR } as const;

/** A picture cut to a 256 px square PNG, sent to the account (POST /api/v1/avatars): its id goes in face.image. */
async function uploadPicture(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  c.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
  const r = await fetch("/api/v1/avatars", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ png: c.toDataURL("image/png") }) });
  const j = (await r.json().catch(() => null)) as { id?: string; error?: string } | null;
  if (!r.ok || !j?.id || !/^[0-9a-f]{32}$/.test(j.id)) throw new Error(j?.error || "upload");
  return j.id;
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (a: { id: string; "aria-describedby"?: string }) => ReactNode }) {
  const id = useId();
  return (
    <div className="m-efield">
      <label className="m-efield__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, ...(hint ? { "aria-describedby": `${id}-h` } : {}) })}
      {hint && (
        <span className="m-efield__hint" id={`${id}-h`}>
          {hint}
        </span>
      )}
    </div>
  );
}

function ToggleRow({ title, sub, on, onChange, disabled }: { title: string; sub?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="m-row">
      <span className="m-row__main">
        <span className="m-row__title">{title}</span>
        {sub && <span className="m-row__sub m-row__sub--wrap">{sub}</span>}
      </span>
      <Switch on={on} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

function useBack(fallback: string) {
  const router = useRouter();
  return () => (window.history.length > 1 ? router.back() : router.push(fallback));
}

// ---------- a bot ----------

export function BotEditScreen({ botId }: { botId: string }) {
  const { t, setup, editSetup, removeBot, toast } = useM();
  const router = useRouter();
  const back = useBack(to(`/c/${encodeURIComponent(dmId(botId))}`));
  const [item, setItem] = useState<Record<string, unknown> | null | "missing">(null);
  const [isMain, setIsMain] = useState(false);
  const [patch, setPatch] = useState<BotPatch>({});
  const [makeMain, setMakeMain] = useState(false);
  const [lookTab, setLookTab] = useState<LookTab>("color");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pictureBusy, setPictureBusy] = useState(false);
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    let alive = true;
    void getSetup()
      .then((s) => {
        if (!alive) return;
        const it = s?.items?.[`bot:${botId}`];
        setItem(it && typeof it === "object" ? (it as Record<string, unknown>) : "missing");
        setIsMain(s?.items?.main === botId);
      })
      .catch(() => alive && setItem("missing"));
    return () => {
      alive = false;
    };
  }, [botId]);

  const view = useMemo(() => (item && item !== "missing" ? editBotItem(item, patch) : null), [item, patch]);
  if (item === null) return <EditorShell title={t("ed.loading")} back={back} busy />;
  if (item === "missing" || !view) return <EditorShell title={t("ed.bot.editTitle", { name: "" }).trim()} back={back} missing />;

  const face = normalizeFace(view.face) as FaceT;
  const tools = (view.tools ?? {}) as { web?: boolean; browser?: boolean; accounts?: boolean };
  const expert = typeof view.expert === "string" && !!view.expert;
  const set = (p: BotPatch) => {
    setPatch((cur) => ({ ...cur, ...p, ...(p.tools ? { tools: { ...cur.tools, ...p.tools } } : {}) }));
    setNote(null);
  };
  const setFace = (p: Partial<FaceT>) => set({ face: { ...slimeOf(face), ...p } as unknown as Record<string, unknown> });
  const name = String(view.name ?? "");
  const nameProblem = patch.name !== undefined ? botNameProblem(name, (setup?.bots ?? []).filter((b) => b.id !== botId).map((b) => b.name)) : null;
  const changed = Object.keys(patch).length > 0 || makeMain;

  const save = async () => {
    if (nameProblem) return setNote({ ok: false, text: t("ed.errName") });
    setBusy(true);
    const ok = await editSetup((items) => {
      const cur = items[`bot:${botId}`];
      if (!cur || typeof cur !== "object") throw new Error("missing");
      const next = { ...items, [`bot:${botId}`]: editBotItem(cur as Record<string, unknown>, patch) };
      if (makeMain) next.main = botId;
      return next;
    });
    setBusy(false);
    if (!ok) return setNote({ ok: false, text: t("ed.errSave") });
    tap("success");
    setItem(editBotItem(item, patch));
    if (makeMain) setIsMain(true);
    setPatch({});
    setMakeMain(false);
    setNote({ ok: true, text: t("ed.saved") });
  };

  const usePicture = async (file: File) => {
    setPictureBusy(true);
    setNote(null);
    try {
      const id = await uploadPicture(file);
      set({ face: { ...(face as unknown as Record<string, unknown>), image: id } });
    } catch {
      setNote({ ok: false, text: t("ed.errPicture") });
    } finally {
      setPictureBusy(false);
    }
  };

  const typed = (k: keyof typeof LOOK_LIST) => {
    const topName = TOPS[face.top];
    const wearName = WEAR[face.wear];
    const reveal: Partial<FaceT> = k === "hair" && (topName === "hat" || topName === "beret" || topName === "cap") ? { top: 0 } : k === "eyes" && (wearName === "shades" || wearName === "patch") ? { wear: 0 } : {};
    return (
      <div className="m-looks" role="group" aria-label={t(LOOK_LABEL[k])}>
        {LOOK_LIST[k].map((nm, i) => {
          const on = (face[k] ?? 0) === i;
          return (
            <button key={nm} type="button" className={`m-look${on ? " is-on" : ""}`} aria-pressed={on} aria-label={`${t(LOOK_LABEL[k])}: ${nm}`} onClick={() => setFace({ [k]: i, ...reveal } as Partial<FaceT>)}>
              <FaceView face={{ ...slimeOf(face), [k]: i, ...reveal }} size={44} />
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="m-screen m-screen--grouped">
      <NavBar title={t("ed.bot.editTitle", { name })} large back={{ href: to(`/c/${encodeURIComponent(dmId(botId))}`), label: name || t("tab.chats") }} />
      <main className="m-main">
        <LargeTitle>{t("ed.bot.editTitle", { name })}</LargeTitle>
        <OfflineBar />
        <div className="m-edhero">
          <FaceView face={face} size={120} mood="happy" />
          {isMain && <span className="m-pill">{t("ed.chief.title")}</span>}
          <button type="button" className="m-btn m-btn--gray m-btn--sm" onClick={() => (tap(), set({ face: randomFace() as unknown as Record<string, unknown> }))}>
            <Icon name="sparkle" size={16} /> {t("ed.bot.shuffleLook")}
          </button>
        </div>

        <Section header={t("ed.bot.about")} id="ed-about">
          <div className="m-eform">
            <Field label={t("acct.name")} hint={nameProblem ? <span className="is-bad">{t("ed.errName")}</span> : t("ed.bot.nameHint", { name: name || "Sami" })}>
              {(a) => <input {...a} dir="auto" autoComplete="off" maxLength={BOT_LIMITS.name} value={name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!nameProblem} />}
            </Field>
            {expert ? (
              <p className="m-efield__hint m-efield__note">{t("ed.bot.expertPrivate")}</p>
            ) : (
              <>
                <Field label={t("ed.bot.role")} hint={t("ed.bot.roleHint")}>
                  {(a) => <input {...a} dir="auto" autoComplete="off" maxLength={BOT_LIMITS.role} value={String(view.role ?? "")} onChange={(e) => set({ role: e.target.value })} />}
                </Field>
                <Field label={t("ed.bot.roleAbout")} hint={`${t("ed.bot.aboutHint")} (${String(view.about ?? "").length}/${BOT_LIMITS.about})`}>
                  {(a) => <textarea {...a} dir="auto" rows={2} maxLength={BOT_LIMITS.about} value={String(view.about ?? "")} placeholder={t("ed.bot.aboutPh")} onChange={(e) => set({ about: e.target.value })} />}
                </Field>
                <Field label={t("ed.bot.instructions")}>
                  {(a) => <textarea {...a} dir="auto" rows={5} maxLength={BOT_LIMITS.instructions} value={String(view.instructions ?? "")} placeholder={t("ed.bot.instructionsPh")} onChange={(e) => set({ instructions: e.target.value })} />}
                </Field>
              </>
            )}
          </div>
        </Section>

        <Section header={t("ed.bot.look")} id="ed-look">
          <div className="m-looktabs" role="tablist" aria-label={t("ed.bot.look")}>
            {LOOK_TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={lookTab === k} className={`m-chip${lookTab === k ? " is-on" : ""}`} onClick={() => setLookTab(k)}>
                {t(LOOK_LABEL[k])}
              </button>
            ))}
          </div>
          <div className="m-lookpanel" role="tabpanel">
            {lookTab === "color" ? (
              <div className="m-swatches">
                {FACE_COLORS.map((c, i) => (
                  <button key={c} type="button" className={`m-swatch${face.color === i ? " is-on" : ""}`} style={{ background: c }} aria-pressed={face.color === i} aria-label={`${t("ed.bot.color")} ${i + 1}`} onClick={() => setFace({ color: i })} />
                ))}
              </div>
            ) : lookTab === "picture" ? (
              <div className="m-pickpic">
                <p className="m-efield__hint">{t("ed.bot.ownPictureHint")}</p>
                <div className="m-photo__acts">
                  <label className="m-btn m-btn--gray m-btn--sm">
                    {pictureBusy ? <Spinner size={16} /> : <Icon name="plus" size={15} stroke={2.4} />} {t(face.image ? "ed.bot.ownPictureChange" : "ed.bot.ownPictureAdd")}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void usePicture(f);
                      }}
                    />
                  </label>
                  {face.image && (
                    <button type="button" className="m-btn m-btn--plain m-btn--sm" onClick={() => setFace({})}>
                      {t("ed.bot.ownPictureRemove")}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              typed(lookTab)
            )}
          </div>
        </Section>

        <Section header={t("ed.bot.abilities")} id="ed-abilities">
          {!isMain && <ToggleRow title={t("ed.chief.make")} sub={t("ed.chief.makeHint")} on={makeMain} onChange={(v) => (setMakeMain(v), setNote(null))} />}
          {!isMain && <ToggleRow title={t("ed.bot.hide")} sub={t("ed.bot.hideHint")} on={view.hidden === true} onChange={(v) => set({ hidden: v })} />}
          <ToggleRow title={t("ed.bot.web")} sub={t("ed.bot.webHint")} on={tools.web === true} onChange={(v) => set({ tools: { web: v } })} />
          <ToggleRow title={t("ed.bot.browser")} sub={t("ed.bot.browserHint")} on={tools.browser === true} onChange={(v) => set({ tools: { browser: v, ...(v ? {} : { accounts: false }) } })} />
          <ToggleRow title={t("ed.bot.accounts")} sub={t("ed.bot.accountsHint")} on={tools.accounts === true && tools.browser === true} onChange={(v) => set({ tools: { accounts: v, ...(v ? { browser: true } : {}) } })} />
          {[t("ed.desk.title"), t("ed.files.title")].map((title) => (
            <div key={title} className="m-row is-off" aria-disabled="true">
              <span className="m-row__main">
                <span className="m-row__title">{title}</span>
                <span className="m-row__sub m-row__sub--wrap">{t("ed.onComputerHint")}</span>
              </span>
              <span className="m-pill m-pill--quiet">
                <Icon name="laptop" size={14} /> {t("ed.onComputer")}
              </span>
            </div>
          ))}
        </Section>

        <Section header={t("ed.bot.where")} id="ed-where">
          {(["cloud", "local"] as const).map((w) => {
            const on = w === "local" ? view.local === true : view.local !== true;
            return (
              <button key={w} type="button" className="m-row is-tap" role="radio" aria-checked={on} onClick={() => set({ local: w === "local" })}>
                <span className="m-row__main">
                  <span className="m-row__title">{t(w === "local" ? "ed.bot.where.local" : "ed.bot.where.cloud")}</span>
                  <span className="m-row__sub m-row__sub--wrap">{t(w === "local" ? "ed.bot.where.localHint" : "ed.bot.where.cloudHint")}</span>
                </span>
                {on && <Icon name="check" size={20} stroke={2.4} className="m-check" />}
              </button>
            );
          })}
        </Section>

        <div className="m-edbar">
          {note && (
            <p className={note.ok ? "m-okay" : "m-alert"} role={note.ok ? "status" : "alert"}>
              {note.text}
            </p>
          )}
          <button type="button" className="m-btn m-btn--fill m-btn--wide m-btn--lg" onClick={() => void save()} disabled={busy || !changed || !name}>
            {busy ? <Spinner size={18} /> : t("ed.save")}
          </button>
          <button type="button" className="m-btn m-btn--gray m-btn--wide" onClick={() => router.push(to(`/c/${encodeURIComponent(dmId(botId))}`))}>
            {t("ed.openChat")}
          </button>
          <button type="button" className="m-btn m-btn--plain m-btn--wide m-danger" onClick={() => setAsk(true)}>
            <Icon name="trash" size={17} /> {t("ed.delete")}
          </button>
        </div>
      </main>
      <ActionSheet
        open={ask}
        message={t("ed.bot.confirmDelete", { name })}
        onClose={() => setAsk(false)}
        actions={[
          {
            label: t("ed.delete"),
            destructive: true,
            onPress: () =>
              void removeBot(botId).then((ok) => {
                if (!ok) return setNote({ ok: false, text: t("ed.errSave") });
                toast(t("ed.deleted", { name }));
                router.replace(to());
              }),
          },
        ]}
      />
    </div>
  );
}

// ---------- a group ----------

export function GroupEditScreen({ groupId }: { groupId: string }) {
  const { t, setup, editSetup, removeChat, toast } = useM();
  const router = useRouter();
  const back = useBack(to(`/c/${encodeURIComponent(groupId)}`));
  const [item, setItem] = useState<Record<string, unknown> | null | "missing">(null);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [leadId, setLeadId] = useState<string | undefined>();
  const [orchestrate, setOrchestrate] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    let alive = true;
    void getSetup()
      .then((s) => {
        if (!alive) return;
        const it = s?.items?.[`group:${groupId}`];
        if (!it || typeof it !== "object") return setItem("missing");
        const g = it as Record<string, unknown>;
        setItem(g);
        setName(String(g.name ?? ""));
        setMembers(Array.isArray(g.memberIds) ? (g.memberIds as string[]) : []);
        setLeadId(typeof g.leadId === "string" ? g.leadId : undefined);
        setOrchestrate(g.orchestrate !== false);
      })
      .catch(() => alive && setItem("missing"));
    return () => {
      alive = false;
    };
  }, [groupId]);

  if (item === null) return <EditorShell title={t("ed.loading")} back={back} busy />;
  if (item === "missing") return <EditorShell title={t("ed.group.edit")} back={back} missing />;

  const bots = (setup?.bots ?? []).filter((b) => !b.local);
  const inGroup = members.map((id) => bots.find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => !!b);
  const lead = inGroup.find((b) => b.id === leadId) ?? inGroup[0];
  const change = (f: () => void) => {
    f();
    setDirty(true);
    setNote(null);
  };

  const save = async () => {
    if (!name.trim()) return setNote({ ok: false, text: t("create.err.empty") });
    if (!members.length) return setNote({ ok: false, text: t("ed.errMembers") });
    setBusy(true);
    const p = { name, memberIds: members, leadId: lead?.id, orchestrate };
    const ok = await editSetup((items) => {
      const cur = items[`group:${groupId}`];
      if (!cur || typeof cur !== "object") throw new Error("missing");
      const next = editGroupItem(cur as Record<string, unknown>, p);
      if (!next) throw new Error("invalid");
      return { ...items, [`group:${groupId}`]: next };
    });
    setBusy(false);
    if (!ok) return setNote({ ok: false, text: t("ed.errSave") });
    tap("success");
    setDirty(false);
    setNote({ ok: true, text: t("ed.saved") });
  };

  return (
    <div className="m-screen m-screen--grouped">
      <NavBar title={t("ed.group.edit")} large back={{ href: to(`/c/${encodeURIComponent(groupId)}`), label: name || t("tab.chats") }} />
      <main className="m-main">
        <LargeTitle>{t("ed.group.edit")}</LargeTitle>
        <OfflineBar />
        <div className="m-edhero">
          <FaceStack faces={inGroup.map((b) => b.face)} size={96} />
        </div>
        <Section id="ed-gname">
          <div className="m-eform">
            <Field label={t("acct.name")}>
              {(a) => <input {...a} dir="auto" autoComplete="off" maxLength={BOT_LIMITS.groupName} value={name} placeholder={t("ed.group.namePh")} onChange={(e) => change(() => setName(e.target.value))} />}
            </Field>
          </div>
        </Section>
        <Section header={t("ed.group.members")} footer={t("ed.group.membersSub")} id="ed-members">
          {bots.map((b) => {
            const on = members.includes(b.id);
            return (
              <button key={b.id} type="button" className="m-row is-tap" role="checkbox" aria-checked={on} onClick={() => change(() => setMembers((cur) => (on ? cur.filter((x) => x !== b.id) : [...cur, b.id])))}>
                <span className="m-row__icon" aria-hidden>
                  <FaceView face={b.face} size={32} mood={on ? "happy" : "idle"} />
                </span>
                <span className="m-row__main">
                  <span className="m-row__title" dir="auto">
                    {b.name}
                  </span>
                  {b.role && <span className="m-row__sub">{b.role}</span>}
                </span>
                {on && <Icon name="check" size={20} stroke={2.4} className="m-check" />}
              </button>
            );
          })}
        </Section>
        {inGroup.length > 1 && (
          <Section header={t("ed.group.leader")} footer={t("ed.group.leaderSub")} id="ed-leader">
            {inGroup.map((b) => (
              <button key={b.id} type="button" className="m-row is-tap" role="radio" aria-checked={lead?.id === b.id} onClick={() => change(() => setLeadId(b.id))}>
                <span className="m-row__icon" aria-hidden>
                  <FaceView face={b.face} size={28} />
                </span>
                <span className="m-row__main">
                  <span className="m-row__title" dir="auto">
                    {b.name}
                  </span>
                </span>
                {lead?.id === b.id && <Icon name="check" size={20} stroke={2.4} className="m-check" />}
              </button>
            ))}
            <ToggleRow title={t("ed.group.leaderMode")} sub={t("ed.group.leaderModeHint", { name: lead?.name ?? "" })} on={orchestrate} onChange={(v) => change(() => setOrchestrate(v))} />
          </Section>
        )}
        <div className="m-edbar">
          {note && (
            <p className={note.ok ? "m-okay" : "m-alert"} role={note.ok ? "status" : "alert"}>
              {note.text}
            </p>
          )}
          <button type="button" className="m-btn m-btn--fill m-btn--wide m-btn--lg" onClick={() => void save()} disabled={busy || !dirty}>
            {busy ? <Spinner size={18} /> : t("ed.save")}
          </button>
          <button type="button" className="m-btn m-btn--gray m-btn--wide" onClick={() => router.push(to(`/c/${encodeURIComponent(groupId)}`))}>
            {t("ed.openChat")}
          </button>
          <button type="button" className="m-btn m-btn--plain m-btn--wide m-danger" onClick={() => setAsk(true)}>
            <Icon name="trash" size={17} /> {t("ed.group.delete")}
          </button>
        </div>
      </main>
      <ActionSheet
        open={ask}
        message={t("ed.group.confirmDelete", { name })}
        onClose={() => setAsk(false)}
        actions={[
          {
            label: t("ed.group.delete"),
            destructive: true,
            onPress: () =>
              void removeChat(groupId).then((ok) => {
                if (!ok) return setNote({ ok: false, text: t("ed.errSave") });
                toast(t("ed.deleted", { name }));
                router.replace(to());
              }),
          },
        ]}
      />
    </div>
  );
}

function EditorShell({ title, back, busy, missing }: { title: string; back: () => void; busy?: boolean; missing?: boolean }) {
  const { t } = useM();
  return (
    <div className="m-screen m-screen--grouped">
      <NavBar title={title} back={{ href: to(), label: t("tab.chats") }} solid />
      <main className="m-main m-main--center">
        {busy ? (
          <Spinner />
        ) : (
          missing && (
            <div className="m-empty">
              <p>{t("ed.notFound")}</p>
              <button type="button" className="m-btn m-btn--tinted" onClick={back}>
                {t("tab.chats")}
              </button>
            </div>
          )
        )}
      </main>
    </div>
  );
}
