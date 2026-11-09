// Paddle billing, driven only by verified webhooks (app/api/paddle/webhook):
// - mirrors Paddle customers and subscriptions into the customers / subscriptions tables,
// - gives credits and the plan for every completed subscription payment (once per payment),
// - takes them back when a payment is fully refunded or charged back.
//
// Deliveries can repeat and arrive out of order, so every write is an upsert keyed on the Paddle
// ID, subscription and customer rows only move forward in Paddle's own updated_at order, and a
// payment grants credits at most once (paddle_transactions primary key).
//
// These rows are live billing state, mirrored from real events: never delete them to tidy up.
import type {
  AdjustmentNotification,
  CustomerNotification,
  EventEntity,
  SubscriptionNotification,
  TransactionNotification,
} from "@paddle/paddle-node-sdk";
import type { PoolClient } from "pg";
import { planById } from "./ai-config";
import { ensureAccount, inTx, MC } from "./credits";
import { pool } from "./db";
import { TIERS } from "./pricing-tiers";

/** Extra days a paid plan lasts after its billing period, so a renewal paid a little late doesn't cut access. */
const GRACE_MS = 3 * 86_400_000;
const DAY_MS = 86_400_000;

type Interval = "month" | "year";

/** Which oovi plan a Paddle price sells (lib/pricing-tiers.ts). */
export function planForPrice(priceId: string): { planId: string; interval: Interval } | null {
  for (const t of TIERS) {
    if (!t.planId) continue;
    if (t.priceId.month === priceId) return { planId: t.planId, interval: "month" };
    if (t.priceId.year === priceId) return { planId: t.planId, interval: "year" };
  }
  return null;
}

/**
 * Does a subscription in this status give paid access? active and trialing do. past_due does
 * too while Paddle retries the payment (its dunning period); it ends as canceled if that fails.
 * paused and canceled don't. A scheduled change (cancel or pause at the end of the period) never
 * removes access by itself: only the status changing does.
 */
export function statusGrantsAccess(status: string): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

/** Has this oovi account a Paddle subscription that currently gives paid access? */
export async function userHasPaidAccess(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ status: string }>("SELECT status FROM subscriptions WHERE user_id = $1", [userId]);
  return rows.some((r) => statusGrantsAccess(r.status));
}

/** The signed-in account's Paddle customer and its subscriptions, for the billing portal. */
export async function billingFor(userId: string): Promise<{ customerId: string; subscriptionIds: string[]; status: string | null } | null> {
  const c = await pool.query<{ customer_id: string }>(
    "SELECT customer_id FROM customers WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1",
    [userId],
  );
  const customerId = c.rows[0]?.customer_id;
  if (!customerId) return null;
  const s = await pool.query<{ subscription_id: string; status: string }>(
    "SELECT subscription_id, status FROM subscriptions WHERE customer_id = $1 ORDER BY updated_at DESC",
    [customerId],
  );
  const live = s.rows.filter((r) => r.status !== "canceled");
  return { customerId, subscriptionIds: live.map((r) => r.subscription_id), status: s.rows[0]?.status ?? null };
}

// ---------- matching a Paddle customer to an oovi account ----------

function checkoutUserId(customData: unknown): string | null {
  const v = customData && typeof customData === "object" ? (customData as Record<string, unknown>).userId : undefined;
  return typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;
}

async function userExists(c: PoolClient, id: string): Promise<boolean> {
  return ((await c.query('SELECT 1 FROM "user" WHERE id = $1', [id])).rowCount ?? 0) > 0;
}

async function userByEmail(c: PoolClient, email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const { rows } = await c.query<{ id: string }>('SELECT id FROM "user" WHERE lower(email) = lower($1) LIMIT 1', [email]);
  return rows[0]?.id ?? null;
}

/** The oovi account: the one signed in at checkout, else the one already linked to the Paddle customer, else the same email. */
async function resolveUser(c: PoolClient, customData: unknown, customerId: string | null): Promise<string | null> {
  const fromCheckout = checkoutUserId(customData);
  if (fromCheckout && (await userExists(c, fromCheckout))) return fromCheckout;
  if (!customerId) return null;
  const { rows } = await c.query<{ user_id: string | null; email: string }>("SELECT user_id, email FROM customers WHERE customer_id = $1", [customerId]);
  return rows[0]?.user_id ?? (await userByEmail(c, rows[0]?.email));
}

/** Make sure the customer row exists (a subscription can arrive before its customer.created). */
async function ensureCustomer(c: PoolClient, customerId: string, userId: string | null) {
  await c.query(
    `INSERT INTO customers (customer_id, user_id) VALUES ($1, $2)
     ON CONFLICT (customer_id) DO UPDATE SET user_id = COALESCE(customers.user_id, EXCLUDED.user_id), updated_at = now()`,
    [customerId, userId],
  );
}

