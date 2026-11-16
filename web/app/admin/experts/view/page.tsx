import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { getApplication } from "@/lib/expert-db";
import { CONSENT_VERSION, LANGUAGES, STATUS_LABEL, consentHash } from "@/lib/expert-form";
import { ID_RE } from "@/lib/form";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { PageHead } from "@/components/admin/ui";
import { fmtDateTime } from "@/components/admin/format";
import { reviewApplication } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Expert application" };

const DONE: Record<string, string> = { accepted: "Accepted. Nothing was published.", declined: "Declined.", new: "Put back to New." };

export default async function AdminExpertView({ searchParams }: { searchParams: Promise<{ id?: string; done?: string }> }) {
  await requireAdmin();
  const { id, done } = await searchParams;
  if (typeof id !== "string" || !ID_RE.test(id)) notFound();
  const r = await getApplication(id);
  if (!r) notFound();
  const langs = r.languages.map((x) => LANGUAGES.find((y) => y.value === x)?.label ?? x).join(", ");
  const sameText = r.consent_version === CONSENT_VERSION && r.consent_text_hash === consentHash();

  const rows: [string, React.ReactNode][] = [
    ["Name", r.name],
    ["Email", <a key="m" href={`mailto:${encodeURIComponent(r.email)}`}>{r.email}</a>],
    ["Public profile", /^https:\/\//.test(r.profile_url) ? <a key="p" href={r.profile_url} target="_blank" rel="noreferrer noopener">{r.profile_url}</a> : r.profile_url],
    ["Expert in", r.field],
    ["Languages", langs],
    ["Known as", r.known_as ?? "–"],
    ["Received", fmtDateTime(r.created_at.toISOString())],
  ];

  return (
    <>
      <PageHead title={r.name} sub={`Expert application · ${STATUS_LABEL[r.status]}`}>
        <Link href="/admin/experts" className="btn btn-ghost btn-sm">
          Back to experts
        </Link>
      </PageHead>

      {done && DONE[done] && (
        <p className="alert alert-ok" role="status">
          {DONE[done]}
        </p>
      )}

      <section className="card adm-card">
        <h2>The request</h2>
        <dl className="adm-dl">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <h3 style={{ margin: "16px 0 4px", fontSize: 15 }}>Bio</h3>
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.bio}</p>
      </section>

      <section className="card adm-card">
        <h2>Signature and consent</h2>
        <dl className="adm-dl">
          <div>
            <dt>Typed name</dt>
            <dd>{r.signed_name}</dd>
          </div>
          <div>
            <dt>Consent text</dt>
            <dd>
              Version {r.consent_version} {sameText ? "(the current text)" : "(an older text than the one on the site today)"}
              <div className="adm-sub adm-mono">SHA-256 {r.consent_text_hash}</div>
            </dd>
          </div>
          <div>
            <dt>Signed on</dt>
            <dd>{fmtDateTime(r.created_at.toISOString())}</dd>
          </div>
          <div>
            <dt>Browser</dt>
            <dd className="adm-sub">{r.user_agent ?? "–"}</dd>
          </div>
        </dl>
        {r.has_signature ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="ex-sig" src={`/admin/experts/signature/${r.id}`} alt={`Drawn signature of ${r.name}`} width={600} height={200} />
        ) : (
          <p className="adm-sub">No drawing: the person ticked “I can’t draw a signature”, so the typed name is the signature.</p>
        )}
      </section>

      <section className="card adm-card">
        <h2>Your decision</h2>
        {r.reviewed_at && (
          <p className="adm-sub">
            Last decision {fmtDateTime(r.reviewed_at.toISOString())} by {r.reviewed_by}.{r.review_note ? ` Note: ${r.review_note}` : ""}
          </p>
        )}
        <p className="adm-sub">Accepting publishes nothing. The next step is to agree the details with this person in writing, then add the expert in Admin › Marketplace. You can change your decision at any time.</p>
        <form className="adm-form">
          <input type="hidden" name="id" value={r.id} />
          <div className="field">
            <label htmlFor="ex-note">Note (optional, only you see it)</label>
            <textarea id="ex-note" name="note" className="input" rows={2} maxLength={500} defaultValue={r.review_note ?? ""} />
          </div>
          <div className="adm-form-foot">
            {r.status !== "accepted" && (
              <button type="submit" formAction={reviewApplication.bind(null, "accepted")} className="btn btn-dark btn-sm">
                Accept
              </button>
            )}
            {r.status !== "declined" && (
              <ConfirmButton className="btn btn-light btn-sm" formAction={reviewApplication.bind(null, "declined")} message={`Decline the application from ${r.name}?`}>
                Decline
              </ConfirmButton>
            )}
            {r.status !== "new" && (
              <button type="submit" formAction={reviewApplication.bind(null, "new")} className="btn btn-ghost btn-sm">
                Put back to New
              </button>
            )}
          </div>
        </form>
      </section>
    </>
  );
}
