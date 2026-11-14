// CSV reports for the admin console (Admin > Reports and the "Download CSV" buttons), so the numbers can be
// opened in a spreadsheet or handed over for analysis. Admin only: the route that serves them checks the admin,
// and every download is written to the audit log (some reports contain people's emails).
//
// Rules: dates are ISO 8601 in UTC; money is in major units (10.5 = $10.50) with the currency in its own column;
// text that starts with = + - @ is prefixed with an apostrophe so a spreadsheet can't run it as a formula
// (feedback and names are typed by other people); the file starts with a BOM so Excel reads Arabic correctly.
import { pool } from "./db";
import { planForPrice } from "./billing";
import { USAGE_COUNT_KEYS, USAGE_TOTAL_KEYS } from "./telemetry";
import { assess, getSignals, type Signals } from "./user-signals";
import { CALL, FACES, HEARD, IMPROVE, LANGUAGES, MOBILE, PAY, PAY_METHODS, ROLES, SYSTEMS, TOOLS, USES, labelOf, labelsOf, readAnswers } from "./pilot-form";

export const ROW_LIMIT = 100_000;

export type Table = { headers: string[]; rows: unknown[][]; truncated: boolean };
export type ReportDef = {
  key: string;
  group: "Money" | "Product use" | "People";
  title: string;
  description: string;
  /** false = always everything (a list of people or subscriptions as they are now). */
  period: boolean;
  build: (days: number | null) => Promise<Table>;
};

// ---------- CSV ----------