/** Moves the account back to Free if it is on this plan. Credits already given stay. */
async function endPlan(c: PoolClient, userId: string, planId: string, note: string) {
  const r = await c.query(
    "UPDATE credit_accounts SET plan = 'free', plan_until = NULL, plan_renews_at = NULL, updated_at = now() WHERE user_id = $1 AND plan = $2",
    [userId, planId],
  );
  if (r.rowCount) await c.query("INSERT INTO credit_ledger (user_id, delta_mc, kind, note, actor) VALUES ($1, 0, 'paddle', $2, 'paddle')", [userId, note.slice(0, 300)]);
}

// ---------- event handlers ----------

export async function onCustomer(cu: CustomerNotification): Promise<void> {
  await inTx(async (c) => {
    const userId = checkoutUserId(cu.customData) ?? (await userByEmail(c, cu.email));
    await c.query(
      `INSERT INTO customers (customer_id, user_id, email, paddle_updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (customer_id) DO UPDATE SET
         email = CASE WHEN customers.paddle_updated_at IS NULL OR EXCLUDED.paddle_updated_at >= customers.paddle_updated_at
                      THEN EXCLUDED.email ELSE customers.email END,
         paddle_updated_at = GREATEST(customers.paddle_updated_at, EXCLUDED.paddle_updated_at),
         user_id = COALESCE(customers.user_id, EXCLUDED.user_id),
         updated_at = now()`,
      [cu.id, userId, cu.email, cu.updatedAt],
    );
    // Subscriptions that arrived before we knew whose they were.
    await c.query(
      `UPDATE subscriptions s SET user_id = cu.user_id, updated_at = now()
         FROM customers cu WHERE cu.customer_id = $1 AND s.customer_id = cu.customer_id AND s.user_id IS NULL AND cu.user_id IS NOT NULL`,
      [cu.id],
    );
  });
}

export async function onSubscription(s: SubscriptionNotification): Promise<void> {
  const item = s.items.find((i) => i.price && planForPrice(i.price.id)) ?? s.items[0];
  const priceId = item?.price?.id ?? "";
  const plan = priceId ? planForPrice(priceId) : null;
  await inTx(async (c) => {
    const userId = await resolveUser(c, s.customData, s.customerId);
    await ensureCustomer(c, s.customerId, userId);
    const r = await c.query<{ user_id: string | null }>(
      `INSERT INTO subscriptions (subscription_id, customer_id, user_id, status, price_id, product_id, billing_interval,
                                  current_period_ends_at, scheduled_change_action, scheduled_change_at, paddle_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (subscription_id) DO UPDATE SET
         status = EXCLUDED.status, price_id = EXCLUDED.price_id, product_id = EXCLUDED.product_id,
         billing_interval = EXCLUDED.billing_interval, current_period_ends_at = EXCLUDED.current_period_ends_at,
         scheduled_change_action = EXCLUDED.scheduled_change_action, scheduled_change_at = EXCLUDED.scheduled_change_at,
         paddle_updated_at = EXCLUDED.paddle_updated_at,
         user_id = COALESCE(subscriptions.user_id, EXCLUDED.user_id), updated_at = now()
       WHERE subscriptions.paddle_updated_at IS NULL OR EXCLUDED.paddle_updated_at >= subscriptions.paddle_updated_at
       RETURNING user_id`,
      [
        s.id,
        s.customerId,
        userId,
        s.status,
        priceId,
        item?.price?.productId ?? "",
        s.billingCycle?.interval ?? null,
        s.currentBillingPeriod?.endsAt ?? null,
        s.scheduledChange?.action ?? null,
        s.scheduledChange?.effectiveAt ?? null,
        s.updatedAt,
      ],
    );
    if (!r.rowCount) return; // an older event than what we already have
    const owner = r.rows[0]?.user_id;
    // Paused or canceled: the paid plan ends now. Credits already given stay.
    if (owner && plan && !statusGrantsAccess(s.status)) await endPlan(c, owner, plan.planId, `Paddle subscription ${s.status}`);
  });
}

// ---------- money (Admin > Finance) ----------

