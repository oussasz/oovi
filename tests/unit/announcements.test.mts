import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FRAME_CSP, FRAME_SANDBOX, framedHtml } from "../../lib/announcement-frame.ts";
import { audienceLabel, mailKindOf, paragraphs, parsePeople, peopleOf } from "../../web/lib/announcement-audience.ts";

const root = new URL("../../", import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");

test("the frame never runs scripts: sandbox without allow-scripts or same-origin", () => {
  assert.doesNotMatch(FRAME_SANDBOX, /allow-scripts|allow-same-origin|allow-top-navigation|allow-forms/);
  assert.match(FRAME_CSP, /default-src 'none'/);
  assert.doesNotMatch(FRAME_CSP, /script-src/);
});

test("scripts, event handlers, refresh and base tags are taken out; the policy comes first", () => {
  const out = framedHtml(`<html><head><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"><script>alert(1)</script></head><body><img src="x" onerror="alert(2)"><a href="https://oovi.conuron.com" onclick='steal()'>Open</a><SCRIPT src="https://evil.example/x.js"></SCRIPT></body></html>`);
  assert.doesNotMatch(out, /<script|onerror|onclick|refresh|evil\.example\/"/i);
  assert.ok(out.indexOf("Content-Security-Policy") < out.indexOf("<body"), "policy in the head, before the content");
  assert.match(out, /<base target="_blank">/);
  assert.match(out, /href="https:\/\/oovi\.conuron\.com"/, "links kept");
});

test("a body-only snippet gets a full page", () => {
  const out = framedHtml("<h1>Hello</h1>");
  assert.match(out, /^<!doctype html><html><head>.*Content-Security-Policy.*<\/head><body><h1>Hello<\/h1><\/body><\/html>$/s);
});

test("the website shows announcements in exactly the same frame as the app", () => {
  assert.equal(read("web/lib/announcement-frame.ts"), read("lib/announcement-frame.ts"));
});

test("chosen people: one address or several, typed any way; duplicates and bad ones are caught", () => {
  const p = parsePeople(" Sara@Example.com,\nkarim@example.com ; sara@example.com <omar@example.com>\n not-an-address ");
  assert.deepEqual(p.emails, ["sara@example.com", "karim@example.com", "omar@example.com"]);
  assert.deepEqual(p.bad, ["not-an-address"]);
  assert.deepEqual(parsePeople("").emails, []);
  assert.deepEqual(peopleOf(""), []);
  assert.deepEqual(peopleOf(p.emails.join(",")), p.emails);
  assert.equal(audienceLabel(""), "Everyone");
  assert.equal(audienceLabel("sara@example.com"), "sara@example.com");
  assert.equal(audienceLabel("a@x.co,b@x.co,c@x.co"), "3 chosen people");
});

test("chosen people are matched by the whole address in the database queries (never by a part of it)", () => {
  const lib = read("web/lib/announcements.ts");
  assert.equal(lib.match(/= ANY\(string_to_array\(/g)?.length, 3, "the app's list, the email list and the email count");
  assert.doesNotMatch(lib, /\bI?LIKE \$|position\(/);
});

test("news to everyone skips people who unsubscribed; a message to chosen people is ordinary mail", () => {
  const lib = read("web/lib/announcements.ts");
  assert.equal(lib.match(/\$2 = '' AND u\."emailVerified" = true AND COALESCE\(u\.oovi_status, 'active'\) <> 'blocked' AND u\.news_opt_out = false/g)?.length, 2, "the list and the count use the same rule");
  // (what the email looks like is checked in a browser test with a mail sink: the template can't be loaded here)
  const fn = read("web/lib/mail-templates.ts").split("export function personalMessage")[1]!.split("\nexport function")[0]!;
  assert.match(fn, /esc\(p\)/, "the owner's words are escaped: shown as text, never run");
  assert.doesNotMatch(fn, /unsub|List-Unsubscribe/i, "no news footer, no unsubscribe header");
  assert.match(read("web/app/admin/announcements/actions.ts"), /mailKindOf\(a\) === "message" \? personalMessage\(p\.email, a\.title, paragraphs\(a\.message\)\) : announcementEmail\(a, p\)/);
  assert.deepEqual(paragraphs("a\n\n\n b \n\n"), ["a", "b"]);
});

test("chosen people get the HTML design unless a message is written; the HTML is news, so it skips who unsubscribed", () => {
  assert.equal(mailKindOf({ testEmail: "", message: "" }), "news");
  assert.equal(mailKindOf({ testEmail: "", message: "left over" }), "news", "everyone always gets the HTML");
  assert.equal(mailKindOf({ testEmail: "a@x.co,b@x.co", message: "" }), "news");
  assert.equal(mailKindOf({ testEmail: "a@x.co", message: "  \n " }), "news", "blank is no message");
  assert.equal(mailKindOf({ testEmail: "a@x.co", message: "Hi Sara" }), "message");
  const lib = read("web/lib/announcements.ts");
  assert.equal(lib.match(/ANY\(string_to_array\(\$2, ','\)\) AND \(\$[34] <> '' OR u\.news_opt_out = false\)/g)?.length, 2, "the list and the count use the same rule");
  const actions = read("web/app/admin/announcements/actions.ts");
  assert.doesNotMatch(actions, /Write the message first/, "an empty message no longer blocks sending to chosen people");
  assert.match(actions, /message: written \? message : ""/, "the HTML choice saves no message");
});
