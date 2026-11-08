"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, refreshSidebar } from "@/lib/client";
import type { Bot, Chat } from "@/lib/types";
import Face, { FaceStack } from "./Face";
import Icon from "./Icon";

export default function GroupEditor({ id }: { id: string }) {
  const router = useRouter();
  const isNew = id === "new";
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [leadId, setLeadId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setBots(await api<Bot[]>("/api/bots"));
        if (!isNew) {
          const c = await api<Chat>(`/api/chats/${id}`);
          setName(c.name);
          setMemberIds(c.memberIds);
          setLeadId(c.leadId);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id, isNew]);

  if (!bots) return <div className="page center muted">{error ?? "Loading…"}</div>;

  const members = memberIds.map((m) => bots.find((b) => b.id === m)).filter((b): b is Bot => !!b);
  const lead = members.find((m) => m.id === leadId) ?? members[0];

  const toggle = (bid: string) => setMemberIds(memberIds.includes(bid) ? memberIds.filter((x) => x !== bid) : [...memberIds, bid]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({ name, memberIds, leadId: lead?.id });
      const chat = isNew ? await api<Chat>("/api/chats", { method: "POST", body }) : await api<Chat>(`/api/chats/${id}`, { method: "PUT", body });
      refreshSidebar();
      router.push(`/c/${chat.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete the group "${name}" and its conversation? The bots stay.`)) return;
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
        <FaceStack faces={members.map((m) => m.face)} size={92} />
        <div className="group-hero-text">
          <span className="opt-label">{isNew ? "New group" : "Edit group"}</span>
          <input className="title-input" value={name} maxLength={48} placeholder="Name your group" onChange={(e) => setName(e.target.value)} aria-label="Group name" autoFocus={isNew} />
        </div>
      </div>

      <section className="card">
        <h2>Members</h2>
        <p className="muted">Everyone in the group sees the whole conversation and can @mention the others to hand off work.</p>
        <div className="member-grid">
          {bots.map((b) => {
            const on = memberIds.includes(b.id);
            return (
              <button key={b.id} type="button" className={`member${on ? " on" : ""}`} onClick={() => toggle(b.id)} aria-pressed={on}>
                <Face face={b.face} size={56} mood={on ? "happy" : "idle"} />
                <b>{b.name}</b>
                <span>{b.role || "Bot"}</span>
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
            <b>New bot</b>
            <span>Design one</span>
          </Link>
        </div>
      </section>

      {members.length > 1 && (
        <section className="card">
          <h2>Who answers first</h2>
          <p className="muted">When a message doesn&apos;t @mention anyone, this bot picks it up and can pull in the others.</p>
          <div className="chip-row">
            {members.map((b) => (
              <button key={b.id} type="button" className={`chip big${lead?.id === b.id ? " on" : ""}`} onClick={() => setLeadId(b.id)} aria-pressed={lead?.id === b.id}>
                <Face face={b.face} size={24} /> {b.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="savebar">
        <button className="btn primary" onClick={save} disabled={saving || !name.trim() || !members.length}>
          {isNew ? "Create group" : "Save"}
        </button>
        {!isNew && (
          <Link className="btn" href={`/c/${id}`}>
            Back to chat
          </Link>
        )}
        {error && <span className="msg-err">{error}</span>}
        <span className="spacer" />
        {!isNew && (
          <button className="btn danger" onClick={remove}>
            <Icon name="trash" size={16} /> Delete group
          </button>
        )}
      </div>
    </div>
  );
}