/** Paddle amounts are strings in the currency's smallest unit ("1000" = $10.00). */
const units = (v: string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** The money side of every completed payment (plans or not): what was charged, Paddle's fee, what you earn. */
async function recordPayment(t: TransactionNotification): Promise<void> {
  const totals = t.details?.totals;
  if (!totals) return;
  const payout = t.details?.payoutTotals ?? null;
  const item = t.items.find((i) => i.price && planForPrice(i.price.id)) ?? t.items[0];
  const sold = item?.price ? planForPrice(item.price.id) : null;
  await inTx(async (c) => {
    const userId = await resolveUser(c, t.customData, t.customerId);
    await c.query(
      `INSERT INTO paddle_payments (transaction_id, subscription_id, customer_id, user_id, origin, price_id, plan_id, billing_interval,
                                    currency, subtotal, tax, total, payout_currency, payout_subtotal, payout_tax, payout_total,
                                    payout_fee, payout_earnings, billed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (transaction_id) DO UPDATE SET
         subtotal = EXCLUDED.subtotal, tax = EXCLUDED.tax, total = EXCLUDED.total,
         payout_currency = EXCLUDED.payout_currency, payout_subtotal = EXCLUDED.payout_subtotal, payout_tax = EXCLUDED.payout_tax,
         payout_total = EXCLUDED.payout_total, payout_fee = EXCLUDED.payout_fee, payout_earnings = EXCLUDED.payout_earnings,
         user_id = COALESCE(paddle_payments.user_id, EXCLUDED.user_id)`,
      [
        t.id,
        t.subscriptionId,
        t.customerId,
        userId,
        t.origin ?? null,
        item?.price?.id ?? null,
        sold?.planId ?? null,
        sold?.interval ?? item?.price?.billingCycle?.interval ?? null,
        totals.currencyCode,
        units(totals.subtotal),
        units(totals.tax),
        units(totals.total),
        payout?.currencyCode ?? null,
        units(payout?.subtotal),
        units(payout?.tax),
        units(payout?.total),
        units(payout?.fee),
        units(payout?.earnings),
        t.billedAt ?? t.updatedAt,
      ],
    );
  });
}

/** Refunds, chargebacks and credits as Paddle reports them (pending, approved, rejected...), newest state wins. */
async function recordAdjustment(a: AdjustmentNotification): Promise<void> {
  const p = a.payoutTotals;
  await pool.query(
    `INSERT INTO paddle_adjustments (adjustment_id, transaction_id, subscription_id, customer_id, action, type, status, reason, currency, total,
                                     payout_currency, payout_subtotal, payout_total, payout_fee, payout_earnings, chargeback_fee,
                                     paddle_created_at, paddle_updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (adjustment_id) DO UPDATE SET
       status = EXCLUDED.status, type = EXCLUDED.type, total = EXCLUDED.total, payout_currency = EXCLUDED.payout_currency,
       payout_subtotal = EXCLUDED.payout_subtotal, payout_total = EXCLUDED.payout_total, payout_fee = EXCLUDED.payout_fee,
       payout_earnings = EXCLUDED.payout_earnings, chargeback_fee = EXCLUDED.chargeback_fee,
       paddle_updated_at = EXCLUDED.paddle_updated_at, updated_at = now()
     WHERE paddle_adjustments.paddle_updated_at IS NULL OR EXCLUDED.paddle_updated_at >= paddle_adjustments.paddle_updated_at`,
    [
      a.id,
      a.transactionId,
      a.subscriptionId,
      a.customerId,
      a.action,
      a.type ?? null,
      a.status,
      a.reason?.slice(0, 300) ?? null,
      a.totals.currencyCode,
      units(a.totals.total),
      p?.currencyCode ?? null,
      units(p?.subtotal),
      units(p?.total),
      units(p?.fee),
      units(p?.earnings),
      units(p?.chargebackFee?.amount),
      a.createdAt,
      a.updatedAt,
    ],
  );
}

/**
 * A completed payment: for a plan, put the account on the plan and give this period's credits
 * (once), then record its money. Credits come first: if recording fails, the error makes Paddle
 * deliver the event again, and the credit step skips what it already did.
 */
export async function onTransactionCompleted(t: TransactionNotification): Promise<void> {
  await grantPlan(t);
  await recordPayment(t);
}

/** Put the account on the plan this payment bought and give this period's credits, once. */
async function grantPlan(t: TransactionNotification): Promise<void> {
  const item = t.items.find((i) => i.price && planForPrice(i.price.id));
  if (!item?.price) return; // not a plan payment
  const sold = planForPrice(item.price.id)!;
  const plan = await planById(sold.planId);
  if (plan.id !== sold.planId) {
    // Fail so Paddle retries: the plan must exist in Admin > theOovi plans before credits can be given.
    throw new Error(`Plan "${sold.planId}" isn't set up in Admin > theOovi plans (payment ${t.id}).`);
  }
  const userId = await inTx((c) => resolveUser(c, t.customData, t.customerId));
  if (userId) await ensureAccount(userId, null); // creates the credits account the usual way if needed

  const periodEnd = t.billingPeriod?.endsAt
    ? new Date(t.billingPeriod.endsAt)
    : new Date(Date.now() + (sold.interval === "year" ? 365 : 30) * DAY_MS);
  const creditsMc = userId ? plan.monthlyCredits * MC : 0;

  await inTx(async (c) => {
    if (t.customerId) await ensureCustomer(c, t.customerId, userId);
    const ins = await c.query(
      `INSERT INTO paddle_transactions (transaction_id, user_id, customer_id, subscription_id, price_id, plan_id, credits_mc, period_ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (transaction_id) DO NOTHING`,
      [t.id, userId, t.customerId, t.subscriptionId, item.price!.id, sold.planId, creditsMc, periodEnd],
    );
    if (!ins.rowCount) return; // this payment was already handled
    if (!userId) {
      console.error(`[billing] payment ${t.id} (customer ${t.customerId}) matches no oovi account; no credits given. Give them in Admin > Users.`);
      return;
    }
    if (t.subscriptionId) {
      await c.query("UPDATE subscriptions SET user_id = COALESCE(user_id, $2), updated_at = now() WHERE subscription_id = $1", [t.subscriptionId, userId]);
    }
    // Monthly: the next payment renews the plan. Yearly: monthly top-ups through the year (lib/credits.ts syncPlan).
    const until = new Date(periodEnd.getTime() + GRACE_MS);
    const renews = sold.interval === "year" ? new Date(Date.now() + 30 * DAY_MS) : null;
    await c.query(
      "UPDATE credit_accounts SET plan = $2, plan_until = $3, plan_renews_at = $4, balance_mc = balance_mc + $5, updated_at = now() WHERE user_id = $1",
      [userId, sold.planId, until, renews, creditsMc],
    );
    await c.query("INSERT INTO credit_ledger (user_id, delta_mc, kind, note, actor) VALUES ($1, $2, 'paddle', $3, 'paddle')", [
      userId,
      creditsMc,
      `${plan.name} ${sold.interval === "year" ? "yearly" : "monthly"}: payment ${t.id}`,
    ]);
  });
}

/** A full refund or chargeback, once approved: take back that payment's credits (not below 0) and end its plan. */
export async function onAdjustment(a: AdjustmentNotification): Promise<void> {
  await takeBackCredits(a);
  await recordAdjustment(a);
}

async function takeBackCredits(a: AdjustmentNotification): Promise<void> {
  if ((a.action !== "refund" && a.action !== "chargeback") || a.status !== "approved") return;
  if (a.type !== "full") {
    console.warn(`[billing] partial ${a.action} ${a.id} on ${a.transactionId}: credits left as they are.`);
    return;
  }
  await inTx(async (c) => {
    const r = await c.query<{ user_id: string | null; credits_mc: string; plan_id: string | null }>(
      "UPDATE paddle_transactions SET refunded_at = now() WHERE transaction_id = $1 AND refunded_at IS NULL RETURNING user_id, credits_mc, plan_id",
      [a.transactionId],
    );
    const row = r.rows[0];
    if (!row?.user_id) return;
    const mc = Number(row.credits_mc);
    await c.query("UPDATE credit_accounts SET balance_mc = GREATEST(balance_mc - $2, 0), updated_at = now() WHERE user_id = $1", [row.user_id, mc]);
    await c.query("INSERT INTO credit_ledger (user_id, delta_mc, kind, note, actor) VALUES ($1, $2, 'paddle', $3, 'paddle')", [
      row.user_id,
      -mc,
      `${a.action === "refund" ? "Refund" : "Chargeback"}: payment ${a.transactionId}`,
    ]);
    if (row.plan_id) await endPlan(c, row.user_id, row.plan_id, `Plan ended: payment ${a.transactionId} ${a.action === "refund" ? "refunded" : "charged back"}`);
  });
}

/** Routes a verified event. Other event types are ignored. */
export async function handlePaddleEvent(event: EventEntity): Promise<"handled" | "ignored"> {
  switch (event.eventType) {
    case "subscription.created":
    case "subscription.updated":
    case "subscription.canceled":
      await onSubscription(event.data as SubscriptionNotification);
      return "handled";
    case "customer.created":
    case "customer.updated":
      await onCustomer(event.data as CustomerNotification);
      return "handled";
    case "transaction.completed":
      await onTransactionCompleted(event.data as TransactionNotification);
      return "handled";
    case "adjustment.created":
    case "adjustment.updated":
      await onAdjustment(event.data as AdjustmentNotification);
      return "handled";
    default:
      return "ignored";
  }
}
