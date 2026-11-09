import type { PilotRequestRow } from "@/lib/ai-admin";
import { approvePilot, rejectPilot } from "@/app/admin/pilot/actions";
import { ActionForm } from "./ActionForm";
import { fmtDateTime, fmtInt } from "./format";

const STATUS_LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected" } as const;

export function PilotStatusBadge({ status }: { status: PilotRequestRow["status"] }) {
  return <span className={`adm-badge${status === "approved" ? " on" : status === "rejected" ? " warn" : ""}`}>{STATUS_LABEL[status]}</span>;
}

/** Approve / reject controls for one pilot request (or what was decided). */
export function PilotReview({ req, defaultCredits }: { req: PilotRequestRow; defaultCredits: number }) {
  const done =
    req.status !== "pending" ? (
      <p className="fine">
        {req.status === "approved" ? `Approved with ${fmtInt(req.credits ?? 0)} credits` : "Rejected"}
        {req.reviewedBy ? ` by ${req.reviewedBy}` : ""}
        {req.reviewedAt ? `, ${fmtDateTime(req.reviewedAt)}` : ""}
        {req.adminNote ? `. Note: ${req.adminNote}` : ""}
      </p>
    ) : null;
  if (req.status === "approved") return done;
  return (
    <div className="adm-review">
      {done}
      <ActionForm
        action={approvePilot}
        className="adm-form adm-form-inline"
        submitLabel="Approve"
        pendingLabel="Approving…"
        confirm={`Approve this request? This adds the credits and starts the pilot plan for ${req.email ?? "this person"}.`}
      >
        <input type="hidden" name="id" value={req.id} />
        <div className="field">
          <label htmlFor={`pilot-credits-${req.id}`}>Credits</label>
          <input
            id={`pilot-credits-${req.id}`}
            name="credits"
            className="input"
            type="number"
            min={0}
            max={10000000}
            step={1}
            defaultValue={defaultCredits}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`pilot-anote-${req.id}`}>Note (optional)</label>
          <input id={`pilot-anote-${req.id}`} name="note" className="input" maxLength={500} />
        </div>
      </ActionForm>
      {req.status === "pending" && (
        <ActionForm action={rejectPilot} className="adm-form adm-form-inline" submitLabel="Reject" pendingLabel="Rejecting…" submitClassName="btn btn-ghost btn-sm">
          <input type="hidden" name="id" value={req.id} />
          <div className="field">
            <label htmlFor={`pilot-rnote-${req.id}`}>Reason (optional, only you see it)</label>
            <input id={`pilot-rnote-${req.id}`} name="note" className="input" maxLength={500} />
          </div>
        </ActionForm>
      )}
    </div>
  );
}
