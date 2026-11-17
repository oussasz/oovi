// Routines v2: "once" and "every N minutes" schedules (lib/routines-schedule.ts) and the watched page
// and quiet runs (lib/watch-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { cronPatterns, decideTick, describeSchedule, latestDue, localDateTime, nextRun, validateSchedule } from "../../lib/routines-schedule.ts";
import { changedLines, hashText, isNoNews, pageText, significant, watchNote } from "../../lib/watch-core.ts";

test("every N minutes: only 15, 20 or 30, optionally between two times", () => {
  assert.deepEqual(validateSchedule({ kind: "minutes", every: 15 }), { kind: "minutes", every: 15 });
  assert.equal(typeof validateSchedule({ kind: "minutes", every: 5 }), "string");
  assert.equal(typeof validateSchedule({ kind: "minutes", every: 30, from: "20:00", to: "08:00" }), "string");
  assert.equal(typeof validateSchedule({ kind: "minutes", every: 30, from: "08:00" }), "string");
  assert.deepEqual(cronPatterns({ kind: "minutes", every: 20 }), ["0 */20 * * * *"]);
  assert.deepEqual(cronPatterns({ kind: "minutes", every: 30, from: "08:00", to: "20:00" }), ["0 */30 8-19 * * *"]);
  assert.deepEqual(cronPatterns({ kind: "minutes", every: 30, from: "08:00", to: "20:30" }), ["0 */30 8-20 * * *"]);
  const at = Date.UTC(2026, 10, 18, 9, 7);
  assert.equal(nextRun({ kind: "minutes", every: 15 }, "UTC", at), Date.UTC(2026, 10, 18, 9, 15));
  // Outside the window: the next run is the window's start.
  assert.equal(nextRun({ kind: "minutes", every: 30, from: "08:00", to: "20:00" }, "UTC", Date.UTC(2026, 10, 18, 21, 0)), Date.UTC(2026, 10, 19, 8, 0));
  assert.match(describeSchedule({ kind: "minutes", every: 30, from: "08:00", to: "20:00" }), /every 30 minutes between 08:00 and 20:00/);
});

test("once: runs one time at its moment; a saved one stays valid after it ran", () => {
  const future = Date.now() + 3600_000;
  const s = validateSchedule({ kind: "once", at: future });
  assert.ok(typeof s !== "string" && s.kind === "once");
  assert.equal(typeof validateSchedule({ kind: "once", at: Date.now() - 3600_000 }), "string");
  assert.equal(typeof validateSchedule({ kind: "once", at: Date.now() - 3600_000 }, true), "object");
  const once = { kind: "once" as const, at: Date.UTC(2026, 10, 18, 17, 0) };
  assert.equal(nextRun(once, "UTC", Date.UTC(2026, 10, 18, 16, 0)), once.at);
  assert.equal(nextRun(once, "UTC", once.at), null);
  assert.equal(latestDue(once, "UTC", once.at - 1, once.at + 1000), once.at);
  const d = decideTick(once, "UTC", { nextRunAt: once.at }, once.at + 5000, "free");
  assert.equal(d.kind, "run");
  assert.equal(d.kind === "run" ? d.next : "x", null);
  assert.deepEqual(cronPatterns(once), []);
});

test("a local date and time in a time zone", () => {
  assert.equal(localDateTime("2026-11-20", "17:00", "UTC"), Date.UTC(2026, 10, 20, 17, 0));
  assert.equal(localDateTime("2026-11-20", "17:00", "Africa/Algiers"), Date.UTC(2026, 10, 20, 16, 0));
  assert.equal(localDateTime("2026-13-40", "17:00", "UTC"), null);
  assert.equal(localDateTime("2026-11-20", "25:00", "UTC"), null);
});

test("a watched page: text, noise, changes", () => {
  const html = `<html><head><title>x</title><script>var a=1</script></head><body><h1>Laptop X</h1><p>Price: 120 000 DA</p><p>12:31</p><style>.a{}</style></body></html>`;
  const t = significant(pageText(html, "text/html"));
  assert.equal(t, "Laptop X\nPrice: 120 000 DA");
  const t2 = significant(pageText(html.replace("120 000", "110 000").replace("12:31", "12:45"), "text/html"));
  assert.notEqual(hashText(t), hashText(t2));
  assert.equal(hashText(t), hashText(significant(pageText(html.replace("12:31", "18:02"), "text/html"))), "a clock on the page is not a change");
  assert.equal(changedLines(t, t2), "- Price: 120 000 DA\n+ Price: 110 000 DA");
  assert.match(watchNote("https://shop.test/x", t, t2), /changed since the last check[\s\S]*\+ Price: 110 000 DA/);
  assert.match(watchNote("https://shop.test/x", undefined, t2), /first check/);
  assert.equal(pageText("<rss><item><title>A &amp; B</title></item><item><title>Story C</title></item></rss>"), "A & B\nStory C");
});

test("a quiet run's 'nothing new' answer", () => {
  for (const x of ["NO_NEWS", " no_news ", "**NO_NEWS**", "NO_NEWS."]) assert.ok(isNoNews(x), x);
  for (const x of ["NO_NEWS but the price went down", "Nothing new today", ""]) assert.equal(isNoNews(x), false, x);
});

test("a 'once' time set right after a run still runs (no 15-minute floor for it)", () => {
  const at = Date.UTC(2026, 10, 18, 17, 0);
  assert.equal(decideTick({ kind: "once", at }, "UTC", { nextRunAt: at, lastStartedAt: at - 60_000 }, at + 1000, "free").kind, "run");
  assert.equal(decideTick({ kind: "daily", time: "17:00" }, "UTC", { nextRunAt: at, lastStartedAt: at - 60_000 }, at + 1000, "free").kind, "skip");
});
