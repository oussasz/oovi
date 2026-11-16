import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FRAME_CSP, FRAME_SANDBOX, framedHtml } from "../../lib/announcement-frame.ts";

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
