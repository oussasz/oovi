"use client";

// The card that asks for the user's OK: what a bot wants to do, with Allow / Deny (and "always" choices).
// One component for a request in this chat and for a request from a group the main bot gave a task to
// (`group`: shown in the main bot's chat, so the user answers where they are).
import type { Approval, Bot } from "@/lib/types";
import { markWhitespace } from "@/lib/desktop-core";
import Face from "./Face";
import { useI18n } from "./I18n";
import Icon from "./Icon";

type Props = {
  approval: Approval;
  bot?: Bot;
  /** The group this request comes from, when it isn't this chat's own. */
  group?: string;
  /** The answer is being sent: the buttons wait. */
  busy?: boolean;
  /** always: "edits" also allows file edits in the project folder from now on; "folders" lets bots read and send from these folders without asking. */
  onDecide: (ok: boolean, always?: "edits" | "folders") => void;
};

export default function ApprovalCard({ approval, bot, group, busy = false, onDecide }: Props) {
  const { t } = useI18n();
  const name = bot?.name ?? t("chat.aBot");
  const from = group ? <span className="approval-from">{t("chat.inGroup", { group })}</span> : null;

  // A specialist the leader proposes: its face, job and why, with "Create" / "Not now".
  if (approval.items.length > 0 && approval.items.every((i) => i.specialist)) {
    return (
      <div className="approval specialist-card" role="alert">
        {bot && <Face face={bot.face} mood="asking" size={44} />}
        <div>
          {from}
          <strong>{t("spec.title", { name })}</strong>
          {approval.items.map((it) => {
            const sp = it.specialist!;
            return (
              <div key={it.call.id} className="spec">
                <Face face={sp.face} mood="happy" size={64} />
                <div className="spec-body">
                  <div className="spec-name">
                    {sp.name} <span className="spec-role">{sp.role}</span>
                  </div>
                  {sp.why && <p className="spec-why">{sp.why}</p>}
                  <div className="spec-meta">
                    {sp.group && <span>{t("spec.joins", { group: sp.group })}</span>}
                    {sp.web && <span>{t("spec.web")}</span>}
                  </div>
                  <details className="approval-detail">
                    <summary>{t("spec.instructions")}</summary>
                    <pre>{sp.instructions}</pre>
                  </details>
                </div>
              </div>
            );
          })}
          <div className="row wrap">
            <button className="btn primary" disabled={busy} onClick={() => onDecide(true)}>
              <Icon name="plus" size={16} /> {t("spec.create")}
            </button>
            <button className="btn" disabled={busy} onClick={() => onDecide(false)}>
              {t("spec.notNow")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const grant = approval.items.some((i) => i.desktop === "grant");
  const folders = [...new Set(approval.items.map((i) => i.folder).filter(Boolean))];
  return (
    <div className="approval" role="alert">
      {bot && <Face face={bot.face} mood="asking" size={44} />}
      <div>
        {from}
        <strong>{grant ? t("desk.grantQ", { name }) : t("chat.wantsTo", { name })}</strong>
        <ul>
          {approval.items.map((it) => (
            <li key={it.call.id}>
              {it.summary}
              {it.desktop === "grant" && <span className="dc-grant-note">{t(it.askEvery ? "desk.grant.asks" : "desk.grant.noAsk")}</span>}
              {it.desktop && it.window && (
                <span className="dc-window" title={t("desk.windowHint")}>
                  {t("desk.window")} “{it.window.title}”
                </span>
              )}
              {it.desktop && it.text !== undefined && (
                <pre className="dc-typed" aria-label={t("desk.typed")}>
                  {markWhitespace(it.text)}
                </pre>
              )}
              {!it.desktop && it.detail && (
                <details className="approval-detail" open={it.call.name === "run_command" || it.detail.length < 600}>
                  <summary>{t("chat.details")}</summary>
                  <pre>{it.detail}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
        <div className="row wrap">
          <button className="btn primary" disabled={busy} onClick={() => onDecide(true)}>
            <Icon name="check" size={16} /> {grant ? t("desk.allowTask") : approval.items.some((i) => i.always || i.folder) ? t("chat.allowOnce") : t("chat.allow")}
          </button>
          {folders.length > 0 && (
            <button className="btn" disabled={busy} onClick={() => onDecide(true, "folders")} title={folders.join(" · ")}>
              {folders.length > 1 ? t("files.alwaysFolders") : t("files.alwaysFolder")}
            </button>
          )}
          {approval.items.some((i) => i.always) && (
            <button className="btn" disabled={busy} onClick={() => onDecide(true, "edits")}>
              {t("chat.alwaysEdits")}
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => onDecide(false)}>
            {t("chat.deny")}
          </button>
        </div>
      </div>
    </div>
  );
}
