// Paying from inside the app (POST /api/v1/billing/link, /pay/<token>) end to end, against a LOCAL copy of the
// website, a THROWAWAY database and a stand-in Paddle API. No real money, no Paddle account. It refuses any
// database that isn't on this machine.
//
//   1. A throwaway Postgres on this machine (see web/scripts/test-cloud.cjs for the commands).
//   2. Build with the stand-in's public settings (Next puts NEXT_PUBLIC_ values into the build):
//        cd web && NEXT_PUBLIC_PADDLE_ENV=sandbox NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_localtoken \
//          BETTER_AUTH_SECRET=local-test-secret-0123456789abcdef npm run build
//   3. TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/oovi_test node scripts/test-pay.cjs
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");

const DB = process.env.TEST_DATABASE_URL;
if (!DB) throw new Error("Set TEST_DATABASE_URL to a throwaway database on this machine.");
const host = new URL(DB).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`Refusing ${host}: only a database on this machine.`);
const WEB = path.join(__dirname, "..");
const PORT = 3592;
const BASE = `http://127.0.0.1:${PORT}`;
const HOOK_SECRET = "pdl_ntfset_localtestsecret";
const db = new Pool({ connectionString: DB });
const PRICE = { starterM: "pri_01m70s1ry8d38s7r08sep7hzj6", proY: "pri_01m70s1sr7bjdhas3erk3abqn7" };

let fails = 0;
let passes = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra && !ok ? ` — ${extra}` : ""}`);
  if (ok) passes++;
  else fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => new Date(d).toISOString();
const now = Date.now();

// ---- a stand-in Paddle API: customer portal sessions ----
const portalCalls = [];
const paddle = http.createServer((rq, rs) => {
  let body = "";
  rq.on("data", (c) => (body += c));
  rq.on("end", () => {
    const m = /^\/customers\/([^/]+)\/portal-sessions$/.exec(rq.url);
    if (rq.method === "POST" && m && /^bearer pdl_sdbx_apikey_localtest$/i.test(rq.headers.authorization ?? "")) {
      portalCalls.push({ customer: m[1], body: JSON.parse(body || "{}") });
      rs.writeHead(201, { "content-type": "application/json" });
      return rs.end(JSON.stringify({ data: { id: "cpls_test", customer_id: m[1], urls: { general: { overview: `https://customer-portal.paddle.example/${m[1]}` }, subscriptions: [] }, created_at: iso(now) }, meta: { request_id: "r" } }));
    }
    rs.writeHead(404, { "content-type": "application/json" });
    rs.end(JSON.stringify({ error: { type: "request_error", code: "not_found", detail: "not found" } }));
  });
});

