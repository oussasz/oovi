"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, refreshSidebar } from "@/lib/client";
import type { Bot, Chat } from "@/lib/types";
import Face, { FaceStack, LeadFace } from "./Face";
import { useI18n } from "./I18n";
import Icon from "./Icon";

export default function GroupEditor({ id }: { id: string }) {
  const router = useRouter();
  const isNew = id === "new";
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [leadId, setLeadId] = useState<string | undefined>();
  const [orchestrate, setOrchestrate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    (async () => {
      try {
        setBots(await api<Bot[]>("/api/bots"));
        if (!isNew) {
          const c = await api<Chat>(`/api/chats/${id}`);
          setName(c.name);
          setMemberIds(c.memberIds);
          setLeadId(c.leadId);
          setOrchestrate(c.orchestrate !== false);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id, isNew]);

  if (!bots) return <div className="page center muted">{error ?? t("common.loading")}</div>;

  const members = memberIds.map((m) => bots.find((b) => b.id === m)).filter((b): b is Bot => !!b);
  const lead = members.find((m) => m.id === leadId) ?? members[0];

  const toggle = (bid: string) => setMemberIds(memberIds.includes(bid) ? memberIds.filter((x) => x !== bid) : [...memberIds, bid]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({ name, memberIds, leadId: lead?.id, orchestrate });
      const chat = isNew ? await api<Chat>("/api/chats", { method: "POST", body }) : await api<Chat>(`/api/chats/${id}`, { method: "PUT", body });
      refreshSidebar();
      router.push(`/c/${chat.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(t("group.confirmDelete", { name }))) return;
    try {
      await api(`/api/chats/${id}`, { method: "DELETE" });
      refreshSidebar();
      router.push("/");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="page narrow">
      <div className="group-hero">
        <FaceStack faces={members.map((m) => m.face)} lead={orchestrate && lead && members.length > 1 ? members.indexOf(lead) : undefined} size={92} />
        <div className="group-hero-text">
          <span className="opt-label">{isNew ? t("common.newGroup") : t("group.edit")}</span>
          <input className="title-input" value={name} maxLength={48} placeholder={t("group.namePh")} onChange={(e) => setName(e.target.value)} aria-label={t("group.nameAria")} autoFocus={isNew} />
        </div>
      </div>

      <section className="card">
        <h2>{t("group.members")}</h2>
        <p className="muted">{t("group.membersSub")}</p>
        <div className="member-grid">
          {bots.map((b) => {
            const on = memberIds.includes(b.id);
            return (
              <button key={b.id} type="button" className={`member${on ? " on" : ""}`} onClick={() => toggle(b.id)} aria-pressed={on}>
                {on && orchestrate && lead?.id === b.id && members.length > 1 ? <LeadFace face={b.face} size={56} mood="happy" /> : <Face face={b.face} size={56} mood={on ? "happy" : "idle"} />}
                <b>{b.name}</b>
                <span>{b.role || t("common.bot")}</span>
                {on && (
                  <span className="tick">
                    <Icon name="check" size={13} />
                  </span>
                )}
              </button>
            );
          })}
          <Link href="/bots/new" className="member add">
            <span className="add-circle">
              <Icon name="plus" />
            </span>
            <b>{t("common.newBot")}</b>
            <span>{t("group.designOne")}</span>
          </Link>
        </div>
      </section>

      {members.length > 1 && (
        <section className="card">
          <h2>{t("group.leader")}</h2>
          <p className="muted">{t("group.leaderSub")}</p>
          <div className="chip-row">
            {members.map((b) => (
              <button key={b.id} type="button" className={`chip big${lead?.id === b.id ? " on" : ""}`} onClick={() => setLeadId(b.id)} aria-pressed={lead?.id === b.id}>
                <Face face={b.face} size={24} /> {b.name}
              </button>
            ))}
          </div>
          <label className="toggle" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={orchestrate} onChange={(e) => setOrchestrate(e.target.checked)} />
            <span className="toggle-ui" />
            <span>
              <b>{t("group.leaderMode")}</b>
              <span className="hint">{t("group.leaderModeHint", { name: lead?.name ?? t("group.theLeader") })}</span>
            </span>
          </label>
        </section>
      )}

      <div className="savebar">
        <button className="btn primary" onClick={save} disabled={saving || !name.trim() || !members.length}>
          {isNew ? t("group.create") : t("common.save")}
        </button>
        {!isNew && (
          <Link className="btn" href={`/c/${id}`}>
            {t("group.back")}
          </Link>
        )}
        {error && <span className="msg-err">{error}</span>}
        <span className="spacer" />
        {!isNew && (
          <button className="btn danger" onClick={remove}>
            <Icon name="trash" size={16} /> {t("group.delete")}
          </button>
        )}
      </div>
    </div>
  );
}
