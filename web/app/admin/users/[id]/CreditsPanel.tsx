import Link from "next/link";
import { getPilotConfig, getPlans } from "@/lib/ai-config";
import { getUserCredits, teamSizeLabel } from "@/lib/ai-admin";
import { ActionForm } from "@/components/admin/ActionForm";
import { FeedbackItem } from "@/components/admin/FeedbackItem";
import { PilotReview, PilotStatusBadge } from "@/components/admin/PilotReview";
import { Empty, Section } from "@/components/admin/ui";
import { fmtDate, fmtDateTime, fmtInt, fmtNumber, fmtPct, fmtUsd } from "@/components/admin/format";
import {
  adjustCreditsAction,
  resetTodayAction,
  setAiEnabledAction,
  setBlockedAction,
  setOverrideAction,
  setPlanAction,
} from "./actions";

const cr = (v: number) => fmtNumber(Math.round(v * 10) / 10);
const signed = (v: number) => `${v > 0 ? "+" : ""}${fmtNumber(Math.round(v * 1000) / 1000, 3)}`;

const KIND_LABELS: Record<string, string> = {
  signup: "Welcome credits",
  admin: "Changed by an admin",
  plan: "Plan",
  pilot: "Pilot program",
};

/** The theOovi part of a user's page: credits, controls, history, pilot and feedback. */
export async function CreditsPanel({ userId, email, isSelf }: { userId: string; email: string; isSelf: boolean }) {
  const [c, plans, pilotCfg] = await Promise.all([getUserCredits(userId), getPlans(), getPilotConfig()]);
  const a = c.account;
  const plan = a ? plans.find((p) => p.id === a.plan) : undefined;
  const planLimit = plan?.dailyLimit ?? plans.find((p) => p.id === "free")?.dailyLimit ?? 0;
  const limit = a?.dailyLimitOverride ?? planLimit;
  const blocked = c.status === "blocked";
  const hidden = <input type="hidden" name="userId" value={userId} />;

  return (
    <>
      <Section
        title="theOovi credits"
        sub="Credits for the hosted model. Every change below is recorded in the credit history and the audit log."
        actions={
          <div className="adm-row-actions">
            {blocked ? <span className="adm-badge warn">Account blocked</span> : <span className="adm-badge on">Account active</span>}
            {a && !a.aiEnabled && <span className="adm-badge warn">theOovi off</span>}
          </div>
        }
      >
        {blocked && (
          <p className="alert alert-error" role="status" style={{ marginBottom: 14 }}>
            This account is blocked{c.statusReason ? `: ${c.statusReason.replace(/[.!?]?\s*$/, ".")}` : "."} They can’t sign in to the website or the app.
          </p>
        )}
        {a ? (
          <dl className="adm-dl">
            <dt>Balance</dt>
            <dd>
              <b>{cr(a.balance)}</b> credits
            </dd>
            <dt>Today (UTC)</dt>
            <dd>
              {cr(a.todayUsed)} used of {limit === 0 ? "no limit" : `${fmtInt(limit)}`}
              {limit > 0 ? ` (${fmtPct(Math.min(1, a.todayUsed / limit))})` : ""}
              {a.dailyLimitOverride !== null
                ? ` · limit set by hand (plan’s limit is ${planLimit === 0 ? "no limit" : fmtInt(planLimit)})`
                : " · from the plan"}
              {a.inflight > 0 ? ` · ${a.inflight} call(s) running` : ""}
            </dd>
            <dt>Plan</dt>
            <dd>
              {plan?.name ?? a.plan}
              {a.plan !== "free" && a.planUntil ? ` until ${fmtDate(a.planUntil)}` : ""}
              {a.plan !== "free" && a.planRenewsAt && (plan?.monthlyCredits ?? 0) > 0 ? ` · next monthly credits ${fmtDate(a.planRenewsAt)}` : ""}
              {!plan && a.plan !== "free" ? " (this plan no longer exists; the Free plan’s limits apply)" : ""}
            </dd>
            <dt>Total used</dt>
            <dd>{cr(a.totalUsed)} credits</dd>
            <dt>Credit account</dt>
            <dd>Created {fmtDateTime(a.createdAt)}</dd>
          </dl>
        ) : (
          <Empty>
            No credit account yet. It’s created (with the welcome credits) the first time they use theOovi or open their account page,
            or when you use any control below.
          </Empty>
        )}

        <div className="adm-actions-grid">
          <div className="adm-action">
            <h3>Add or remove credits</h3>
            <ActionForm action={adjustCreditsAction} submitLabel="Apply" resetOnSuccess>
              {hidden}
              <div className="field">
                <label htmlFor="adj-amount">Credits (use a minus sign to remove)</label>
                <input id="adj-amount" name="amount" className="input" type="number" step="any" min={-10000000} max={10000000} placeholder="e.g. 500 or -200" required />
              </div>
              <div className="field">
                <label htmlFor="adj-note">Note (required)</label>
                <input id="adj-note" name="note" className="input" minLength={3} maxLength={300} placeholder="e.g. Refund for a failed task" required />
              </div>
            </ActionForm>
          </div>

          <div className="adm-action">
            <h3>Plan</h3>
            <ActionForm action={setPlanAction} submitLabel="Set plan">
              {hidden}
              <div className="adm-fields">
                <div className="field">
                  <label htmlFor="set-plan">Plan</label>
                  <select id="set-plan" name="plan" className="input" defaultValue={a?.plan ?? "free"}>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({fmtInt(p.monthlyCredits)}/month, {p.dailyLimit === 0 ? "no daily limit" : `${fmtInt(p.dailyLimit)}/day`})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="set-days">Days</label>
                  <input id="set-days" name="days" className="input" type="number" min={1} max={3650} step={1} defaultValue={30} required />
                </div>
              </div>
              <span className="adm-help">Starts today and adds the plan’s monthly credits now. Free ends any current plan.</span>
            </ActionForm>
          </div>

          <div className="adm-action">
            <h3>Daily limit</h3>
            <ActionForm action={setOverrideAction} submitLabel="Set limit">
              {hidden}
              <input type="hidden" name="mode" value="set" />
              <div className="field">
                <label htmlFor="ovr-limit">Credits per day for this person</label>
                <input
                  id="ovr-limit"
                  name="limit"
                  className="input"
                  type="number"
                  min={0}
                  max={100000000}
                  step={1}
                  defaultValue={a?.dailyLimitOverride ?? ""}
                  placeholder={`Plan: ${planLimit === 0 ? "no limit" : planLimit}`}
                  required
                />
              </div>
              <span className="adm-help">Replaces the plan’s daily limit. 0 = no daily limit (to stop them, turn theOovi off instead).</span>
            </ActionForm>
            {a?.dailyLimitOverride !== null && a?.dailyLimitOverride !== undefined && (
              <ActionForm action={setOverrideAction} submitLabel="Use the plan’s limit again" submitClassName="btn btn-ghost btn-sm">
                {hidden}
                <input type="hidden" name="mode" value="clear" />
              </ActionForm>
            )}
          </div>

          <div className="adm-action">
            <h3>Today and access</h3>
            <ActionForm
              action={resetTodayAction}
              submitLabel="Reset today’s usage"
              submitClassName="btn btn-light btn-sm"
              confirm="Reset today’s usage to 0? They can use their full daily limit again today. Their balance doesn’t change."
            >
              {hidden}
            </ActionForm>
            <ActionForm
              action={setAiEnabledAction}
              submitLabel={a && !a.aiEnabled ? "Turn theOovi on" : "Turn theOovi off"}
              submitClassName={a && !a.aiEnabled ? "btn btn-dark btn-sm" : "btn btn-ghost btn-sm"}
              confirm={
                a && !a.aiEnabled
                  ? "Turn theOovi back on for this account?"
                  : "Turn theOovi off for this account? They keep their account, credits and own API keys, but can’t use the hosted model until you turn it back on."
              }
            >
              {hidden}
              <input type="hidden" name="enabled" value={a && !a.aiEnabled ? "true" : "false"} />
            </ActionForm>
          </div>

          <div className="adm-action adm-action-danger">
            <h3>{blocked ? "Unblock account" : "Block account"}</h3>
            {blocked ? (
              <ActionForm
                action={setBlockedAction}
                submitLabel="Unblock account"
                confirm={`Unblock ${email}? They can sign in to the website and the app again.`}
              >
                {hidden}
                <input type="hidden" name="blocked" value="false" />
              </ActionForm>
            ) : isSelf ? (
              <p className="adm-help">You can’t block your own account.</p>
            ) : (
              <ActionForm
                action={setBlockedAction}
                submitLabel="Block account"
                submitClassName="btn btn-danger btn-sm"
                confirm={`Block ${email}?\n\n• They are signed out everywhere (website and app) right away.\n• They can’t sign in again or use theOovi.\n• Their data and credits are kept, and you can unblock them later.`}
              >
                {hidden}
                <input type="hidden" name="blocked" value="true" />
                <div className="field">
                  <label htmlFor="block-reason">Reason (required, only admins see it)</label>
                  <input id="block-reason" name="reason" className="input" minLength={3} maxLength={300} required />
                </div>
              </ActionForm>
            )}
          </div>
        </div>
      </Section>

      <div className="adm-grid-2">
        <Section title="Credit history" sub="Latest 50 changes to the balance (spending per call is in the usage table).">
          {c.ledger.length === 0 ? (
            <Empty>No credit changes yet.</Empty>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th className="num">Credits</th>
                    <th>What</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {c.ledger.map((l) => (
                    <tr key={l.id}>
                      <td className="nowrap">{fmtDateTime(l.createdAt)}</td>
                      <td className="num">{l.credits === 0 ? "0" : signed(l.credits)}</td>
                      <td>
                        {KIND_LABELS[l.kind] ?? l.kind}
                        {l.note && <div className="fine">{l.note}</div>}
                      </td>
                      <td>{l.actor ?? "System"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="theOovi usage by day" sub="Latest 30 days with activity (UTC).">
          {c.usage.length === 0 ? (
            <Empty>No theOovi calls yet.</Empty>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th className="num">Calls</th>
                    <th className="num">Errors</th>
                    <th className="num">Refused</th>
                    <th className="num">Credits</th>
                    <th className="num">Cost</th>
                    <th className="num">Tokens in / out</th>
                    <th className="num">Avg latency</th>
                  </tr>
                </thead>
                <tbody>
                  {c.usage.map((u) => (
                    <tr key={u.day}>
                      <td className="nowrap">{fmtDate(`${u.day}T00:00:00Z`)}</td>
                      <td className="num">{fmtInt(u.calls)}</td>
                      <td className="num">{fmtInt(u.errors)}</td>
                      <td className="num">{fmtInt(u.blocked)}</td>
                      <td className="num">{cr(u.credits)}</td>
                      <td className="num">{fmtUsd(u.costUsd)}</td>
                      <td className="num">
                        {fmtInt(u.inputTokens + u.cacheRead + u.cacheWrite)} / {fmtInt(u.outputTokens)}
                      </td>
                      <td className="num">{u.avgLatencyMs === null ? "–" : `${(u.avgLatencyMs / 1000).toFixed(1)} s`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <div className="adm-grid-2">
        <Section
          title="Pilot request"
          actions={
            <Link href="/admin/pilot" className="btn btn-ghost btn-sm">
              All requests
            </Link>
          }
        >
          {c.pilot ? (
            <div className="adm-stack">
              <div className="adm-list-head">
                <PilotStatusBadge status={c.pilot.status} />
                <span className="fine">Requested {fmtDateTime(c.pilot.createdAt)}</span>
              </div>
              <p className="adm-quote">{c.pilot.useCase}</p>
              <dl className="adm-dl">
                <dt>Organization</dt>
                <dd>{c.pilot.organization || "–"}</dd>
                <dt>Role</dt>
                <dd>{c.pilot.role || "–"}</dd>
                <dt>Team size</dt>
                <dd>{teamSizeLabel(c.pilot.teamSize)}</dd>
              </dl>
              <PilotReview req={c.pilot} defaultCredits={pilotCfg.credits} />
            </div>
          ) : (
            <Empty>No pilot request.</Empty>
          )}
        </Section>

        <Section title="Feedback" sub="Latest 50 from this person">
          {c.feedback.length === 0 ? (
            <Empty>No feedback yet.</Empty>
          ) : (
            <ul className="adm-list">
              {c.feedback.map((f) => (
                <FeedbackItem key={f.id} f={f} showUser={false} />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
