// A stand-in for the website's API in front of the built website (web/, `next start`), for the phone app's
// tests and screenshots: the cloud API of docs/CLOUD-BUILD.md (/api/v1/cloud), the account's setup, credits,
// voice notes and sign-in. Everything else goes to the real website. Nothing leaves this machine; no real
// account, password or key is used (the stand-in password is "standin-pass").
const http = require("node:http");

const H = 3_600_000;

function fixtures(lang, now = Date.now()) {
  const ar = lang === "ar";
  const face = (color, shape, hair, eyes, top = 0, wear = 0, cheeks = 0, mouth = 0) => ({ color, shape, hair, eyes, nose: 0, mouth, cheeks, top, wear });
  const bots = {
    oovi: { name: "Oovi", role: ar ? "القائد" : "Chief", face: face(0, 0, 0, 1, 0, 0, 1, 0), createdAt: 1 },
    nova: { name: "Nova", role: ar ? "باحثة" : "Researcher", face: face(8, 1, 2, 0, 3, 0, 0, 1), createdAt: 2 },
    rex: { name: "Rex", role: ar ? "كاتب" : "Writer", face: face(2, 3, 4, 2, 0, 1, 0, 3), createdAt: 3 },
    lina: { name: "Lina", role: ar ? "مبيعات" : "Sales", face: face(1, 2, 7, 1, 6, 0, 2, 1), createdAt: 4 },
    sami: { name: "Sami", role: ar ? "مساعد على الحاسوب" : "Desktop helper", face: face(7, 4, 0, 4, 7, 0, 0, 2), createdAt: 5, local: true },
  };
  const items = { main: "oovi" };
  for (const [id, b] of Object.entries(bots)) items[`bot:${id}`] = { ...b, instructions: "SECRET-INSTRUCTIONS", tools: { web: true, browser: false } };
  items["group:studio"] = { name: ar ? "الاستوديو" : "Studio", memberIds: ["oovi", "nova", "rex"], leadId: "oovi", orchestrate: true, createdAt: 1 };
  items["mcp:gmail"] = { name: "Gmail", transport: "http", url: "https://mcp.example.test/gmail?token=SECRET-TOKEN", envKeys: ["GMAIL_KEY"], headerKeys: [], enabled: true, trusted: false, createdAt: 1 };
  items["mcp:notion"] = { name: "Notion", transport: "http", url: "https://mcp.example.test/notion", envKeys: [], headerKeys: ["Authorization"], enabled: true, trusted: false, createdAt: 2 };
  items["mcp:calendar"] = { name: "Google Calendar", transport: "http", url: "https://mcp.example.test/cal", envKeys: [], headerKeys: [], enabled: false, trusted: false, createdAt: 3 };
  items["mcp:files"] = { name: ar ? "ملفات الحاسوب" : "Computer files", transport: "stdio", command: "npx", args: ["-y", "files-server", "C:\\Users\\me"], envKeys: [], headerKeys: [], enabled: true, trusted: true, createdAt: 4 };
  items.settings = { approvals: "ask" };
  items["routine:r1"] = { name: ar ? "ملخص الصباح" : "Morning digest", botId: "nova", prompt: "SECRET-ROUTINE-PROMPT", schedule: { kind: "weekly", time: "08:30", days: [1, 3, 5] }, timezone: "Africa/Algiers", notifyTelegram: false, createdAt: 1 };

  const hotelsAsk = ar ? "لقى لي 3 فنادق في وهران للويكاند الجاي، أقل من 12000 دينار لليلة" : "Find me 3 hotels in Oran for next weekend, under 12,000 DA a night";
  const hotelsReply = ar
    ? "وجدت **3 فنادق** مناسبة في وهران:\n\n| الفندق | السعر لليلة | التقييم |\n|---|--:|:-:|\n| [إيبيس وهران](https://all.accor.com/) | 9 800 دج | 4.1 |\n| فندق الأندلس | 11 200 دج | 4.3 |\n| رويال وهران | 11 900 دج | 4.6 |\n\nالأرخص هو **إيبيس**، قريب من الواجهة البحرية. هل أرسل طلب الحجز بالبريد؟"
    : "I found **3 hotels** in Oran that fit:\n\n| Hotel | Per night | Rating |\n|---|--:|:-:|\n| [Ibis Oran](https://all.accor.com/) | 9,800 DA | 4.1 |\n| Hôtel Andalous | 11,200 DA | 4.3 |\n| Royal Oran | 11,900 DA | 4.6 |\n\nThe cheapest is **Ibis**, close to the seafront. Shall I email them a booking request?";
  const chats = {
    "dm-oovi": {
      id: "dm-oovi",
      kind: "direct",
      name: "Oovi",
      memberIds: ["oovi"],
      createdAt: now - 30 * H,
      updatedAt: now - 0.2 * H,
      entries: [
        { id: "u1", kind: "user", text: hotelsAsk, at: now - 0.5 * H },
        { id: "b1", kind: "bot", botId: "oovi", at: now - 0.45 * H, text: hotelsReply, status: "done", steps: [{ role: "tool", results: [{ id: "x", name: "web_search", content: "BIG TOOL RESULT ".repeat(50) }] }], credits: 1.2 },
        { id: "u2", kind: "user", text: ar ? "إيه، أرسل لهم" : "Yes, send it", at: now - 0.25 * H },
        { id: "b2", kind: "bot", botId: "oovi", at: now - 0.2 * H, text: "", status: "waiting" },
      ],
      pending: {
        approval: {
          entryId: "b2",
          botId: "oovi",
          items: [
            {
              call: { id: "call-mail", name: "mcp_gmail_send_email", input: {} },
              summary: ar ? "إرسال بريد في Gmail\nإلى: reservations@ibis-oran.example\nالموضوع: طلب حجز، 21-23 نوفمبر" : "Send an email in Gmail\nTo: reservations@ibis-oran.example\nSubject: Booking request, Nov 21–23",
              detail: ar ? "مرحبا، أود حجز غرفة لشخصين من 21 إلى 23 نوفمبر." : "Hello, I would like to book a double room from November 21 to 23.",
            },
          ],
          at: now - 0.2 * H,
        },
      },
    },
    "dm-nova": {
      id: "dm-nova",
      kind: "direct",
      name: "Nova",
      memberIds: ["nova"],
      createdAt: now - 50 * H,
      updatedAt: now - 0.05 * H,
      entries: [
        { id: "u1", kind: "user", text: ar ? "قارن لي أفضل 5 برامج CRM لفريق صغير" : "Compare the top 5 CRM tools for a team of 4", at: now - 0.06 * H },
        { id: "b1", kind: "bot", botId: "nova", at: now - 0.05 * H, text: "", status: "running", steps: [{ role: "assistant", text: "", toolCalls: [{ id: "c1", name: "web_search", input: { query: "best CRM small team 2026" } }] }] },
      ],
    },
    studio: {
      id: "studio",
      kind: "group",
      name: ar ? "الاستوديو" : "Studio",
      memberIds: ["oovi", "nova", "rex"],
      leadId: "oovi",
      createdAt: now - 80 * H,
      updatedAt: now - 1.5 * H,
      entries: [
        { id: "u1", kind: "user", text: ar ? "حضّروا لي منشور لينكدإن على إطلاق التطبيق" : "Draft a LinkedIn post for the app launch", at: now - 2 * H },
        { id: "b1", kind: "bot", botId: "nova", at: now - 1.8 * H, text: ar ? "جمعت 3 نقاط قوية من صفحة المنتج." : "I pulled 3 strong points from the product page.", status: "done" },
        { id: "b2", kind: "bot", botId: "rex", at: now - 1.5 * H, text: ar ? "ها هي المسودة:\n\n> 🚀 فريقك من البوتات صار في جيبك.\n\nهل نضيف صورة؟" : "Here is the draft:\n\n> 🚀 Your team of bots now fits in your pocket.\n\nShall we add a picture?", status: "done" },
      ],
    },
    "dm-rex": {
      id: "dm-rex",
      kind: "direct",
      name: "Rex",
      memberIds: ["rex"],
      createdAt: now - 90 * H,
      updatedAt: now - 26 * H,
      entries: [
        { id: "u1", kind: "user", text: ar ? "افتح التقرير اللي في سطح المكتب ولخصو لي" : "Open the report on my desktop and summarize it", at: now - 26.1 * H },
        { id: "b1", kind: "bot", botId: "rex", at: now - 26 * H, text: ar ? "هذا يحتاج إلى حاسوبك: افتح oovi عليه وسأقوم بذلك." : "This needs your computer: open oovi on it and I'll do it.", status: "done", errorCode: "needs_computer" },
      ],
    },
    "dm-lina": {
      id: "dm-lina",
      kind: "direct",
      name: "Lina",
      memberIds: ["lina"],
      createdAt: now - 200 * H,
      updatedAt: now - 100 * H,
      pinned: true,
      entries: [
        { id: "u1", kind: "user", text: ar ? "شكرا على قائمة العملاء! نكملو غدوة" : "Thanks for the prospect list! Let's continue tomorrow", at: now - 100 * H },
        { id: "b1", kind: "bot", botId: "lina", at: now - 99.9 * H, text: ar ? "بكل سرور. القائمة محفوظة في جدول «العملاء»." : "Anytime. The list is saved in the “Prospects” table.", status: "done" },
      ],
    },
    "routine-1": {
      id: "routine-1",
      kind: "direct",
      name: "Morning brief",
      memberIds: ["oovi"],
      routine: "r1",
      createdAt: now - 10 * H,
      updatedAt: now - 1 * H,
      entries: [{ id: "u1", kind: "user", text: "brief", at: now - 1 * H }],
    },
  };
  return { items, chats };
}

