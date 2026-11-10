// Simulated Paddle payments against a LOCAL copy of the website: no real money, no Paddle account.
// Signed webhook events go through the real route (signature check, duplicates, credits, refunds).
//
//   1. A throwaway Postgres; run `node scripts/migrate.mjs` with DATABASE_URL pointing at it, and add one user:
//      insert into "user" (id,name,email,"emailVerified","createdAt","updatedAt")
//        values ('u_test','Test Buyer','buyer@example.test',true,now(),now());
//   2. Start the site: DATABASE_URL=... PADDLE_WEBHOOK_SECRET=pdl_ntfset_localtestsecret NEXT_PUBLIC_PADDLE_ENV=production
//      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=live_localtest BETTER_AUTH_SECRET=local-test-secret-0123456789abcdef npx next dev -p 3500
//   3. TEST_DATABASE_URL=... node scripts/test-paddle-webhook.cjs   (never against the real database)
const crypto = require("node:crypto");
const { Pool } = require("pg");
const URL_ = "http://localhost:3500/api/paddle/webhook";
const SECRET = "pdl_ntfset_localtestsecret";
const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const PRICE = { starterM: "pri_01m70s1ry8d38s7r08sep7hzj6", proY: "pri_01m70s1sr7bjdhas3erk3abqn7" };
let n = 0, fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails++; };
const iso = (d) => new Date(d).toISOString();
const now = Date.now();

