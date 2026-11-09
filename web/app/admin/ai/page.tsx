import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin";
import { EFFORTS, getAiConfig, getPilotConfig, getPlans, providerKeyInfo } from "@/lib/ai-config";
import { AI_PERIOD_LABELS, AI_PERIODS, getAiStats, parseAiPeriod, type AiPeriod } from "@/lib/ai-stats";
import { BarChart, LineChart } from "@/components/admin/Charts";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Empty, Kpi, PageHead, PeriodPicker, Section } from "@/components/admin/ui";
import { fmtDateTime, fmtInt, fmtNumber, fmtPct, fmtUsd } from "@/components/admin/format";
import { removeProviderKey, replaceProviderKey, saveAiSettings, savePilotSettings, savePlansAction, setPaused } from "./actions";
import { PlansEditor } from "./PlansEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "theOovi" };

function Field({ id, label, help, children }: { id: string; label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {help && (
        <span className="adm-help" id={`${id}-help`}>
          {help}
        </span>
      )}
    </div>
  );
}

const prevLabel = (p: AiPeriod) => (p === 1 ? "all of yesterday" : `the ${p} days before`);
const usdPerCredit = (creditsPerUsd: number) => {
  const v = 1 / creditsPerUsd;
  return v >= 0.01 ? `$${v.toFixed(2)}` : `$${v.toPrecision(2).replace(/0+$/, "")}`;
};

