// Turns a verified Paddle event into a notification for the owner (called by app/api/paddle/webhook after the
// event was handled and recorded, so billing never waits for it and a retry can't notify twice).
import type { AdjustmentNotification, EventEntity, SubscriptionNotification, TransactionNotification } from "@paddle/paddle-node-sdk";
import { planById } from "./ai-config";
import { planForPrice } from "./billing";
import { pool } from "./db";
import { notify } from "./notify";

/** "10.00 USD": Paddle sends amounts in the currency's smallest unit as a string. */
function money(total: string | undefined, currency: string | undefined): string {
  const cur = currency ?? "USD";
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // unknown currency code: keep 2 decimals
  }
  const v = Number(total ?? 0) / 10 ** digits;
  return `${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${cur}`;
}

async function customerEmail(customerId: string | null | undefined): Promise<string> {
  if (!customerId) return "unknown";
  try {
    const { rows } = await pool.query<{ email: string | null }>("SELECT email FROM customers WHERE customer_id = $1", [customerId]);
    return rows[0]?.email || `customer ${customerId}`;
  } catch {
    return `customer ${customerId}`;
  }
}

async function planLabel(items: { price?: { id: string } | null }[]): Promise<string> {
  const hit = items.find((i) => i.price && planForPrice(i.price.id));
  if (!hit?.price) return "Not a plan";
  const sold = planForPrice(hit.price.id)!;
  const plan = await planById(sold.planId);
  return `${plan.name} ${sold.interval === "year" ? "yearly" : "monthly"}`;
}

const seen = new Set<string>();
/** A refund can arrive as created and updated: tell the owner once per adjustment and state. */
function firstTime(key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  if (seen.size > 500) seen.clear();
  return true;
}

export async function notifyPaddleEvent(event: EventEntity): Promise<void> {
  try {
    switch (event.eventType) {
      case "transaction.completed": {
        const t = event.data as TransactionNotification;
        const plan = await planLabel(t.items);
        const amount = money(t.details?.totals?.total, t.details?.totals?.currencyCode);
        const renewal = t.origin === "subscription_recurring";
        await notify({
          event: "order",
          title: `${renewal ? "Renewal" : "New order"}: ${plan}, ${amount}`,
          lead: renewal ? "A subscription renewed and was paid." : "Someone paid for a plan.",
          rows: [
            ["Plan", plan],
            ["Paid", amount],
            ["Customer", await customerEmail(t.customerId)],
            ["Type", renewal ? "Renewal" : "New payment"],
          ],
          button: { label: "Open Finance", path: "/admin/finance" },
        });
        return;
      }
      case "subscription.canceled": {
        const s = event.data as SubscriptionNotification;
        await notify({
          event: "cancel",
          title: `Subscription canceled: ${await planLabel(s.items)}`,
          lead: "A customer's plan was canceled.",
          rows: [
            ["Plan", await planLabel(s.items)],
            ["Customer", await customerEmail(s.customerId)],
          ],
          button: { label: "Open Finance", path: "/admin/finance" },
        });
        return;
      }
      case "adjustment.created":
      case "adjustment.updated": {
        const a = event.data as AdjustmentNotification;
        if ((a.action !== "refund" && a.action !== "chargeback") || a.status !== "approved") return;
        if (!firstTime(`${a.id}:${a.status}`)) return;
        const what = a.action === "refund" ? "Refund" : "Chargeback";
        await notify({
          event: "refund",
          title: `${what}: ${money(a.totals?.total, a.totals?.currencyCode)}`,
          lead: `${what}${a.type === "partial" ? " (partial)" : ""} approved. ${a.action === "refund" && a.type === "full" ? "The credits of that payment were taken back." : ""}`.trim(),
          rows: [
            ["Amount", money(a.totals?.total, a.totals?.currencyCode)],
            ["Customer", await customerEmail(a.customerId)],
            ["Reason", a.reason?.slice(0, 160) || "–"],
          ],
          button: { label: "Open Finance", path: "/admin/finance" },
        });
        return;
      }
      default:
        return;
    }
  } catch (err) {
    console.error("paddle notification failed:", err instanceof Error ? err.message : err);
  }
}