async function send(type, data, { eventId, secret = SECRET } = {}) {
  const body = JSON.stringify({ event_id: eventId ?? `evt_sim_${++n}_${now}`, event_type: type, occurred_at: iso(Date.now()), notification_id: `ntf_sim_${n}`, data });
  const ts = Math.floor(Date.now() / 1000);
  const h1 = crypto.createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
  const r = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", "paddle-signature": `ts=${ts};h1=${h1}` }, body });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const money = (amt, cur = "USD") => ({ amount: String(amt), currency_code: cur });
const price = (id, interval) => ({ id, product_id: "pro_sim", description: "sim", name: "sim", type: "standard", billing_cycle: { interval, frequency: 1 }, trial_period: null, tax_mode: "account_setting", unit_price: money(1000), unit_price_overrides: [], quantity: { minimum: 1, maximum: 1 }, status: "active", custom_data: null, import_meta: null, created_at: iso(now), updated_at: iso(now) });
const totals = (t) => ({ subtotal: String(t), discount: "0", tax: "0", total: String(t), credit: "0", credit_to_balance: "0", balance: "0", grand_total: String(t), fee: "50", earnings: String(t - 50), currency_code: "USD" });
const txn = (id, { priceId, interval, sub = "sub_sim_1", cust = "ctm_sim_1", custom = { userId: "u_test" }, ends }) => ({
  id, status: "completed", customer_id: cust, address_id: "add_sim", business_id: null, custom_data: custom, currency_code: "USD", origin: "web",
  subscription_id: sub, invoice_id: "inv_sim", invoice_number: "1", collection_mode: "automatic", discount_id: null, billing_details: null,
  billing_period: { starts_at: iso(now), ends_at: iso(ends ?? now + 30 * 864e5) },
  items: [{ price: price(priceId, interval), quantity: 1, proration: null }],
  details: { tax_rates_used: [], totals: totals(1000), adjusted_totals: null, payout_totals: { subtotal: "1000", discount: "0", tax: "0", total: "1000", credit: "0", credit_to_balance: "0", balance: "0", grand_total: "1000", fee: "100", earnings: "900", currency_code: "USD", exchange_rate: "1", fee_rate: "0.05" }, adjusted_payout_totals: null, line_items: [] },
  payments: [], checkout: { url: null }, created_at: iso(now), updated_at: iso(Date.now()), billed_at: iso(now),
});
const sub = (status, { priceId = PRICE.starterM, interval = "month", updated = Date.now() } = {}) => ({
  id: "sub_sim_1", status, customer_id: "ctm_sim_1", address_id: "add_sim", business_id: null, currency_code: "USD", created_at: iso(now), updated_at: iso(updated),
  started_at: iso(now), first_billed_at: iso(now), next_billed_at: iso(now + 30 * 864e5), paused_at: null, canceled_at: status === "canceled" ? iso(updated) : null,
  discount: null, collection_mode: "automatic", billing_details: null, current_billing_period: { starts_at: iso(now), ends_at: iso(now + 30 * 864e5) },
  billing_cycle: { interval, frequency: 1 }, scheduled_change: null, items: [{ status: "active", quantity: 1, recurring: true, created_at: iso(now), updated_at: iso(now), previously_billed_at: null, next_billed_at: null, trial_dates: null, price: price(priceId, interval) }],
  custom_data: { userId: "u_test" }, import_meta: null,
});
const acct = async (u = "u_test") => (await db.query("select plan, balance_mc from credit_accounts where user_id=$1", [u])).rows[0];
const MC = 1000;

(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL to a throwaway test database.");
  // Start clean: remove what an earlier run of this script left (test IDs only).
  await db.query("DELETE FROM paddle_events WHERE event_id LIKE 'evt_sim_%' OR event_id LIKE 'evt_first_payment_%'");
  for (const t of ["paddle_transactions", "paddle_payments"]) await db.query(`DELETE FROM ${t} WHERE transaction_id LIKE 'txn_sim_%' OR transaction_id = 'txn_forged'`);
  await db.query("DELETE FROM paddle_adjustments WHERE adjustment_id LIKE 'adj_sim_%'");
  await db.query("DELETE FROM subscriptions WHERE subscription_id LIKE 'sub_sim_%'");
  await db.query("DELETE FROM customers WHERE customer_id IN ('ctm_sim_1', 'ctm_stranger')");
  await db.query("DELETE FROM credit_ledger WHERE user_id = 'u_test'");
  await db.query("DELETE FROM credit_accounts WHERE user_id = 'u_test'");
  // Forged / tampered requests are refused and change nothing.
  check("a request signed with the wrong secret is refused", (await send("transaction.completed", txn("txn_forged", { priceId: PRICE.starterM, interval: "month" }), { secret: "wrong" })).status === 401);

  let r = await send("customer.created", { id: "ctm_sim_1", email: "buyer@example.test", name: "Test Buyer", locale: "en", status: "active", marketing_consent: false, custom_data: null, import_meta: null, created_at: iso(now), updated_at: iso(now) });
  check("customer.created accepted", r.status === 200, JSON.stringify(r.body));
  const c = (await db.query("select user_id from customers where customer_id='ctm_sim_1'")).rows[0];
  check("the Paddle customer is linked to the oovi account by email", c?.user_id === "u_test");

  r = await send("subscription.created", sub("active"));
  check("subscription.created accepted", r.status === 200, JSON.stringify(r.body));

  // First payment: Starter monthly.
  const before = (await acct())?.balance_mc ?? null;
  const ev1 = `evt_first_payment_${now}`;
  r = await send("transaction.completed", txn("txn_sim_1", { priceId: PRICE.starterM, interval: "month" }), { eventId: ev1 });
  check("first payment accepted", r.status === 200, JSON.stringify(r.body));
  let a = await acct();
  const welcome = before === null ? Number(a.balance_mc) - 4000 * MC : Number(before);
  check("the account is on Starter", a?.plan === "starter", `plan=${a?.plan}`);
  check("4,000 credits were added", Number(a.balance_mc) - welcome === 4000 * MC, `balance=${Number(a.balance_mc) / MC} credits (welcome credits ${welcome / MC})`);

  // Paddle delivers at least once: the same event again, and the same payment under a new event id.
  r = await send("transaction.completed", txn("txn_sim_1", { priceId: PRICE.starterM, interval: "month" }), { eventId: ev1 });
  check("the same event delivered twice is recognised", r.body?.duplicate === true);
  await send("transaction.completed", txn("txn_sim_1", { priceId: PRICE.starterM, interval: "month" }));
  a = await acct();
  check("no double credits for the same payment", Number(a.balance_mc) - welcome === 4000 * MC, `balance=${Number(a.balance_mc) / MC}`);

  // Next month's renewal.
  await send("transaction.completed", txn("txn_sim_2", { priceId: PRICE.starterM, interval: "month", ends: now + 60 * 864e5 }));
  a = await acct();
  check("renewal adds another 4,000", Number(a.balance_mc) - welcome === 8000 * MC, `balance=${Number(a.balance_mc) / MC}`);

  // A full refund of the renewal: its credits come back off and the plan ends.
  r = await send("adjustment.created", { id: "adj_sim_1", action: "refund", type: "full", transaction_id: "txn_sim_2", subscription_id: "sub_sim_1", customer_id: "ctm_sim_1", reason: "sim", credit_applied_to_balance: null, currency_code: "USD", status: "approved", items: [], totals: { subtotal: "1000", tax: "0", total: "1000", fee: "50", earnings: "950", currency_code: "USD" }, payout_totals: { subtotal: "1000", tax: "0", total: "1000", fee: "100", earnings: "900", chargeback_fee: null, currency_code: "USD" }, tax_rates_used: [], created_at: iso(now), updated_at: iso(Date.now()) });
  check("refund accepted", r.status === 200, JSON.stringify(r.body));
  a = await acct();
  check("the refunded payment's credits are taken back", Number(a.balance_mc) - welcome === 4000 * MC, `balance=${Number(a.balance_mc) / MC}`);
  check("the plan ends after a full refund", a.plan === "free", `plan=${a.plan}`);

  // Buys again (Pro yearly), then cancels.
  await send("transaction.completed", txn("txn_sim_3", { priceId: PRICE.proY, interval: "year", ends: now + 365 * 864e5 }));
  a = await acct();
  check("Pro yearly: plan is Pro and 16,000 credits added", a.plan === "pro" && Number(a.balance_mc) - welcome === 20000 * MC, `plan=${a.plan} balance=${Number(a.balance_mc) / MC}`);
  await send("subscription.updated", sub("active", { priceId: PRICE.proY, interval: "year", updated: Date.now() }));
  await send("subscription.canceled", sub("canceled", { priceId: PRICE.proY, interval: "year", updated: Date.now() + 1000 }));
  a = await acct();
  check("cancelling moves the account back to Free, credits stay", a.plan === "free" && Number(a.balance_mc) - welcome === 20000 * MC, `plan=${a.plan} balance=${Number(a.balance_mc) / MC}`);

  // A payment from someone with no oovi account: accepted (so Paddle doesn't retry forever), no credits, recorded.
  r = await send("transaction.completed", txn("txn_sim_4", { priceId: PRICE.starterM, interval: "month", cust: "ctm_stranger", sub: "sub_sim_9", custom: null }));
  const t4 = (await db.query("select user_id, credits_mc from paddle_transactions where transaction_id='txn_sim_4'")).rows[0];
  check("a payment with no matching account is kept for you to sort out, no credits given", r.status === 200 && t4 && t4.user_id === null && Number(t4.credits_mc) === 0);

  const pay = (await db.query("select count(*)::int n from paddle_payments")).rows[0].n;
  check("payments show up for Admin > Finance", pay >= 4, `${pay} payments recorded`);
  console.log(`\n${fails ? fails + " FAILED" : "all checks passed"}`);
  await db.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