export default async function AdminAi({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireAdmin();
  const period = parseAiPeriod((await searchParams).period);
  const [cfg, plans, pilot, key, s] = await Promise.all([getAiConfig(), getPlans(), getPilotConfig(), providerKeyInfo(), getAiStats(period)]);
  const c = s.current;
  const p = s.previous;
  const budgetShare = cfg.dailyBudgetUsd > 0 ? s.todayCostUsd / cfg.dailyBudgetUsd : null;
  const attempts = c.calls + c.errors;
  const pr = cfg.prices;

  return (
    <>
      <PageHead
        title="theOovi"
        sub={`The hosted model people use with their oovi account (${cfg.displayName}, ${cfg.model} behind it). Costs are what the provider charges us. All days are in UTC.`}
      >
        <PeriodPicker period={period} path="/admin/ai" periods={AI_PERIODS} label={(x) => AI_PERIOD_LABELS[x as AiPeriod]} />
        <form action={setPaused}>
          <input type="hidden" name="paused" value={cfg.paused ? "false" : "true"} />
          {cfg.paused ? (
            <ConfirmButton className="btn btn-dark btn-sm" message="Resume theOovi for everyone now? Hosted calls start working again immediately.">
              Resume theOovi
            </ConfirmButton>
          ) : (
            <ConfirmButton
              className="btn btn-danger btn-sm"
              message={`Pause theOovi for everyone now?\n\nAll hosted calls stop within about 15 seconds and people see the paused message. Their own API keys keep working. You can resume at any time.`}
            >
              Pause theOovi now
            </ConfirmButton>
          )}
        </form>
      </PageHead>

      {!cfg.enabled && (
        <p className="alert alert-error" role="status">
          theOovi is turned off in the settings below. Only people’s own API keys work.
        </p>
      )}
      {cfg.paused && (
        <p className="alert alert-error" role="status">
          theOovi is paused. People see: “{cfg.pausedMessage}”
        </p>
      )}
      {key.source === "none" && (
        <p className="alert alert-error" role="status">
          No provider API key is set, so every hosted call fails. Add one in “Provider API key” below.
        </p>
      )}
      {budgetShare !== null && budgetShare >= 0.8 && (
        <p className="alert alert-error" role="status">
          {budgetShare >= 1
            ? `Today’s spend (${fmtUsd(s.todayCostUsd)}) has reached the daily budget of ${fmtUsd(cfg.dailyBudgetUsd)}. Hosted calls are stopped for everyone until 00:00 UTC. Raise the budget below to resume earlier.`
            : `Today’s spend is ${fmtPct(budgetShare)} of the daily budget (${fmtUsd(s.todayCostUsd)} of ${fmtUsd(cfg.dailyBudgetUsd)}). At 100%, hosted calls stop for everyone until 00:00 UTC.`}
        </p>
      )}

      <div className="adm-kpis">
        <Kpi
          label="Model cost"
          value={fmtUsd(c.costUsd)}
          change={{ value: c.costUsd, previous: p.costUsd }}
          previousLabel={prevLabel(period)}
          lowerIsBetter
          hint="What the provider charges us"
        />
        <Kpi
          label="Credits used"
          value={fmtNumber(Math.round(c.credits * 10) / 10)}
          change={{ value: c.credits, previous: p.credits }}
          previousLabel={prevLabel(period)}
          hint={`${fmtInt(c.inputTokens + c.cacheRead + c.cacheWrite)} prompt · ${fmtInt(c.outputTokens)} output tokens`}
        />
        <Kpi label="Successful calls" value={fmtInt(c.calls)} change={{ value: c.calls, previous: p.calls }} previousLabel={prevLabel(period)} />
        <Kpi
          label="Errors"
          value={fmtInt(c.errors)}
          change={{ value: c.errors, previous: p.errors }}
          previousLabel={prevLabel(period)}
          lowerIsBetter
          hint={attempts ? `${fmtPct(c.errors / attempts)} of calls that reached the provider` : "No calls yet"}
        />
        <Kpi
          label="Refused calls"
          value={fmtInt(c.blocked)}
          change={{ value: c.blocked, previous: p.blocked }}
          previousLabel={prevLabel(period)}
          lowerIsBetter
          hint="Stopped before the provider: no credits, daily limit, pause or budget"
        />
        <Kpi
          label="Active users"
          value={fmtInt(c.activeUsers)}
          change={{ value: c.activeUsers, previous: p.activeUsers }}
          previousLabel={prevLabel(period)}
          hint="People with at least one successful call"
        />
        <Kpi
          label="Average latency"
          value={s.avgLatencyMs === null ? "–" : `${(s.avgLatencyMs / 1000).toFixed(1)} s`}
          hint="Per successful call, start to finish"
        />
        <Kpi label="Cache-hit ratio" value={fmtPct(s.cacheHitRatio)} hint="Cache reads ÷ all prompt tokens. Higher is cheaper." />
        <Kpi
          label="Cost per active user"
          value={s.costPerActiveUser === null ? "–" : fmtUsd(s.costPerActiveUser)}
          hint={`Over ${period === 1 ? "today" : `the last ${period} days`}`}
        />
        <Kpi
          label="Spent today"
          value={fmtUsd(s.todayCostUsd)}
          hint={
            budgetShare === null
              ? "No daily budget cap is set"
              : `${fmtPct(budgetShare)} of the ${fmtUsd(cfg.dailyBudgetUsd)} daily budget${budgetShare >= 0.8 ? " ⚠" : ""}`
          }
        />
        <Kpi
          label="Credits outstanding"
          value={fmtInt(s.outstandingCredits)}
          hint={`Up to ${fmtUsd(s.outstandingCredits / cfg.creditsPerUsd)} of model cost if all spent · ${fmtInt(s.accountsWithBalance)} accounts`}
        />
      </div>

      <div className="adm-grid-2">
        <Section title="Cost per day">
          <BarChart
            title={`Model cost (USD) per day, last ${s.chart.days.length} days`}
            labels={s.chart.days}
            values={s.chart.cost}
            color="var(--coral)"
            format={fmtUsd}
            integer={false}
          />
        </Section>
        <Section title="Calls per day">
          <LineChart title={`Successful calls per day, last ${s.chart.days.length} days`} labels={s.chart.days} values={s.chart.calls} />
        </Section>
      </div>

      <Section title="Top users by cost" sub={`The 20 people who cost the most, ${period === 1 ? "today" : `last ${period} days`}`}>
        {s.topUsers.length === 0 ? (
          <Empty>No theOovi calls in this period yet.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="num">Cost</th>
                  <th className="num">Credits</th>
                  <th className="num">Calls</th>
                  <th className="num">Errors</th>
                  <th className="num">Refused</th>
                </tr>
              </thead>
              <tbody>
                {s.topUsers.map((u) => (
                  <tr key={u.userId}>
                    <td>
                      <Link href={`/admin/users/${encodeURIComponent(u.userId)}`}>{u.email ?? u.userId}</Link>
                    </td>
                    <td className="num">{fmtUsd(u.costUsd)}</td>
                    <td className="num">{fmtNumber(Math.round(u.credits * 10) / 10)}</td>
                    <td className="num">{fmtInt(u.calls)}</td>
                    <td className="num">{fmtInt(u.errors)}</td>
                    <td className="num">{fmtInt(u.blocked)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Settings"
        sub="Everything about the hosted model. Saved changes reach new calls within about 15 seconds. Use the button at the top of the page to pause or resume."
      >
        <ActionForm action={saveAiSettings} submitLabel="Save settings">
          <fieldset className="adm-fieldset">
            <legend>Availability</legend>
            <label className="check">
              <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} />
              <span>
                <b>theOovi is on.</b> When off, the app hides it and only people’s own API keys work.
              </span>
            </label>
            <Field id="pausedMessage" label="Message while paused" help="Shown in the app when you press “Pause theOovi now”. 10 to 500 characters.">
              <textarea id="pausedMessage" name="pausedMessage" className="input" rows={2} maxLength={500} defaultValue={cfg.pausedMessage} required />
            </Field>
          </fieldset>

          <fieldset className="adm-fieldset">
            <legend>Model</legend>
            <div className="adm-fields adm-fields-wide">
              <Field id="displayName" label="Display name" help="The name people see in the app and on the website.">
                <input id="displayName" name="displayName" className="input" maxLength={40} defaultValue={cfg.displayName} required />
              </Field>
              <Field id="model" label="Provider model ID" help="The Anthropic model behind the name.">
                <input id="model" name="model" className="input adm-mono" maxLength={100} defaultValue={cfg.model} required />
              </Field>
              <Field id="backupModel" label="Backup model ID" help="Used only when the main model is down or overloaded. Empty = none.">
                <input id="backupModel" name="backupModel" className="input adm-mono" maxLength={100} defaultValue={cfg.backupModel} />
              </Field>
              <Field id="maxEffort" label="Maximum effort" help="The highest thinking effort the app may ask for.">
                <select id="maxEffort" name="maxEffort" className="input" defaultValue={cfg.maxEffort}>
                  {EFFORTS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </fieldset>

          <fieldset className="adm-fieldset">
            <legend>Prices (US dollars per million tokens)</legend>
            <p className="adm-help">Use the provider’s list prices. Every call is charged at these rates, so they decide both our cost numbers and the credits people pay.</p>
            <div className="adm-fields">
              <Field id="price_input" label="Input">
                <input id="price_input" name="price_input" className="input" type="number" min={0} max={1000} step="any" defaultValue={pr.input} required />
              </Field>
              <Field id="price_output" label="Output">
                <input id="price_output" name="price_output" className="input" type="number" min={0} max={1000} step="any" defaultValue={pr.output} required />
              </Field>
              <Field id="price_cacheRead" label="Cache read">
                <input id="price_cacheRead" name="price_cacheRead" className="input" type="number" min={0} max={1000} step="any" defaultValue={pr.cacheRead} required />
              </Field>
              <Field id="price_cacheWrite" label="Cache write">
                <input id="price_cacheWrite" name="price_cacheWrite" className="input" type="number" min={0} max={1000} step="any" defaultValue={pr.cacheWrite} required />
              </Field>
              <Field id="price_longAbove" label="Long context above (tokens)" help="Prompts bigger than this use the long-context prices. 0 = never.">
                <input id="price_longAbove" name="price_longAbove" className="input" type="number" min={0} max={10000000} step={1} defaultValue={pr.longAbove} required />
              </Field>
              <Field id="price_longInput" label="Long-context input">
                <input id="price_longInput" name="price_longInput" className="input" type="number" min={0} max={1000} step="any" defaultValue={pr.longInput} required />
              </Field>
              <Field id="price_longOutput" label="Long-context output">
                <input id="price_longOutput" name="price_longOutput" className="input" type="number" min={0} max={1000} step="any" defaultValue={pr.longOutput} required />
              </Field>
            </div>
          </fieldset>

          <fieldset className="adm-fieldset">
            <legend>Credits and limits</legend>
            <div className="adm-fields adm-fields-wide">
              <Field
                id="creditsPerUsd"
                label="Credits per US dollar of model cost"
                help={`Right now 1 credit = ${usdPerCredit(cfg.creditsPerUsd)} of model cost.`}
              >
                <input id="creditsPerUsd" name="creditsPerUsd" className="input" type="number" min={1} max={1000000} step="any" defaultValue={cfg.creditsPerUsd} required />
              </Field>
              <Field id="maxInputTokens" label="Maximum input tokens" help="Bigger requests are refused. The app shortens history to stay below it.">
                <input id="maxInputTokens" name="maxInputTokens" className="input" type="number" min={4000} max={1000000} step={1} defaultValue={cfg.maxInputTokens} required />
              </Field>
              <Field id="maxOutputTokens" label="Maximum output tokens" help="The longest answer one call may produce.">
                <input id="maxOutputTokens" name="maxOutputTokens" className="input" type="number" min={256} max={128000} step={1} defaultValue={cfg.maxOutputTokens} required />
              </Field>
              <Field id="maxConcurrent" label="Calls at the same time (per person)" help="1 to 50.">
                <input id="maxConcurrent" name="maxConcurrent" className="input" type="number" min={1} max={50} step={1} defaultValue={cfg.maxConcurrent} required />
              </Field>
              <Field
                id="dailyBudgetUsd"
                label="Daily budget, all users (USD)"
                help="Hosted calls stop for everyone for the rest of the UTC day once reached. 0 = no cap."
              >
                <input id="dailyBudgetUsd" name="dailyBudgetUsd" className="input" type="number" min={0} max={1000000} step="any" defaultValue={cfg.dailyBudgetUsd} required />
              </Field>
            </div>
          </fieldset>

          <fieldset className="adm-fieldset">
            <legend>New accounts and subscriptions</legend>
            <div className="adm-fields adm-fields-wide">
              <Field id="signupCredits" label="Welcome credits" help="Given once to every new account.">
                <input id="signupCredits" name="signupCredits" className="input" type="number" min={0} max={10000000} step={1} defaultValue={cfg.signupCredits} required />
              </Field>
              <Field
                id="signupGrantsPerNetwork"
                label="Welcome grants per network (30 days)"
                help="Stops mass sign-ups from one network. 0 = no cap."
              >
                <input
                  id="signupGrantsPerNetwork"
                  name="signupGrantsPerNetwork"
                  className="input"
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  defaultValue={cfg.signupGrantsPerNetwork}
                  required
                />
              </Field>
              <Field id="subscribeUrl" label="Subscribe link" help="Where “Subscribe” buttons go (https://). Empty = an email to contact@conuron.com.">
                <input id="subscribeUrl" name="subscribeUrl" className="input" type="url" maxLength={500} defaultValue={cfg.subscribeUrl} placeholder="https://" />
              </Field>
            </div>
          </fieldset>
        </ActionForm>
      </Section>

      <div className="adm-grid-2">
        <Section title="Provider API key" sub="The Anthropic key the hosted model uses. It is stored encrypted and is never shown again or sent to the app.">
          <dl className="adm-dl" style={{ marginBottom: 16 }}>
            <dt>Source</dt>
            <dd>
              {key.source === "console"
                ? "Saved in this console"
                : key.source === "env"
                  ? "ANTHROPIC_API_KEY environment variable"
                  : "None. Hosted calls fail until a key is added."}
            </dd>
            <dt>Key</dt>
            <dd className="adm-mono">{key.hint ? `sk-ant-${key.hint}` : "–"}</dd>
            <dt>Updated</dt>
            <dd>{key.updatedAt ? fmtDateTime(key.updatedAt) : "–"}</dd>
          </dl>
          <ActionForm action={replaceProviderKey} submitLabel={key.source === "none" ? "Save key" : "Replace key"} resetOnSuccess>
            <Field id="provider-key" label="New key" help="Starts with “sk-ant-”. A key saved here takes priority over the environment variable.">
              <input
                id="provider-key"
                name="key"
                className="input adm-mono"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                maxLength={300}
                placeholder="sk-ant-…"
                required
              />
            </Field>
          </ActionForm>
          {key.source === "console" && (
            <div style={{ marginTop: 14 }}>
              <ActionForm
                action={removeProviderKey}
                className="adm-form"
                submitLabel="Remove saved key"
                pendingLabel="Removing…"
                submitClassName="btn btn-ghost btn-sm"
                confirm={`Remove the key saved in the console?\n\n${process.env.ANTHROPIC_API_KEY ? "The ANTHROPIC_API_KEY environment variable will be used instead." : "No other key is set, so every hosted call will fail until you add one."}`}
              />
            </div>
          )}
        </Section>

        <Section title="Pilot program" sub="Accounts created between the two dates can ask for free credits on the website’s Pilot page.">
          <ActionForm action={savePilotSettings} submitLabel="Save pilot settings">
            <label className="check">
              <input type="checkbox" name="enabled" defaultChecked={pilot.enabled} />
              <span>
                <b>Accept new requests</b>
              </span>
            </label>
            <div className="adm-fields">
              <Field id="pilot-start" label="Start date (UTC)">
                <input id="pilot-start" name="startsAt" className="input" type="date" defaultValue={pilot.startsAt} required />
              </Field>
              <Field id="pilot-end" label="End date (UTC)" help="Inclusive.">
                <input id="pilot-end" name="endsAt" className="input" type="date" defaultValue={pilot.endsAt} required />
              </Field>
              <Field id="pilot-credits" label="Credits" help="Suggested for each approval. You can change it per request.">
                <input id="pilot-credits" name="credits" className="input" type="number" min={0} max={10000000} step={1} defaultValue={pilot.credits} required />
              </Field>
              <Field id="pilot-plan" label="Plan given">
                <select id="pilot-plan" name="plan" className="input" defaultValue={pilot.plan}>
                  {plans.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name} ({pl.id})
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="pilot-days" label="Plan length (days)">
                <input id="pilot-days" name="days" className="input" type="number" min={1} max={3650} step={1} defaultValue={pilot.days} required />
              </Field>
            </div>
          </ActionForm>
          <p className="adm-help" style={{ marginTop: 12 }}>
            <Link href="/admin/pilot" className="text-link">
              Review pilot requests
            </Link>
          </p>
        </Section>
      </div>

      <Section
        title="Plans"
        sub="Monthly credits are added when the plan starts and every 30 days while it lasts. Daily limit is in credits and resets at 00:00 UTC (0 = no daily limit). Only visible plans appear on the pricing page; the “free” plan is shown there as its own card."
      >
        <PlansEditor plans={plans} action={savePlansAction} />
      </Section>
    </>
  );
}
