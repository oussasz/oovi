"use client";

// "+ Bot" and "+ Group", like the computer's sidebar: a bot needs a one-word name (used to @mention it), a role and
// a face (shuffle until you like it); a group needs a name and its bots (the first one leads). Saved to the
// account's setup; the computer sets them up at its next setup sync, and the new chat opens at once.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { randomFace } from "@/lib/faces";
import { botNameProblem } from "../_lib/core";
import { tap } from "../_lib/haptics";
import { to } from "../_lib/route";
import { Icon } from "./Icon";
import { BotFace, Sheet, Spinner } from "./kit";
import { useM } from "./MobileApp";

export function NewBotSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, setup, addBot, toast } = useM();
  const router = useRouter();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [face, setFace] = useState<Record<string, unknown>>(() => randomFace() as unknown as Record<string, unknown>);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const p = botNameProblem(name, (setup?.bots ?? []).map((b) => b.name));
    if (p) {
      setProblem(t(`create.err.${p}`));
      return;
    }
    setBusy(true);
    setProblem(null);
    const id = await addBot({ name, role, face });
    setBusy(false);
    if (!id) {
      setProblem(t("create.err.save"));
      return;
    }
    tap("success");
    toast(t("create.added", { name: name.trim() }));
    onClose();
    setName("");
    setRole("");
    setFace(randomFace() as unknown as Record<string, unknown>);
    router.push(to(`/c/${encodeURIComponent(`dm-${id}`)}`));
  };

  return (
    <Sheet open={open} title={t("create.botTitle")} onClose={onClose} closeLabel={t("common.cancel")}>
      <div className="m-create">
        <div className="m-create__face">
          <BotFace face={face} size={96} mood="happy" />
          <button type="button" className="m-btn m-btn--gray" onClick={() => (tap(), setFace(randomFace() as unknown as Record<string, unknown>))}>
            <Icon name="sparkle" size={18} /> {t("create.shuffle")}
          </button>
        </div>
        <div className="m-group m-group--form">
          <label className="m-field">
            <span>{t("create.name")}</span>
            <input dir="auto" autoComplete="off" maxLength={24} placeholder={t("create.namePh")} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="m-field">
            <span>{t("create.role")}</span>
            <input dir="auto" autoComplete="off" maxLength={80} placeholder={t("create.rolePh")} value={role} onChange={(e) => setRole(e.target.value)} />
          </label>
        </div>
        {problem && (
          <p className="m-alert" role="alert">
            {problem}
          </p>
        )}
        <button type="button" className="m-btn m-btn--fill m-btn--wide m-btn--lg" onClick={() => void create()} disabled={busy}>
          {busy ? <Spinner size={18} /> : t("create.create")}
        </button>
      </div>
    </Sheet>
  );
}

export function NewGroupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, setup, addGroup, toast } = useM();
  const router = useRouter();
  const bots = (setup?.bots ?? []).filter((b) => !b.hidden && !b.local);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return setProblem(t("create.err.empty"));
    if (!members.length) return setProblem(t("create.err.members"));
    setBusy(true);
    setProblem(null);
    const id = await addGroup({ name, memberIds: members });
    setBusy(false);
    if (!id) return setProblem(t("create.err.save"));
    tap("success");
    toast(t("create.added", { name: name.trim() }));
    onClose();
    setName("");
    setMembers([]);
    router.push(to(`/c/${encodeURIComponent(id)}`));
  };

  return (
    <Sheet open={open} title={t("create.groupTitle")} onClose={onClose} closeLabel={t("common.cancel")}>
      <div className="m-create">
        <div className="m-group m-group--form">
          <label className="m-field">
            <span>{t("create.name")}</span>
            <input dir="auto" autoComplete="off" maxLength={60} placeholder={t("create.groupPh")} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <div className="m-section">
          <h3 className="m-section__head">{t("create.members")}</h3>
          <div className="m-group">
            {bots.map((b) => {
              const on = members.includes(b.id);
              return (
                <button key={b.id} type="button" className="m-row is-tap" role="checkbox" aria-checked={on} onClick={() => setMembers((cur) => (on ? cur.filter((x) => x !== b.id) : [...cur, b.id]))}>
                  <span className="m-row__icon" aria-hidden>
                    <BotFace face={b.face} size={32} />
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
          </div>
          <p className="m-section__foot">{t("create.leadNote")}</p>
        </div>
        {problem && (
          <p className="m-alert" role="alert">
            {problem}
          </p>
        )}
        <button type="button" className="m-btn m-btn--fill m-btn--wide m-btn--lg" onClick={() => void create()} disabled={busy}>
          {busy ? <Spinner size={18} /> : t("create.create")}
        </button>
      </div>
    </Sheet>
  );
}
