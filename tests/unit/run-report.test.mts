import { test } from "node:test";
import assert from "node:assert/strict";
import { COULD_NOT, cleanProblemNote, parseProblemReview, runProblems, wentWrong } from "../../lib/run-report.ts";
import { cameBack, problemKey, VERSION_RE } from "../../web/lib/problem-key.ts";

const entry = (o: Record<string, unknown>) => ({ id: "e", kind: "bot", botId: "b", steps: [], text: "", status: "done", usage: {}, ...o }) as never;

test("tool errors are reported with the tool and the site, never the page address", () => {
  const e = entry({
    steps: [
      { role: "assistant", text: "", toolCalls: [{ id: "1", name: "read_url", input: { url: "https://www.tripadvisor.com/Hotel_Review-g1-d2-Reviews-Ahmed.html" } }] },
      { role: "tool", results: [{ id: "1", name: "read_url", content: "HTTP 403 Forbidden\nTry the user's browser.", isError: true }] },
    ],
  });
  const n = runProblems([{ entry: e }]);
  assert.equal(n.length, 1);
  assert.equal(n[0].tag, "tool");
  assert.equal(n[0].tool, "read_url");
  assert.equal(n[0].site, "tripadvisor.com");
  assert.match(n[0].message, /^read_url failed on tripadvisor\.com: HTTP 403 Forbidden$/);
  assert.doesNotMatch(n[0].message, /Ahmed|Try the user/);
});

test("the user's no, a stop or a new message is not a problem", () => {
  const e = entry({
    steps: [
      { role: "assistant", text: "", toolCalls: [{ id: "1", name: "desktop_click", input: {} }, { id: "2", name: "open_url", input: {} }] },
      {
        role: "tool",
        results: [
          { id: "1", name: "desktop_click", content: "The user declined this action. Don't retry it; ask the user.", isError: true },
          { id: "2", name: "open_url", content: "Cancelled: the user sent a new message instead.", isError: true },
        ],
      },
    ],
  });
  assert.deepEqual(runProblems([{ entry: e }]), []);
});

test("a turn that stopped with an error is reported; account states (no credits) are not", () => {
  assert.equal(runProblems([{ entry: entry({ status: "error", error: "The screen can't be captured right now (locked)." }) }])[0]?.tag, "failed");
  assert.deepEqual(runProblems([{ entry: entry({ status: "error", error: "You have no credits left.", errorCode: "no_credits" }) }]), []);
});

test("the same error twice in a run is one report", () => {
  const call = (id: string) => ({ id, name: "desktop_screenshot", input: {} });
  const res = (id: string, n: number) => ({ id, name: "desktop_screenshot", content: `That action failed: timeout after ${n} ms`, isError: true });
  const e = entry({ steps: [{ role: "assistant", text: "", toolCalls: [call("1"), call("2")] }, { role: "tool", results: [res("1", 500), res("2", 800)] }] });
  assert.equal(runProblems([{ entry: e }]).length, 1);
});

test("cleaning: emails, phones, paths, quotes and the user's name never leave", () => {
  const t = cleanProblemNote('work_notes failed for Oussama: "a very long quoted sentence" at C:\\Users\\o\\Desktop\\plan.docx, call +213 555 12 34 56, mail o@x.dz', ["Oussama"]);
  assert.doesNotMatch(t, /Oussama|quoted sentence|plan\.docx|555|o@x\.dz/);
  assert.match(t, /\[user\].*\[text\].*\[path\].*\[number\].*\[email\]/);
});

test("'I couldn't' in English, French, Arabic and Darija is noticed", () => {
  for (const t of ["I couldn't open the page.", "I was not able to log in", "Je n'ai pas pu ouvrir le site", "Je ne peux pas cliquer", "لم أتمكن من فتح الصفحة", "ما قدرتش نحل الموقع", "تعذر الوصول"]) assert.ok(COULD_NOT.test(t), t);
  for (const t of ["Here is your list of 40 hotels.", "Voici le fichier.", "هذا هو الملف"]) assert.ok(!COULD_NOT.test(t), t);
});

test("a short review runs only when the run went wrong", () => {
  assert.equal(wentWrong([{ entry: entry({ text: "Done: the file is in Downloads." }) }], false), false);
  assert.equal(wentWrong([{ entry: entry({ text: "I couldn't capture the screen." }) }], false), true);
  assert.equal(wentWrong([{ entry: entry({ text: "Done." }) }], true), true);
  assert.equal(wentWrong([{ entry: entry({ status: "error", error: "x" }) }], false), true);
  assert.equal(wentWrong([{ entry: entry({ status: "error", error: "x", errorCode: "offline" }) }], false), false);
});

test("the review's answer is read safely", () => {
  assert.deepEqual(parseProblemReview('{"unmet": "User asked to change the wallpaper; screenshots failed.", "tools": []}'), { unmet: "User asked to change the wallpaper; screenshots failed.", tools: [] });
  assert.deepEqual(parseProblemReview('{"unmet": null, "tools": ["short", 5]}'), { unmet: null, tools: [] });
  assert.deepEqual(parseProblemReview("not json"), { unmet: null, tools: [] });
});

test("console: the same problem with other numbers is one line; fixed and came back", () => {
  assert.equal(problemKey("read_url failed on x.com: HTTP 403"), problemKey("Read_url failed on x.com: http 404!"));
  assert.notEqual(problemKey("read_url failed on x.com"), problemKey("open_url failed on x.com"));
  assert.ok(VERSION_RE.test("0.10.14") && !VERSION_RE.test("v0.10") && !VERSION_RE.test("0.10.14; drop"));
  assert.equal(cameBack({ fixedIn: "0.10.14" }, "0.10.13"), false);
  assert.equal(cameBack({ fixedIn: "0.10.14" }, "0.10.14"), true);
  assert.equal(cameBack({ fixedIn: "0.10.14" }, "0.11.0"), true);
  assert.equal(cameBack({ fixedIn: "0.10.14" }, "dev"), false);
  assert.equal(cameBack(null, "0.11.0"), false);
});
