// First run, made personal, against the built oovi server (no account, no model: nothing leaves this machine).
// A new account: the Chief gets the character and name the user chose and keeps the user's goals in mind; the
// team suggested for those goals is created; the starter bots everyone used to get are gone (nobody used them);
// doing it twice changes nothing; the home screen's examples follow the goals.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("./server-guard.cjs"); // fail fast if the test server exits on its own (port taken, crash)
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-onboarding-test");
const PORT = 3319;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const api = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  return { status: r.status, body: j };
};

let server;
(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  server = spawn(process.execPath, [path.join(__dirname, "server.cjs")], {
    env: { ...process.env, OOVI_TEST_DATA: DATA, OOVI_TEST_ONBOARDED: "0", OOVI_CLOUD_URL: "http://127.0.0.1:1", OOVI_TELEGRAM_API: "http://127.0.0.1:1", PORT: String(PORT) },
    stdio: "ignore",
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/bots`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const before = (await api("GET", "/api/bots")).body.map((b) => b.name);
  check("a brand-new account starts with the default Chief (and the old starter bots, until the user chooses)", before.includes("Oovi"), before.join(","));

  const sug = (await api("GET", "/api/onboarding?goals=clients,shop&other=")).body;
  const ids = sug.setups.map((s) => s.id);
  check("the team suggested fits the goals (research desk, shop team), only the best fit ticked (a calm first day), with faces to show", ids.includes("shop-team") && ids.includes("research-desk") && sug.picked.length === 1 && sug.picked[0] === "research-desk" && sug.setups.every((s) => s.bots.length && s.bots[0].face), ids.join(","));

  const face = { color: 1, shape: 1, hair: 5, eyes: 2, nose: 0, mouth: 1, cheeks: 1, top: 8, wear: 0 };
  const done = await api("POST", "/api/onboarding", { style: "funny", name: "Momo", face, goals: ["clients", "shop"], other: "a café in Oran", setups: ["research-desk", "shop-team"] });
  check("applying the choices works (the user ticked a second team)", done.status === 200 && done.body.created.length === 2 && done.body.leader.name === "Momo", JSON.stringify(done.body).slice(0, 200));

  const bots = (await api("GET", "/api/bots")).body;
  const chats = (await api("GET", "/api/chats")).body;
  const chief = bots.find((b) => b.name === "Momo");
  const main = (await api("GET", "/api/main")).body;
  check("the Chief has the chosen name, face and character, and knows the user's goals", !!chief && main.botId === chief.id && chief.face.top === 8 && /Your personality: funny and playful/.test(chief.instructions) && /finding clients and sales, an online shop, "a café in Oran"/.test(chief.instructions), chief?.instructions.slice(-260));
  check("the old starter bots and the Studio group are gone (nobody had used them)", !bots.some((b) => ["Scout", "Quill", "Nova"].includes(b.name)) && !chats.some((c) => c.name === "Studio"), bots.map((b) => b.name).join(","));
  check("the chosen teams are there", done.body.created.every((c) => chats.some((x) => x.id === c.groupId) || bots.some((b) => c.bots.includes(b.name))), done.body.created.map((c) => c.name).join(","));

  const again = await api("POST", "/api/onboarding", { style: "calm", name: "Oovi", goals: [], setups: ["starter"] });
  const bots2 = (await api("GET", "/api/bots")).body;
  check("doing it twice changes nothing (no second team)", again.status === 409 && bots2.length === bots.length && bots2.some((b) => b.name === "Momo"), `${again.status} ${bots2.length}/${bots.length}`);

  const mine = (await api("GET", "/api/onboarding?mine=1")).body;
  check("the home screen gets the goals for its examples", JSON.stringify(mine.goals) === JSON.stringify(["clients", "shop"]), JSON.stringify(mine.goals));
  check("reopened before the last screen, the first run goes on with the Chief chosen (name and face)", mine.done?.leader?.name === "Momo" && mine.face?.top === 8, JSON.stringify(mine.done?.leader));

  const step = await api("PUT", "/api/onboarding", { step: "tried", goals: ["clients"] });
  const badStep = await api("PUT", "/api/onboarding", { step: "anything" });
  check("first-run steps are accepted for the funnel; unknown ones are refused", step.status === 204 && badStep.status === 400, `${step.status} ${badStep.status}`);

  // The first task goes to the Chief's chat (the model here is a stand-in that can't answer: only the message counts).
  await fetch(`${BASE}/api/chats/dm-${chief.id}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Find 30 cafés in Algiers with their phone numbers, in a table" }) }).then((r) => r.body?.cancel()).catch(() => {});
  await sleep(800);
  const dm = (await api("GET", `/api/chats/dm-${chief.id}`)).body;
  check("the first task reaches the Chief", dm.entries?.some((e) => e.kind === "user" && /30 cafés/.test(e.text)), String(dm.entries?.length));

  const bad = await api("POST", "/api/onboarding", { name: "two words" });
  check("a second request can't sneak through with bad input either", bad.status === 409);

  console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => {
  console.log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
