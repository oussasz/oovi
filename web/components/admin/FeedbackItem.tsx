import Link from "next/link";
import type { FeedbackRow } from "@/lib/ai-admin";
import { updateFeedback } from "@/app/admin/feedback/actions";
import { ActionForm } from "./ActionForm";
import { fmtDateTime, platformLabel } from "./format";

export const FEEDBACK_KIND_LABELS = { problem: "Problem", improvement: "Improvement", other: "Other" } as const;
export const FEEDBACK_STATUS_LABELS = { new: "New", reviewed: "Reviewed", done: "Done" } as const;

/** One piece of feedback with its status controls. */
export function FeedbackItem({ f, showUser = true }: { f: FeedbackRow; showUser?: boolean }) {
  return (
    <li className="adm-list-item">
      <div className="adm-list-head">
        <span className={`adm-badge${f.kind === "problem" ? " warn" : ""}`}>{FEEDBACK_KIND_LABELS[f.kind]}</span>
        <span className={`adm-badge${f.status === "done" ? " on" : ""}`}>{FEEDBACK_STATUS_LABELS[f.status]}</span>
        {showUser &&
          (f.userId ? (
            <Link href={`/admin/users/${encodeURIComponent(f.userId)}`} className="adm-strong">
              {f.email ?? f.userId}
            </Link>
          ) : (
            <span className="fine">Deleted account</span>
          ))}
        <span className="fine">
          {fmtDateTime(f.createdAt)} · {f.source === "app" ? "Desktop app" : "Website"}
          {f.appVersion ? ` · v${f.appVersion}` : ""}
          {f.platform ? ` · ${platformLabel(f.platform)}` : ""}
        </span>
      </div>
      <p className="adm-quote">{f.message}</p>
      <ActionForm action={updateFeedback} className="adm-form adm-form-inline" submitLabel="Save" submitClassName="btn btn-light btn-sm">
        <input type="hidden" name="id" value={f.id} />
        <div className="field">
          <label htmlFor={`fb-status-${f.id}`}>Status</label>
          <select id={`fb-status-${f.id}`} name="status" className="input" defaultValue={f.status}>
            <option value="new">New</option>
            <option value="reviewed">Reviewed</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div className="field adm-grow">
          <label htmlFor={`fb-note-${f.id}`}>Note (only admins see it)</label>
          <input id={`fb-note-${f.id}`} name="note" className="input" maxLength={1000} defaultValue={f.adminNote ?? ""} />
        </div>
      </ActionForm>
    </li>
  );
}