/**
 * Starts the stand-in. opts: {port, nextPort, lang, longPollMs}. Returns {server, state, close, setLang}.
 * state: {signedIn, sync, chats{id:{version, chat, deleted, updatedAt}}, jobs[], devices[], requests[]}.
 */
function startStandin({ port, nextPort, lang = "en", longPollMs = 8000, replyDelayMs = 900 }) {
  const state = { signedIn: false, sync: true, statusMissing: false, items: {}, chats: {}, jobs: [], devices: [], requests: [], waiters: new Set(), lang, transcribe: "ok", setupVersion: 7, setupConflicts: 0, setupPuts: 0, deletedChats: [], password: "standin-pass", account: { emailVerified: false, askToVerify: true, billing: { status: "active" }, news: true }, verifySent: 0, pwChanges: [], accountDeleted: false, portalOpened: 0, avatars: {}, pilot: { open: false, eligible: false, public: false, status: null, credits: 0 }, appLinks: [], feedback: [], signup: null };
  const user = { id: "u-standin", email: "phone.tester@example.test", name: "Sam Tester", image: null, emailVerified: true, createdAt: new Date(Date.now() - 400 * H).toISOString(), updatedAt: new Date().toISOString() };

  const load = (l) => {
    const f = fixtures(l);
    state.lang = l;
    state.items = f.items;
    state.chats = {};
    for (const [id, chat] of Object.entries(f.chats)) state.chats[id] = { version: 3, chat, deleted: false, updatedAt: new Date(chat.updatedAt).toISOString() };
    // The runner could not do Rex's step (a file on the computer): W keeps the job as needs_computer.
    state.vault = vaultFromItems();
    state.setupVersion = 7;
    state.setupConflicts = 0;
    state.setupPuts = 0;
    state.deletedChats = [];
    state.password = "standin-pass";
    state.account = { emailVerified: false, askToVerify: true, billing: { status: "active" }, news: true };
    state.accountDeleted = false;
    user.name = "Sam Tester";
    user.image = null;
    user.email = "phone.tester@example.test";
    state.vaultPuts = [];
    state.flows = [];
    state.oauthMode = "same";
    state.catalog = [
      { id: "github", kind: "connector", sort: 1, published: true, data: { name: "GitHub", by: "GitHub", category: "dev", transport: "http", url: "https://api.githubcopilot.com/mcp/", description: "Issues, pull requests and code.", fields: [{ key: "token", label: "GitHub token", secret: true, placeholder: "github_pat_…", to: "header", name: "Authorization", template: "Bearer {value}" }] } },
      { id: "linear", kind: "connector", sort: 2, published: true, data: { name: "Linear", by: "Linear", category: "productivity", transport: "http", url: "https://mcp.linear.app/mcp", oauth: true, description: "Issues and projects." } },
    ];
    state.jobs = [{ jobId: "job-rex", chatId: "dm-rex", kind: "message", payload: {}, status: "needs_computer", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    state.devices = [
      { deviceId: "desk-1", kind: "desktop", name: l === "ar" ? "حاسوب المنزل" : "Home PC", lastSeen: new Date(Date.now() - 2 * H).toISOString(), online: false },
      { deviceId: "runner-1", kind: "runner", lastSeen: new Date().toISOString(), online: true },
    ];
  };

  const bump = (id) => {
    const c = state.chats[id];
    c.version += 1;
    c.chat.updatedAt = Date.now();
    c.updatedAt = new Date().toISOString();
    for (const w of [...state.waiters]) if (w.chatId === id) w.wake();
  };
  /** A job's state changes (W: cloud_job.updated_at), which wakes the chat's long-polls. */
  const setJob = (job, status) => {
    job.status = status;
    job.updatedAt = new Date().toISOString();
    for (const w of [...state.waiters]) if (w.chatId === job.chatId) w.wake();
  };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      let s = "";
      req.on("data", (d) => (s += d));
      req.on("end", () => {
        try {
          resolve(s ? JSON.parse(s) : {});
        } catch {
          resolve(null);
        }
      });
    });
  const signed = (req) => state.signedIn && /(^|;\s*)standin=1/.test(req.headers.cookie || "");

  // What the computer (or the runner) does with a job from the phone, played back in a few steps.
  const run = (job) => {
    const c = state.chats[job.chatId];
    const ar = state.lang === "ar";
    if (job.kind === "message") {
      // A chat that isn't in the cloud yet: the computer makes it on the first message (a group from the setup).
      const g = state.items[`group:${job.chatId}`];
      const fresh = g
        ? { id: job.chatId, kind: "group", name: g.name, memberIds: g.memberIds, leadId: g.leadId, createdAt: Date.now(), updatedAt: Date.now(), entries: [] }
        : { id: job.chatId, kind: "direct", name: job.chatId.slice(3), memberIds: [job.chatId.slice(3)], createdAt: Date.now(), updatedAt: Date.now(), entries: [] };
      const chat = c && !c.deleted ? c.chat : (state.chats[job.chatId] = { version: c ? c.version : 0, deleted: false, updatedAt: "", chat: fresh }).chat;
      const botId = chat.leadId || chat.memberIds[0];
      setTimeout(() => {
        setJob(job, "claimed");
        chat.entries.push({ id: job.payload.entryId, kind: "user", text: job.payload.text, at: Date.now() });
        const e = { id: `r${Date.now()}`, kind: "bot", botId, at: Date.now(), text: "", status: "running", steps: [] };
        chat.entries.push(e);
        bump(job.chatId);
        setTimeout(() => {
          if (e.status !== "running") return;
          e.steps.push({ role: "assistant", text: "", toolCalls: [{ id: "s1", name: "web_search", input: { query: job.payload.text } }] });
          bump(job.chatId);
          setTimeout(() => {
            if (e.status !== "running") return;
            e.steps.push({ role: "tool", results: [{ id: "s1", name: "web_search", content: "results" }] });
            e.steps.push({ role: "assistant", text: "", toolCalls: [{ id: "s2", name: "read_url", input: { url: "https://www.booking.com/hotel/dz/ibis.html" } }] });
            bump(job.chatId);
            setTimeout(() => {
              if (e.status !== "running") return;
              e.status = "done";
              e.text = ar ? "تم! حجزت **غرفة لشخصين** وأرسلت لك التأكيد." : "Done! I asked for **a double room** and will tell you when they answer.";
              setJob(job, "done");
              bump(job.chatId);
            }, job.slow ? 60_000 : replyDelayMs);
          }, replyDelayMs);
        }, replyDelayMs);
      }, 300);
    } else if (job.kind === "decision" && c) {
      setTimeout(() => {
        const ap = c.chat.pending && c.chat.pending.approval;
        c.chat.pending = undefined;
        const e = ap && c.chat.entries.find((x) => x.id === ap.entryId);
        const allowed = job.payload.decisions && Object.values(job.payload.decisions).every(Boolean);
        if (e) {
          e.status = "done";
          e.text = allowed ? (ar ? "أرسلت البريد إلى الفندق ✅" : "Email sent to the hotel ✅") : ar ? "حسنًا، لم أرسل شيئًا." : "OK, I didn't send anything.";
        }
        setJob(job, "done");
        bump(job.chatId);
      }, 600);
    } else if (job.kind === "stop" && c) {
      setTimeout(() => {
        for (const e of c.chat.entries) if (e.kind === "bot" && e.status === "running") e.status = "stopped";
        for (const j of state.jobs) if (j.chatId === job.chatId && j.status !== "done") setJob(j, "done");
        setJob(job, "done");
        bump(job.chatId);
      }, 300);
    }
  };

  // ---- the account's vault (W: /api/v1/cloud/vault), filled from the setup's connectors with stand-in secrets ----
  const vaultFromItems = () => {
    const v = {};
    for (const [k, m] of Object.entries(state.items)) {
      if (!k.startsWith("mcp:")) continue;
      const id = k.slice(4);
      v[id] = {
        version: 2,
        data: {
          name: m.name,
          transport: m.transport,
          ...(m.url ? { url: m.url } : {}),
          ...(m.command ? { command: m.command, args: m.args } : {}),
          ...(id === "gmail" ? { auth: "oauth", oauth: { tokens: { access_token: "SECRET-OAUTH-TOKEN" }, signedInAt: Date.now() } } : {}),
          ...(id === "calendar" ? { auth: "oauth" } : {}),
          ...(id === "notion" ? { headers: { Authorization: "Bearer SECRET-HEADER-VALUE" } } : {}),
          enabled: m.enabled,
          trusted: !!m.trusted,
          bots: id === "gmail" ? ["oovi", "lina"] : ["oovi"],
        },
      };
    }
    return v;
  };
  const AI_KEY = /(sk-(ant-|proj-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,})/;
  const finishFlow = (f) => {
    const v = state.vault[f.connectorId];
    if (!v) return null;
    v.data = { ...v.data, oauth: { tokens: { access_token: "SECRET-NEW-TOKEN" }, signedInAt: Date.now() } };
    v.version += 1;
    f.done = true;
    return v;
  };

  load(lang);

  const proxy = (req, res) => {
    const p = http.request({ host: "127.0.0.1", port: nextPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    });
    p.on("error", () => send(res, 502, { error: "website not running" }));
    req.pipe(p);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const p = url.pathname;
    if (p.startsWith("/api/")) state.requests.push({ method: req.method, path: p + url.search, at: Date.now(), device: req.headers["x-oovi-device"] || null });

    // ---- sign-in (better-auth's endpoints, as the website's auth client calls them) ----
    if (p === "/api/auth/get-session") return send(res, 200, signed(req) ? { session: { id: "s1", userId: user.id, expiresAt: new Date(Date.now() + 1e9).toISOString() }, user } : null);
    if (p === "/api/auth/sign-in/email" && req.method === "POST") {
      const b = (await readBody(req)) || {};
      if (b.email === user.email && b.password === state.password && !state.accountDeleted) {
        state.signedIn = true;
        return send(res, 200, { redirect: false, token: "t", user }, { "set-cookie": "standin=1; Path=/; HttpOnly; SameSite=Lax" });
      }
      return send(res, 401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });
    }
    if (p === "/api/auth/sign-out" && req.method === "POST") {
      state.signedIn = false;
      return send(res, 200, { success: true }, { "set-cookie": "standin=; Path=/; Max-Age=0" });
    }
    // ---- creating an account in the app (the website has no sign-up page any more) ----
    if (p === "/api/auth/sign-up/email" && req.method === "POST") {
      const b = (await readBody(req)) || {};
      if (b.email === user.email && !state.accountDeleted) return send(res, 422, { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", message: "User already exists. Use another email." });
      if (typeof b.name !== "string" || !b.name || typeof b.password !== "string" || b.password.length < 8 || typeof b.termsVersion !== "string") return send(res, 400, { message: "Invalid sign-up." });
      state.signup = { name: b.name, email: b.email, termsVersion: b.termsVersion, ref: req.headers["x-oovi-ref"] || null };
      user.email = b.email;
      user.name = b.name;
      state.password = b.password;
      state.accountDeleted = false;
      state.signedIn = true;
      state.emailCodeOk = false;
      return send(res, 200, { token: "t", user }, { "set-cookie": "standin=1; Path=/; HttpOnly; SameSite=Lax" });
    }
    if (p === "/api/v1/auth/verification") return send(res, 200, { required: true });
    if (p === "/api/v1/auth/verify-email" && req.method === "POST") {
      const b = (await readBody(req)) || {};
      if (b.email !== user.email || b.code !== "123456") return send(res, 400, { error: "That code isn’t right. Check the email and try again." });
      state.emailCodeOk = true;
      return send(res, 200, { ok: true });
    }
    if (p === "/api/v1/auth/resend-code" && req.method === "POST") {
      state.codesResent = (state.codesResent || 0) + 1;
      res.writeHead(204);
      return res.end();
    }

    // ---- the account, as the website's Better Auth and account APIs answer (Settings → Account) ----
    if (p === "/api/auth/change-password" && req.method === "POST") {
      if (!signed(req)) return send(res, 401, { code: "UNAUTHORIZED", message: "Unauthorized" });
      const b = (await readBody(req)) || {};
      if (b.currentPassword !== state.password) return send(res, 400, { code: "INVALID_PASSWORD", message: "Invalid password" });
      if (typeof b.newPassword !== "string" || b.newPassword.length < 8) return send(res, 400, { code: "PASSWORD_TOO_SHORT", message: "Password too short" });
      state.password = b.newPassword;
      state.pwChanges.push({ revokeOtherSessions: b.revokeOtherSessions === true });
      return send(res, 200, { token: null, user });
    }
    if (p === "/api/auth/delete-user" && req.method === "POST") {
      if (!signed(req)) return send(res, 401, { code: "UNAUTHORIZED", message: "Unauthorized" });
      const b = (await readBody(req)) || {};
      if (b.password !== state.password) return send(res, 400, { code: "INVALID_PASSWORD", message: "Invalid password" });
      state.accountDeleted = true;
      state.signedIn = false;
      return send(res, 200, { success: true, message: "User deleted" }, { "set-cookie": "standin=; Path=/; Max-Age=0" });
    }
    if (p === "/api/v1/auth/send-verification" && req.method === "POST") {
      if (!signed(req)) return send(res, 401, { error: "Not signed in." });
      state.verifySent++;
      res.writeHead(204);
      return res.end();
    }
    // "Manage billing": the website's route answers 303 to Paddle's portal, or back to Settings with ?billing=none.
    if (p === "/api/billing/portal" && req.method === "POST") {
      const raw = await new Promise((r) => {
        let t = "";
        req.on("data", (d) => (t += d));
        req.on("end", () => r(t));
      });
      const from = new URLSearchParams(raw).get("from");
      const settings = "/m/settings";
      const to = !signed(req) ? `/login?next=${encodeURIComponent(settings)}` : state.account.billing ? "/__paddle/portal" : `${settings}?billing=none`;
      if (to === "/__paddle/portal") state.portalOpened++;
      res.writeHead(303, { location: to });
      return res.end();
    }
    if (p === "/__paddle/portal") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<!doctype html><title>Paddle billing</title><h1>Stand-in Paddle customer portal</h1>");
    }
    // A bot's own picture ("Your picture"): POST {png} → {id} (32 hex, like the website), then served back.
    if (p === "/api/v1/avatars" && req.method === "POST") {
      if (!signed(req)) return send(res, 401, { error: "Sign in first." });
      const b = await readBody(req);
      const png = Buffer.from(String((b && b.png) || "").replace(/^data:image\/png;base64,/, ""), "base64");
      if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) return send(res, 400, { error: "Use a PNG picture." });
      const id = require("node:crypto").createHash("sha256").update(png).digest("hex").slice(0, 32);
      state.avatars[id] = png;
      return send(res, 201, { id });
    }
    if (p.startsWith("/api/v1/avatars/")) {
      const png = state.avatars[p.slice("/api/v1/avatars/".length)];
      if (!png) return send(res, 404, { error: "no picture" });
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      return res.end(png);
    }
    // The public catalog (the real one needs the website's database): two published connectors, one hidden.
    if (p === "/api/v1/catalog") return send(res, 200, { items: state.catalog, hidden: ["make"] });
    // A stand-in service's sign-in page. mode "same": comes back in this browser (website callback → /m/connectors);
    // "other": comes back in another browser (iPhone home-screen app → Safari): the flow is held for the app to finish.
    if (p === "/__oauth/authorize") {
      const f = state.flows.find((x) => x.flowId === url.searchParams.get("flow"));
      if (!f) return send(res, 400, { error: "unknown flow" });
      if (state.oauthMode === "deny") {
        res.writeHead(303, { location: `/m/connectors?error=denied&id=${encodeURIComponent(f.connectorId)}` });
        return res.end();
      }
      if (state.oauthMode === "other") {
        f.held = true;
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("<!doctype html><title>Signed in elsewhere</title><p>Stand-in: this sign-in came back in another browser.</p>");
      }
      finishFlow(f);
      res.writeHead(303, { location: `/m/connectors?connected=${encodeURIComponent(f.connectorId)}` });
      return res.end();
    }

    const isApi = p.startsWith("/api/v1/");
    if (isApi && !signed(req)) return send(res, 401, { error: "Not signed in or session expired." });

    if (p === "/api/v1/me" && req.method === "PATCH") {
      const b = await readBody(req);
      if (!b) return send(res, 400, { error: "Invalid JSON body (or body too large)." });
      if ("name" in b) {
        if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 80) return send(res, 400, { error: "Name must be 1-80 characters." });
        user.name = b.name.trim();
      }
      if ("image" in b) {
        if (b.image !== null && !/^data:image\/(png|jpeg|webp);base64,/.test(String(b.image))) return send(res, 400, { error: "Invalid image." });
        user.image = b.image;
      }
      return send(res, 200, { user: { id: user.id, email: user.email, name: user.name, image: user.image, createdAt: user.createdAt } });
    }
    if (p === "/api/v1/me") return send(res, 200, { user: { id: user.id, email: user.email, name: user.name, image: user.image, createdAt: user.createdAt } });
    if (p === "/api/v1/account" && req.method === "PATCH") {
      const b = await readBody(req);
      if (!b || typeof b.news !== "boolean") return send(res, 400, { error: "Send {news: true|false}." });
      state.account.news = b.news;
      return send(res, 200, { news: b.news });
    }
    if (p === "/api/v1/account") return send(res, 200, state.account);
    // A single-use link to a website page for this account (web/app/api/v1/app-links).
    if (p === "/api/v1/app-links" && req.method === "POST") {
      const b = await readBody(req);
      if (!b || b.purpose !== "pilot") return send(res, 400, { error: "Unknown purpose." });
      const token = require("node:crypto").randomBytes(32).toString("base64url");
      state.appLinks.push({ purpose: b.purpose, token });
      return send(res, 200, { url: `http://127.0.0.1:${port}/pilot?t=${token}` });
    }
    if (p === "/api/v1/feedback" && req.method === "POST") {
      const b = await readBody(req);
      if (!b || !["problem", "improvement", "other"].includes(b.kind) || typeof b.message !== "string" || b.message.trim().length < 5) return send(res, 400, { error: "Pick a type and write a few words." });
      state.feedback.push({ kind: b.kind, message: b.message, platform: req.headers["x-oovi-platform"] || null });
      res.writeHead(204);
      return res.end();
    }
    if (p === "/api/v1/setup" && req.method === "PUT") {
      const b = await readBody(req);
      if (!b || !Number.isInteger(b.baseVersion) || !b.items || typeof b.items !== "object") return send(res, 400, { error: "Invalid request." });
      // setupConflicts: answer 409 that many times first, as when a computer saved in between.
      if (state.setupConflicts > 0) {
        state.setupConflicts--;
        state.setupVersion++;
        return send(res, 409, { error: "Your setup changed on another computer. Merging again." });
      }
      if (b.baseVersion !== state.setupVersion) return send(res, 409, { error: "Your setup changed on another computer. Merging again." });
      state.items = b.items;
      state.setupVersion++;
      state.setupPuts++;
      return send(res, 200, { version: state.setupVersion });
    }
    if (p === "/api/v1/setup") return send(res, 200, { version: state.setupVersion, items: state.items });
    if (p === "/api/v1/ai/status")
      return send(res, 200, {
        state: "ok",
        message: null,
        displayName: "theOovi",
        balance: 1840.5,
        dailyLimit: 400,
        dailyUsed: 37.2,
        resetsAt: new Date().toISOString(),
        plan: { id: "plus", name: "Plus" },
        planUntil: null,
        maxInputTokens: 100000,
        maxConcurrent: 2,
        links: { subscribe: "https://oovi.conuron.com/pricing", pricing: "https://oovi.conuron.com/pricing", pilot: "", feedback: "" },
        pilot: state.pilot,
        desktop: true,
      });
    if (p === "/api/v1/ai/transcribe" && req.method === "POST") {
      const b = await readBody(req);
      if (!b || typeof b.audio !== "string" || !/^audio\/|^video\/webm/.test(String(b.mime))) return send(res, 400, { error: "Send {audio: base64, mime: audio/…}." });
      state.lastAudio = { mime: b.mime, bytes: Buffer.from(b.audio, "base64").length };
      if (state.transcribe === "off") return send(res, 503, { error: "Voice notes aren't available yet." });
      return send(res, 200, { text: state.lang === "ar" ? "احجز الأرخص من فضلك" : "Book the cheapest one please", seconds: 3, credits: 0.1 });
    }

    // ---- the cloud API (docs/CLOUD-BUILD.md) ----
    if (p.startsWith("/api/v1/cloud/") && state.statusMissing) return send(res, 404, { error: "Not found" });
    if (p === "/api/v1/cloud/status" && req.method === "GET") {
      const list = Object.values(state.chats).filter((c) => !c.deleted);
      return send(res, 200, {
        enabled: state.sync,
        bytes: state.sync ? 3_400_000 : 0,
        limit: 100 * 1024 * 1024,
        chats: state.sync ? list.length : 0,
        lastSync: state.sync ? new Date(Date.now() - 120_000).toISOString() : null,
        devices: state.devices,
      });
    }
    if (p === "/api/v1/cloud/chats" && req.method === "GET") {
      if (!state.sync) return send(res, 403, { error: "Cloud sync is off for this account.", code: "sync_off" });
      const since = url.searchParams.get("since");
      const list = Object.entries(state.chats)
        .filter(([, c]) => !since || c.updatedAt > since)
        .map(([chatId, c]) => ({ chatId, version: c.version, updatedAt: c.updatedAt, deleted: c.deleted, bytes: 1000 }));
      return send(res, 200, { chats: list, now: new Date().toISOString() });
    }
    const one = /^\/api\/v1\/cloud\/chats\/([^/]+)$/.exec(p);
    if (one && req.method === "GET") {
      if (!state.sync) return send(res, 403, { error: "Cloud sync is off for this account.", code: "sync_off" });
      const c = state.chats[decodeURIComponent(one[1])];
      if (!c) return send(res, 404, { error: "This chat isn't in the cloud.", code: "not_found" });
      // W: a tombstone answers 200 with chat null.
      return send(res, 200, { chatId: c.chat.id, version: c.version, deleted: c.deleted, chat: c.deleted ? null : c.chat });
    }
    if (one && req.method === "DELETE") {
      if (!state.sync) return send(res, 403, { error: "Cloud sync is off for this account.", code: "sync_off" });
      const c = state.chats[decodeURIComponent(one[1])];
      if (!c || c.deleted) return send(res, 404, { error: "This chat isn't in the cloud.", code: "not_found" });
      c.deleted = true;
      c.version++;
      c.updatedAt = new Date().toISOString();
      state.deletedChats.push(decodeURIComponent(one[1]));
      return send(res, 200, { version: c.version });
    }
    if (p === "/api/v1/cloud/jobs" && req.method === "POST") {
      const b = await readBody(req);
      if (!b || typeof b.chatId !== "string" || !["message", "decision", "stop"].includes(b.kind) || typeof b.payload !== "object") return send(res, 400, { error: "Invalid job." });
      if (req.headers["content-type"] !== "application/json") return send(res, 415, { error: "JSON only." });
      if (!state.sync) return send(res, 403, { error: "Cloud sync is off for this account.", code: "sync_off" });
      if (state.busy) return send(res, 429, { error: "20 tasks are already waiting.", code: "busy" });
      const job = { jobId: `job-${state.jobs.length + 1}`, chatId: b.chatId, kind: b.kind, payload: b.payload, status: "queued", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), slow: state.slowNext === true };
      state.slowNext = false;
      state.jobs.push(job);
      setJob(job, "queued");
      if (!state.holdJobs) run(job);
      return send(res, 200, { jobId: job.jobId });
    }
    if (p === "/api/v1/cloud/events" && req.method === "GET") {
      // W's answer: {chatId, changed, version, deleted, updatedAt, jobs (last 10 minutes), now}; never the chat itself.
      if (!state.sync) return send(res, 403, { error: "Cloud sync is off for this account.", code: "sync_off" });
      const chatId = url.searchParams.get("chatId");
      const after = Number(url.searchParams.get("after") || 0);
      const jobsAfter = url.searchParams.get("jobsAfter");
      const event = () => {
        const c = state.chats[chatId];
        const jobs = state.jobs
          .filter((j) => j.chatId === chatId && Date.parse(j.updatedAt) > Date.now() - 600_000)
          .map((j) => ({ jobId: j.jobId, kind: j.kind, status: j.status, error: null, updatedAt: j.updatedAt }));
        const jobsChanged = !!jobsAfter && jobs.some((j) => j.updatedAt > jobsAfter);
        const version = c ? c.version : 0;
        return { body: { chatId, changed: version > after || jobsChanged, version, deleted: !!c?.deleted, updatedAt: c ? c.updatedAt : null, jobs, now: new Date().toISOString() } };
      };
      const first = event();
      if (first.body.changed) return send(res, 200, first.body);
      let finished = false;
      const w = { chatId, wake: () => done() };
      const done = () => {
        if (finished) return;
        const e = event();
        if (!e.body.changed && Date.now() < deadline) return;
        finished = true;
        clearTimeout(timer);
        state.waiters.delete(w);
        if (!res.writableEnded) send(res, 200, e.body);
      };
      const deadline = Date.now() + longPollMs;
      const timer = setTimeout(() => {
        finished = true;
        state.waiters.delete(w);
        if (!res.writableEnded) send(res, 200, event().body);
      }, longPollMs);
      state.waiters.add(w);
      req.on("close", () => {
        finished = true;
        clearTimeout(timer);
        state.waiters.delete(w);
      });
      return;
    }
    if (p === "/api/v1/cloud/vault" && req.method === "GET") {
      if (!state.sync) return send(res, 403, { error: "Cloud sync is off for this account.", code: "sync_off" });
      return send(res, 200, {
        items: Object.entries(state.vault).map(([connectorId, v]) => ({ connectorId, version: v.version, updatedAt: new Date().toISOString() })),
        pending: state.flows.filter((f) => !f.done && f.held).map((f) => ({ flowId: f.flowId, connectorId: f.connectorId, status: f.confirmed ? "waiting_finish" : "waiting_confirm", here: true })),
      });
    }
    const vone = /^\/api\/v1\/cloud\/vault\/([^/]+)$/.exec(p);
    if (vone) {
      if (!state.sync) return send(res, 403, { error: "Cloud sync is off for this account.", code: "sync_off" });
      const id = decodeURIComponent(vone[1]);
      const v = state.vault[id];
      if (req.method === "GET") return v ? send(res, 200, { connectorId: id, version: v.version, data: v.data }) : send(res, 404, { error: "This connector isn't in the cloud.", code: "not_found" });
      if (req.method === "DELETE") {
        if (!v) return send(res, 404, { error: "This connector isn't in the cloud.", code: "not_found" });
        delete state.vault[id];
        return send(res, 200, { ok: true });
      }
      if (req.method === "PUT") {
        const b = await readBody(req);
        if (!b || !Number.isInteger(b.baseVersion) || !b.data || typeof b.data !== "object") return send(res, 400, { error: "Invalid request.", code: "bad_request" });
        if (AI_KEY.test(JSON.stringify({ env: b.data.env, headers: b.data.headers }))) return send(res, 400, { error: "AI model keys stay on your computer.", code: "bad_request" });
        if ((v ? v.version : 0) !== b.baseVersion) return send(res, 409, { error: "Changed elsewhere.", code: "conflict", version: v ? v.version : 0, data: v ? v.data : null });
        state.vault[id] = { version: b.baseVersion + 1, data: b.data };
        state.vaultPuts.push({ id, data: b.data });
        return send(res, 200, { version: b.baseVersion + 1 });
      }
    }
    const ostart = /^\/api\/v1\/cloud\/connectors\/([^/]+)\/oauth\/start$/.exec(p);
    if (ostart && req.method === "POST") {
      if (!state.sync) return send(res, 403, { error: "Cloud sync is off for this account.", code: "sync_off" });
      const id = decodeURIComponent(ostart[1]);
      if (!state.vault[id]) return send(res, 400, { error: "Unknown connector.", code: "bad_request" });
      const flowId = `00000000-0000-4000-8000-${String(state.flows.length + 1).padStart(12, "0")}`;
      state.flows.push({ flowId, connectorId: id, held: false, confirmed: false, done: false });
      return send(res, 200, { authUrl: `http://127.0.0.1:${port}/__oauth/authorize?flow=${flowId}`, flowId });
    }
    if (p === "/api/v1/cloud/connectors/oauth/finish" && req.method === "POST") {
      const b = (await readBody(req)) || {};
      const f = state.flows.find((x) => x.flowId === b.flowId);
      if (!f || f.done) return send(res, 404, { error: "This sign-in isn't waiting here.", code: "not_found" });
      if (!f.confirmed) return send(res, 409, { error: "Confirm your account on the sign-in page first.", code: "conflict" });
      const v = finishFlow(f);
      return send(res, 200, { connectorId: f.connectorId, version: v.version, data: v.data });
    }
    if (p.startsWith("/api/v1/cloud/")) return send(res, 404, { error: "Not found" });
    return proxy(req, res);
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({
        server,
        state,
        setLang: load,
        bump,
        close: () =>
          new Promise((r) => {
            for (const w of state.waiters) w.wake();
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      }),
    );
  });
}

module.exports = { startStandin, fixtures };