const formula = /^[=+\-@\t\r]/;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) s = Number.isNaN(v.getTime()) ? "" : v.toISOString();
  else if (typeof v === "boolean") s = v ? "yes" : "no";
  else if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  else s = String(v);
  s = s.replace(/\u0000/g, "");
  if (formula.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(t: Table): string {
  return "﻿" + [t.headers, ...t.rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** "30", "365" or "all" from the URL. Anything else means the last 90 days. */
export function parseReportPeriod(v: string | null | undefined): number | null {
  if (v === "all") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : 90;
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

/** Paddle stores money in the currency's smallest unit; reports show the normal unit. */
function major(v: unknown, currency: unknown): number {
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency: String(currency || "USD") }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // unknown currency code: two decimals
  }
  return Math.round(num(v)) / 10 ** digits;
}

const WHEN = (col: string) => `($1::int IS NULL OR ${col} >= now() - make_interval(days => $1::int))`;
const DAY = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

function table(headers: string[], rows: unknown[][]): Table {
  return { headers, rows: rows.slice(0, ROW_LIMIT), truncated: rows.length > ROW_LIMIT };
}

// ---------- money ----------

async function payments(days: number | null): Promise<Table> {
  const { rows } = await pool.query(
    `SELECT p.billed_at, p.transaction_id, COALESCE(c.email, u.email) AS email, p.plan_id, p.billing_interval, p.origin, p.currency,
            p.subtotal, p.tax, p.total, p.payout_currency, p.payout_subtotal, p.payout_tax, p.payout_total, p.payout_fee, p.payout_earnings,
            (t.refunded_at IS NOT NULL) AS refunded
       FROM paddle_payments p
       LEFT JOIN customers c ON c.customer_id = p.customer_id
       LEFT JOIN "user" u ON u.id = p.user_id
       LEFT JOIN paddle_transactions t ON t.transaction_id = p.transaction_id
      WHERE ${WHEN("p.billed_at")}
      ORDER BY p.billed_at DESC LIMIT ${ROW_LIMIT + 1}`,
    [days],
  );
  return table(
    ["billed_at_utc", "transaction_id", "customer_email", "plan", "interval", "origin", "charged_currency", "charged_subtotal", "charged_tax", "charged_total",
      "payout_currency", "payout_subtotal", "payout_tax", "payout_total", "paddle_fee", "your_earnings", "refunded"],
    rows.map((r) => [
      iso(r.billed_at), r.transaction_id, r.email, r.plan_id, r.billing_interval, r.origin, r.currency,
      major(r.subtotal, r.currency), major(r.tax, r.currency), major(r.total, r.currency),
      r.payout_currency, major(r.payout_subtotal, r.payout_currency), major(r.payout_tax, r.payout_currency), major(r.payout_total, r.payout_currency),
      major(r.payout_fee, r.payout_currency), major(r.payout_earnings, r.payout_currency), r.refunded,
    ]),
  );
}

async function refunds(days: number | null): Promise<Table> {
  const { rows } = await pool.query(
    `SELECT a.paddle_created_at, a.adjustment_id, a.transaction_id, c.email, a.action, a.type, a.status, a.reason, a.currency, a.total,
            a.payout_currency, a.payout_total, a.payout_fee, a.payout_earnings, a.chargeback_fee
       FROM paddle_adjustments a LEFT JOIN customers c ON c.customer_id = a.customer_id
      WHERE ${WHEN("a.paddle_created_at")}
      ORDER BY a.paddle_created_at DESC LIMIT ${ROW_LIMIT + 1}`,
    [days],
  );
  return table(
    ["created_utc", "adjustment_id", "transaction_id", "customer_email", "action", "type", "status", "reason", "currency", "total", "payout_currency", "payout_total", "payout_fee", "payout_earnings", "chargeback_fee"],
    rows.map((r) => [
      iso(r.paddle_created_at), r.adjustment_id, r.transaction_id, r.email, r.action, r.type, r.status, r.reason, r.currency, major(r.total, r.currency),
      r.payout_currency, major(r.payout_total, r.payout_currency), major(r.payout_fee, r.payout_currency), major(r.payout_earnings, r.payout_currency), major(r.chargeback_fee, r.payout_currency),
    ]),
  );
}

async function financeDaily(days: number | null): Promise<Table> {
  const [pay, adj] = await Promise.all([
    pool.query(
      `SELECT ${DAY("billed_at")} AS day, count(*) AS payments,
              COALESCE(sum(payout_subtotal) FILTER (WHERE payout_currency = 'USD'), 0) AS gross, COALESCE(sum(payout_tax) FILTER (WHERE payout_currency = 'USD'), 0) AS tax,
              COALESCE(sum(payout_fee) FILTER (WHERE payout_currency = 'USD'), 0) AS fees, COALESCE(sum(payout_earnings) FILTER (WHERE payout_currency = 'USD'), 0) AS earnings,
              count(*) FILTER (WHERE payout_currency IS DISTINCT FROM 'USD') AS other_currency
         FROM paddle_payments WHERE ${WHEN("billed_at")} GROUP BY 1`,
      [days],
    ),
    pool.query(
      `SELECT ${DAY("paddle_created_at")} AS day, count(*) AS refunds, COALESCE(sum(payout_total) FILTER (WHERE payout_currency = 'USD'), 0) AS refunded
         FROM paddle_adjustments WHERE status = 'approved' AND action IN ('refund', 'chargeback') AND ${WHEN("paddle_created_at")} GROUP BY 1`,
      [days],
    ),
  ]);
  const byDay = new Map<string, { p?: Record<string, unknown>; a?: Record<string, unknown> }>();
  for (const r of pay.rows) byDay.set(String(r.day), { p: r });
  for (const r of adj.rows) byDay.set(String(r.day), { ...(byDay.get(String(r.day)) ?? {}), a: r });
  const out = [...byDay.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1)).map(([day, v]) => [
    day, num(v.p?.payments), major(v.p?.gross, "USD"), major(v.p?.tax, "USD"), major(v.p?.fees, "USD"), major(v.p?.earnings, "USD"),
    num(v.a?.refunds), Math.abs(major(v.a?.refunded, "USD")), num(v.p?.other_currency),
  ]);
  return table(["day_utc", "payments", "gross_usd", "tax_usd", "paddle_fees_usd", "earnings_usd", "refunds_and_chargebacks", "refunded_usd", "payments_in_other_currencies"], out);
}

async function subscriptions(): Promise<Table> {
  const { rows } = await pool.query(
    `SELECT s.subscription_id, COALESCE(c.email, u.email) AS email, s.status, s.price_id, s.billing_interval, s.current_period_ends_at,
            s.scheduled_change_action, s.scheduled_change_at, s.created_at, s.updated_at
       FROM subscriptions s LEFT JOIN customers c ON c.customer_id = s.customer_id LEFT JOIN "user" u ON u.id = s.user_id
      ORDER BY s.created_at DESC LIMIT ${ROW_LIMIT + 1}`,
  );
  return table(
    ["subscription_id", "customer_email", "status", "plan", "interval", "current_period_ends_utc", "scheduled_change", "scheduled_change_utc", "created_utc", "updated_utc"],
    rows.map((r) => [
      r.subscription_id, r.email, r.status, planForPrice(String(r.price_id))?.planId ?? "unknown", r.billing_interval, iso(r.current_period_ends_at),
      r.scheduled_change_action, iso(r.scheduled_change_at), iso(r.created_at), iso(r.updated_at),
    ]),
  );
}

async function creditsLedger(days: number | null): Promise<Table> {
  const { rows } = await pool.query(
    `SELECT l.created_at, u.email, l.delta_mc, l.kind, l.note, l.actor
       FROM credit_ledger l LEFT JOIN "user" u ON u.id = l.user_id
      WHERE ${WHEN("l.created_at")} ORDER BY l.created_at DESC, l.id DESC LIMIT ${ROW_LIMIT + 1}`,
    [days],
  );
  return table(["created_utc", "email", "credits_change", "kind", "note", "by"], rows.map((r) => [iso(r.created_at), r.email, num(r.delta_mc) / 1000, r.kind, r.note, r.actor]));
}

// ---------- product use ----------

async function aiUsage(days: number | null): Promise<Table> {
  const { rows } = await pool.query(
    `SELECT to_char(a.day, 'YYYY-MM-DD') AS day, u.email, a.calls, a.errors, a.blocked, a.input_tokens, a.output_tokens, a.cache_read, a.cache_write,
            a.cost_usd, a.credits_mc, a.latency_ms
       FROM ai_usage_daily a LEFT JOIN "user" u ON u.id = a.user_id
      WHERE ($1::int IS NULL OR a.day >= (now() AT TIME ZONE 'UTC')::date - ($1::int - 1))
      ORDER BY a.day DESC, a.cost_usd DESC LIMIT ${ROW_LIMIT + 1}`,
    [days],
  );
  return table(
    ["day_utc", "email", "theoovi_requests", "errors", "blocked", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd", "credits_used", "avg_latency_ms"],
    rows.map((r) => [r.day, r.email, num(r.calls), num(r.errors), num(r.blocked), num(r.input_tokens), num(r.output_tokens), num(r.cache_read), num(r.cache_write),
      num(r.cost_usd), num(r.credits_mc) / 1000, num(r.calls) > 0 ? Math.round(num(r.latency_ms) / num(r.calls)) : null]),
  );
}

async function appUsage(days: number | null): Promise<Table> {
  const { rows } = await pool.query(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, u.email, d.app_version, d.platform, d.counts, d.totals
       FROM usage_daily d LEFT JOIN "user" u ON u.id = d.user_id
      WHERE ($1::int IS NULL OR d.day >= (now() AT TIME ZONE 'UTC')::date - ($1::int - 1))
      ORDER BY d.day DESC LIMIT ${ROW_LIMIT + 1}`,
    [days],
  );
  const get = (o: unknown, k: string) => (o && typeof o === "object" ? num((o as Record<string, unknown>)[k]) : null);
  return table(
    ["day", "email", "app_version", "platform", ...USAGE_COUNT_KEYS, ...USAGE_TOTAL_KEYS.map((k) => `total_${k}`)],
    rows.map((r) => [r.day, r.email, r.app_version, r.platform, ...USAGE_COUNT_KEYS.map((k) => get(r.counts, k)), ...USAGE_TOTAL_KEYS.map((k) => get(r.totals, k))]),
  );
}

async function activity(days: number | null): Promise<Table> {
  const { rows } = await pool.query(
    `SELECT ${DAY("created_at")} AS day, kind, COALESCE(platform, data->>'platform') AS platform, app_version, data->>'country' AS country, data->>'target' AS target,
            count(*) AS events, count(DISTINCT user_id) AS people
       FROM app_events WHERE ${WHEN("created_at")}
      GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 1 DESC, 2, 7 DESC LIMIT ${ROW_LIMIT + 1}`,
    [days],
  );
  return table(
    ["day_utc", "kind", "platform", "app_version", "country", "download_target", "events", "different_people"],
    rows.map((r) => [r.day, r.kind, r.platform, r.app_version, r.country, r.target, num(r.events), num(r.people)]),
  );
}

async function crashes(days: number | null): Promise<Table> {
  const { rows } = await pool.query(
    `SELECT c.id, c.created_at, c.app_version, c.platform, u.email, left(c.message, 500) AS message, left(split_part(COALESCE(c.stack, ''), E'\\n', 2), 300) AS where_it_failed
       FROM crash_reports c LEFT JOIN "user" u ON u.id = c.user_id
      WHERE ${WHEN("c.created_at")} ORDER BY c.created_at DESC LIMIT ${ROW_LIMIT + 1}`,
    [days],
  );
  return table(["id", "created_utc", "app_version", "platform", "email", "message", "where_it_failed"], rows.map((r) => [num(r.id), iso(r.created_at), r.app_version, r.platform, r.email, r.message, r.where_it_failed]));
}

// ---------- people ----------

async function users(): Promise<Table> {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u."createdAt" AS created, u."emailVerified" AS verified, u.oovi_status, u.last_seen_at, u.last_app_version, u.last_platform,
            ca.plan, ca.balance_mc, ca.total_used_mc, COALESCE(a.calls, 0) AS calls, COALESCE(a.cost, 0) AS cost
       FROM "user" u
       LEFT JOIN credit_accounts ca ON ca.user_id = u.id
       LEFT JOIN (SELECT user_id, sum(calls) AS calls, sum(cost_usd) AS cost FROM ai_usage_daily GROUP BY user_id) a ON a.user_id = u.id
      ORDER BY u."createdAt" DESC LIMIT ${ROW_LIMIT + 1}`,
  );
  // The signals (country, where they came from, how they use theOovi) may not exist yet: those columns stay empty.
  const signals = new Map<string, Signals>();
  for (let i = 0; i < rows.length; i += 2000) {
    const part = await getSignals(rows.slice(i, i + 2000).map((r) => String(r.id)));
    if (!part) break;
    for (const [k, v] of part) signals.set(k, v);
  }
  return table(
    ["id", "email", "name", "created_utc", "email_confirmed", "blocked", "signup_country", "last_country", "signed_up_through", "came_from", "last_seen_in_app_utc", "app_version", "platform",
      "plan", "credits_balance", "credits_used_total", "theoovi_requests", "theoovi_cost_usd", "first_request_utc", "last_request_utc", "requests_from_app", "requests_without_app_headers",
      "requests_with_tools", "other_accounts_same_network", "check", "check_reasons"],
    rows.map((r) => {
      const s = signals.get(String(r.id));
      const v = s ? assess({ id: String(r.id), email: String(r.email), createdAt: iso(r.created), emailVerified: r.verified === true, lastSeenAt: iso(r.last_seen_at) }, s) : null;
      return [
        r.id, r.email, r.name, iso(r.created), r.verified === true, r.oovi_status === "blocked", s?.signupCountry, s?.lastCountry, s?.signupVia, s?.signupRef,
        iso(r.last_seen_at), r.last_app_version, r.last_platform, r.plan, r.balance_mc === null ? null : num(r.balance_mc) / 1000, r.total_used_mc === null ? null : num(r.total_used_mc) / 1000,
        num(r.calls), num(r.cost), s?.firstAiAt, s?.lastAiAt, s?.appCalls, s?.directCalls, s?.toolCalls, s?.sameNetwork, v?.level, v?.reasons.join(" | "),
      ];
    }),
  );
}

async function feedback(days: number | null): Promise<Table> {
  const { rows } = await pool.query(
    `SELECT f.id, f.created_at, f.kind, f.source, f.status, u.email, f.app_version, f.platform, f.message, f.admin_note
       FROM feedback f LEFT JOIN "user" u ON u.id = f.user_id
      WHERE ${WHEN("f.created_at")} ORDER BY f.created_at DESC LIMIT ${ROW_LIMIT + 1}`,
    [days],
  );
  return table(["id", "created_utc", "kind", "source", "status", "email", "app_version", "platform", "message", "your_note"], rows.map((r) => [num(r.id), iso(r.created_at), r.kind, r.source, r.status, r.email, r.app_version, r.platform, r.message, r.admin_note]));
}

async function pilot(days: number | null): Promise<Table> {
  // "p.*" so the query still works before the answers column exists.
  const { rows } = await pool.query(
    `SELECT p.*, u.email
       FROM pilot_requests p LEFT JOIN "user" u ON u.id = p.user_id
      WHERE ${WHEN("p.created_at")} ORDER BY p.created_at DESC LIMIT ${ROW_LIMIT + 1}`,
    [days],
  );
  return table(
    ["id", "requested_utc", "email", "status", "who", "company", "team_size", "computer", "uses_oovi_for", "languages", "ai_tools_today", "heard_from", "first_try_1_to_5", "first_try_word",
      "usefulness_1_to_5", "improve_first", "can_pay_with", "would_pay_per_month", "phone_app", "call_15_min", "contact", "may_quote", "note", "credits_given", "reviewed_by", "reviewed_utc", "your_note"],
    rows.map((r) => {
      const a = readAnswers(r.answers);
      const face = a ? FACES.find((f) => f.value === a.experience) : undefined;
      return [
        num(r.id), iso(r.created_at), r.email, r.status, a ? labelOf(ROLES, a.role) : r.role, r.organization, r.team_size, a ? labelOf(SYSTEMS, a.system) : null,
        a ? labelsOf(USES, a.uses) : r.use_case, a ? labelsOf(LANGUAGES, a.languages) : null, a ? labelsOf(TOOLS, a.tools) : null,
        a ? (a.heard === "other" && a.heardOther ? a.heardOther : labelOf(HEARD, a.heard)) : null, a?.experience || null, face?.label, a?.usefulness,
        a ? labelsOf(IMPROVE, a.improve) : null, a ? labelsOf(PAY_METHODS, a.payMethods) : null, a?.pay ? labelOf(PAY, a.pay) : null, a?.mobile ? labelOf(MOBILE, a.mobile) : null,
        a?.call ? labelOf(CALL, a.call) : null, a?.contact, a?.quote === undefined ? null : a.quote, a?.extra ?? (a ? null : r.use_case), r.credits, r.reviewed_by, iso(r.reviewed_at), r.admin_note,
      ];
    }),
  );
}

export const REPORTS: ReportDef[] = [
  { key: "payments", group: "Money", title: "Payments", period: true, build: payments,
    description: "Every payment Paddle reported: what the customer paid, tax, Paddle's fee and what you earn, with the plan and whether it was refunded." },
  { key: "refunds", group: "Money", title: "Refunds and chargebacks", period: true, build: refunds,
    description: "Every refund, chargeback and credit with its status, reason and amounts." },
  { key: "finance-daily", group: "Money", title: "Money per day (USD)", period: true, build: financeDaily,
    description: "One row per day: payments, gross, tax, Paddle fees, earnings, refunds. Good for charts." },
  { key: "subscriptions", group: "Money", title: "Subscriptions now", period: false, build: subscriptions,
    description: "Every subscription as it is today: customer, plan, status, when it renews and any scheduled cancellation." },
  { key: "credits", group: "Money", title: "Credits ledger", period: true, build: creditsLedger,
    description: "Every change to anyone's credits: welcome credits, pilot, payments, refunds, and your own adjustments." },
  { key: "ai-usage", group: "Product use", title: "theOovi usage per person per day", period: true, build: aiUsage,
    description: "Requests, tokens, cost in dollars and credits used, per person and day. This is what the AI costs you." },
  { key: "app-usage", group: "Product use", title: "App usage per person per day", period: true, build: appUsage,
    description: "What the desktop app reports each day: messages, bot replies, tool calls, files, searches and how many bots, groups and connectors people have. Counts only, never chat content." },
  { key: "activity", group: "Product use", title: "Downloads and app opens per day", period: true, build: activity,
    description: "Download clicks and app opens by day, system, version and country. Good for seeing which campaign worked." },
  { key: "crashes", group: "Product use", title: "Crash reports", period: true, build: crashes,
    description: "Every crash with the version, system and the first line of where it failed." },
  { key: "users", group: "People", title: "All accounts", period: false, build: users,
    description: "Everyone with an account: when they joined, country, where they came from, plan and credits, how they use theOovi, and the Normal/Watch/Suspicious check with its reasons." },
  { key: "feedback", group: "People", title: "Feedback", period: true, build: feedback,
    description: "Every problem and idea people sent, with who, version and system, and your own notes." },
  { key: "pilot", group: "People", title: "Pilot requests", period: true, build: pilot,
    description: "Every pilot request: who asked, what they will use oovi for, and what you decided." },
];
