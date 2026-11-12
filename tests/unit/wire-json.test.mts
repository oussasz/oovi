import { test } from "node:test";
import assert from "node:assert/strict";
import { wireJson } from "../../lib/wire-json.ts";

test("text cut in the middle of an emoji still makes a request the service accepts", () => {
  const cut = "ouvert 😀 tous".slice(0, 8); // ends with half of 😀
  const body = wireJson({ messages: [{ role: "user", content: [{ type: "tool_result", content: cut }] }] });
  assert.ok(!/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i.test(body), body);
  assert.equal(JSON.parse(body).messages[0].content[0].content, "ouvert �");
});

test("whole text, Arabic and emoji are left exactly as they are", () => {
  const t = "مرحبا 😀 café";
  assert.equal(JSON.parse(wireJson({ t })).t, t);
});
