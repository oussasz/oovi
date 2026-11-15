import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { pickSource } = require("../../electron/desktop-control.cjs");

const img = (w: number, h: number) => ({ isEmpty: () => w === 0, getSize: () => ({ width: w, height: h }) });
const src = (id: string, w = 1920, h = 1080) => ({ display_id: id, thumbnail: img(w, h) });
const disp = (id: number, w = 1920, h = 1080) => ({ id, size: { width: w, height: h } });

test("matches the screen by its id", () => {
  const a = disp(1), b = disp(2);
  const s = [src("1"), src("2")];
  assert.equal(pickSource(s, b, [a, b]), s[1]);
});

test("one screen whose picture carries no id (some drivers): still captured", () => {
  const a = disp(77);
  const s = [src("")];
  assert.equal(pickSource(s, a, [a]), s[0]);
});

test("one screen whose picture carries another id: still captured", () => {
  const a = disp(77);
  const s = [src("123456")];
  assert.equal(pickSource(s, a, [a]), s[0]);
});

test("two screens without ids: same position in the list", () => {
  const a = disp(1), b = disp(2);
  const s = [src(""), src("")];
  assert.equal(pickSource(s, a, [a, b]), s[0]);
  assert.equal(pickSource(s, b, [a, b]), s[1]);
});

test("two screens, ids missing and counts differ: the one with the screen's shape", () => {
  const a = disp(1, 1920, 1080), b = disp(2, 1080, 1920);
  const s = [src("", 1080, 1920)];
  assert.equal(pickSource(s, b, [a, b, disp(3, 2560, 1080)]), s[0]);
});

test("never another screen's picture, never an empty one", () => {
  const a = disp(1), b = disp(2);
  assert.equal(pickSource([src("1")], b, [a, b]), null);
  assert.equal(pickSource([src("2", 0, 0)], b, [a, b]), null);
  assert.equal(pickSource([], b, [a, b]), null);
});

test("ambiguous: two same-shaped untagged pictures and the counts differ", () => {
  const a = disp(1), b = disp(2), c = disp(3);
  assert.equal(pickSource([src(""), src("")], b, [a, b, c]), null);
});