// ---- signed Paddle webhooks (same shapes as scripts/test-paddle-webhook.cjs) ----
let n = 0;
async function hook(type, data) {
  const body = JSON.stringify({ event_id: `evt_pay_${++n}_${now}`, event_type: type, occurred_at: iso(Date.now()), notification_id: `ntf_pay_${n}`, data });
  const ts = Math.floor(Date.now() / 1000);
  const h1 = crypto.createHmac("sha256", HOOK_SECRET).update(`${ts}:${body}`).digest("hex");
  const r = await fetch(`${BASE}/api/paddle/webhook`, { method: "POST", headers: { "content-type": "application/json", "paddle-signature": `ts=${ts};h1=${h1}` }, body });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const money = (amt) => ({ amount: String(amt), currency_code: "USD" });
const price = (id, interval) => ({ id, product_id: "pro_sim", description: "sim", name: "sim", type: "standard", billing_cycle: { interval, frequency: 1 }, trial_period: null, tax_mode: "account_setting", unit_price: money(1000), unit_price_overrides: [], quantity: { minimum: 1, maximum: 1 }, status: "active", custom_data: null, import_meta: null, created_at: iso(now), updated_at: iso(now) });
const totals = (t) => ({ subtotal: String(t), discount: "0", tax: "0", total: String(t), credit: "0", credit_to_balance: "0", balance: "0", grand_total: String(t), fee: "50", earnings: String(t - 50), currency_code: "USD" });
const txn = (id, { priceId, interval, sub, cust, custom }) => ({
  id, status: "completed", customer_id: cust, address_id: "add_sim", business_id: null, custom_data: custom, currency_code: "USD", origin: "web",
  subscription_id: sub, invoice_id: "inv_sim", invoice_number: "1", collection_mode: "automatic", discount_id: null, billing_details: null,
  billing_period: { starts_at: iso(now), ends_at: iso(now + 30 * 864e5) },
  items: [{ price: price(priceId, interval), quantity: 1, proration: null }],
  details: { tax_rates_used: [], totals: totals(1000), adjusted_totals: null, payout_totals: { subtotal: "1000", discount: "0", tax: "0", total: "1000", credit: "0", credit_to_balance: "0", balance: "0", grand_total: "1000", fee: "100", earnings: "900", currency_code: "USD", exchange_rate: "1", fee_rate: "0.05" }, adjusted_payout_totals: null, line_items: [] },
  payments: [], checkout: { url: null }, created_at: iso(now), updated_at: iso(Date.now()), billed_at: iso(now),
});

async function addUser(id, email) {
  await db.query(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, now(), now())`, [id, `Test ${id}`, email]);
  const token = crypto.randomBytes(24).toString("hex");
  await db.query(`INSERT INTO session (id, token, "userId", "expiresAt", "createdAt", "updatedAt") VALUES ($1, $2, $3, now() + interval '1 day', now(), now())`, [`s_${id}`, token, id]);
  await db.query("INSERT INTO credit_accounts (user_id, balance_mc) VALUES ($1, 0) ON CONFLICT DO NOTHING", [id]);
  return token;
}
const link = (token, body, headers = {}) =>
  fetch(`${BASE}/api/v1/billing/link`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const page = (url, headers = {}) => fetch(url, { redirect: "manual", headers }).then(async (r) => ({ status: r.status, location: r.headers.get("location"), html: await r.text() }));
const balance = async (u) => Number((await db.query("SELECT balance_mc FROM credit_accounts WHERE user_id = $1", [u])).rows[0]?.balance_mc ?? 0);

async function main() {
  const mig = spawnSync(process.execPath, ["scripts/migrate.mjs"], { cwd: WEB, env: { ...process.env, DATABASE_URL: DB, DATABASE_URL_UNPOOLED: DB }, encoding: "utf8" });
  check("migrate.mjs creates pay_links", mig.status === 0 && /pay_links/.test(mig.stdout), mig.stderr.slice(0, 300));
  await db.query(`DELETE FROM subscriptions WHERE subscription_id LIKE 'sub_pay_%' OR customer_id LIKE 'ctm_pay_%'`);
  await db.query(`DELETE FROM customers WHERE customer_id LIKE 'ctm_pay_%'`);
  await db.query(`DELETE FROM paddle_transactions WHERE transaction_id LIKE 'txn_pay_%'`);
  await db.query(`DELETE FROM paddle_payments WHERE transaction_id LIKE 'txn_pay_%'`);
  await db.query(`DELETE FROM "user" WHERE id LIKE 'paytest_%'`);
  const A = await addUser("paytest_a", "anna@pay.test");
  const B = await addUser("paytest_b", "bilal@pay.test");

  await new Promise((r) => paddle.listen(0, "127.0.0.1", r));
  const env = {
    ...process.env,
    DATABASE_URL: DB,
    BETTER_AUTH_SECRET: "local-test-secret-0123456789abcdef",
    BETTER_AUTH_URL: BASE,
    NEXT_PUBLIC_PADDLE_ENV: "sandbox",
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "test_localtoken",
    PADDLE_API_KEY: "pdl_sdbx_apikey_localtest",
    PADDLE_WEBHOOK_SECRET: HOOK_SECRET,
    OOVI_PADDLE_API_TEST_BASE: `http://127.0.0.1:${paddle.address().port}`,
    NODE_ENV: "production",
  };
  const server = spawn(process.execPath, [require.resolve("next/dist/bin/next", { paths: [WEB] }), "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: WEB, env });
  let logs = "";
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));
  for (let i = 0; i < 60; i++) {
    if (await fetch(`${BASE}/api/v1/health`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  try {
    await run(A, B);
  } finally {
    server.kill();
    paddle.close();
    if (process.env.SHOW_LOGS) console.log(logs.slice(-3000));
  }
  check("no payment link appears in the server's logs", !/\/pay\/[A-Za-z0-9_-]{43}/.test(logs));
  await db.query(`DELETE FROM "user" WHERE id LIKE 'paytest_%'`);
  await db.end();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}

async function run(A, B) {
  // ---- asking for a link ----
  check("signed out: 401", (await link(null, { kind: "checkout" })).status === 401);
  check("unknown kind: 400", (await link(A, { kind: "refund" })).status === 400);
  check("unknown plan or price: 400", (await link(A, { kind: "checkout", plan: "gold" })).status === 400 && (await link(A, { kind: "checkout", priceId: "pri_made_up" })).status === 400);
  check("credit packs aren't sold yet: 400", (await link(A, { kind: "checkout", credits: 1000 })).status === 400);
  check("from another website (cookie session): 403", (await link(A, { kind: "checkout" }, { origin: "https://evil.example" })).status === 403);
  let r = await link(A, { kind: "checkout", plan: "pro", cycle: "year", userId: "paytest_b" });
  const m = /^http:\/\/127\.0\.0\.1:3592\/pay\/([A-Za-z0-9_-]{43})$/.exec(r.body?.url ?? "");
  check("checkout link: the site's /pay/<token>", r.status === 200 && !!m, JSON.stringify(r.body));
  const row = (await db.query("SELECT token_hash, user_id, price_id FROM pay_links WHERE user_id IN ('paytest_a','paytest_b')")).rows;
  check("only a hash of the token is stored; the account is the session's (a userId in the body is ignored)", row.length === 1 && row[0].token_hash !== m?.[1] && row[0].user_id === "paytest_a" && row[0].price_id === PRICE.proY);

  // ---- opening it ----
  let p = await page(r.body.url);
  check("the page: plans for that account, its email shown, the chosen plan opens by itself", p.status === 200 && p.html.includes("anna@pay.test") && p.html.includes("paytest_a") && p.html.includes(PRICE.proY) && p.html.includes("Choose your plan"), `status ${p.status}`);
  check("...nothing of another account", !p.html.includes("bilal@pay.test") && !p.html.includes("paytest_b"));
  check("...not indexed, no referrer", /noindex/.test(p.html) && /no-referrer/.test(p.html));
  p = await page(r.body.url);
  check("used once: the second visit gets the expired page", p.status === 200 && p.html.includes("This payment link has expired") && !p.html.includes("anna@pay.test"));
  p = await page(r.body.url, { "accept-language": "fr-FR,fr;q=0.9" });
  check("...in French for a French browser", p.html.includes("Ce lien de paiement a expiré") && p.html.includes("S&#x27;abonner"));
  p = await page(r.body.url, { "accept-language": "ar" });
  check("...in Arabic, right to left", p.html.includes("انتهت صلاحية رابط الدفع") && p.html.includes('dir="rtl"'));
  check("a made-up token: expired page", (await page(`${BASE}/pay/${"x".repeat(43)}`)).html.includes("This payment link has expired"));
  r = await link(A, { kind: "checkout" });
  await db.query("UPDATE pay_links SET created_at = now() - interval '11 minutes' WHERE user_id = 'paytest_a' AND used_at IS NULL");
  p = await page(r.body.url);
  check("after 10 minutes: expired, even unused", p.html.includes("This payment link has expired") && !p.html.includes("anna@pay.test"));
  r = await link(B, { kind: "checkout" });
  p = await page(r.body.url, { authorization: `Bearer ${A}` });
  check("another person's link opened while signed in as A still pays for its own account (B), never A", p.html.includes("bilal@pay.test") && !p.html.includes("anna@pay.test"));

  // ---- portal ----
  r = await link(A, { kind: "portal" });
  check("portal for an account without a subscription: 404 no_subscription", r.status === 404 && r.body?.code === "no_subscription");
  await db.query("INSERT INTO customers (customer_id, user_id, email) VALUES ('ctm_pay_a', 'paytest_a', 'anna@pay.test')");
  await db.query("INSERT INTO subscriptions (subscription_id, customer_id, user_id, status, price_id, product_id) VALUES ('sub_pay_a', 'ctm_pay_a', 'paytest_a', 'active', $1, 'pro_sim')", [PRICE.starterM]);
  r = await link(A, { kind: "portal" });
  p = await page(r.body.url);
  check("portal: straight to that account's Paddle customer portal", (p.status === 307 || p.status === 303 || p.status === 308) && p.location === "https://customer-portal.paddle.example/ctm_pay_a" && portalCalls.at(-1)?.customer === "ctm_pay_a", `${p.status} ${p.location} ${p.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300)} calls=${portalCalls.length}`);
  check("...with its subscriptions", JSON.stringify(portalCalls.at(-1)?.body ?? {}).includes("sub_pay_a"));
  check("...and the portal link works once", (await page(r.body.url)).html.includes("This payment link has expired"));
  check("B has no subscription: no portal link", (await link(B, { kind: "portal" })).status === 404);
  const st = await fetch(`${BASE}/api/v1/ai/status`, { headers: { authorization: `Bearer ${A}` } }).then((x) => x.json());
  check("status tells the app to pay in the app, and that A is a subscriber", st.billing?.inApp === true && st.billing?.subscriber === true);
  const stB = await fetch(`${BASE}/api/v1/ai/status`, { headers: { authorization: `Bearer ${B}` } }).then((x) => x.json());
  check("...and that B isn't", stB.billing?.inApp === true && stB.billing?.subscriber === false);

  // ---- the payment lands on the account in the link, never on the typed email ----
  // The buyer (A, via A's link: customData.userId = A) types B's email in Paddle's form.
  let h = await hook("customer.created", { id: "ctm_pay_typed", email: "bilal@pay.test", name: "x", locale: "en", status: "active", marketing_consent: false, custom_data: null, import_meta: null, created_at: iso(now), updated_at: iso(now) });
  check("customer.created accepted", h.status === 200, JSON.stringify(h.body));
  const aBefore = await balance("paytest_a");
  const bBefore = await balance("paytest_b");
  h = await hook("transaction.completed", txn("txn_pay_1", { priceId: PRICE.starterM, interval: "month", sub: "sub_pay_typed", cust: "ctm_pay_typed", custom: { userId: "paytest_a" } }));
  check("transaction.completed accepted", h.status === 200, JSON.stringify(h.body));
  check("the credits go to the account in the link (A: +4,000)", (await balance("paytest_a")) - aBefore === 4000 * 1000, `${(await balance("paytest_a")) - aBefore}`);
  check("...not to the account whose email was typed (B unchanged)", (await balance("paytest_b")) === bBefore);
  const cu = (await db.query("SELECT user_id FROM customers WHERE customer_id = 'ctm_pay_typed'")).rows[0];
  check("the Paddle customer is now linked to A (the email guess is replaced)", cu?.user_id === "paytest_a", cu?.user_id);
  check("so B's portal still doesn't open A's billing", (await link(B, { kind: "portal" })).status === 404);

  // ---- the public pricing page ----
  const pr = await page(`${BASE}/pricing`);
  check("pricing: no website sign-up, download instead", pr.status === 200 && !pr.html.includes('href="/signup"') && pr.html.includes("Download oovi"));

  // ---- too many links ----
  await db.query("DELETE FROM pay_links WHERE user_id = 'paytest_b'");
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await link(B, { kind: "checkout" })).status;
  check("at most 10 links per account in 10 minutes", last === 429);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
