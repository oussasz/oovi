// Tool inputs reshaped to their schema; hints on failures; shortening keeps start and end (lib/arg-repair-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { cutMiddle, NEXT_STEP, repairArgs, withNextStep } from "../../lib/arg-repair-core.ts";

const schema = {
  type: "object",
  properties: {
    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
    columns: { type: "array", items: { type: "string" } },
    count: { type: "integer" },
    price: { type: "number" },
    append: { type: "boolean" },
    meta: { type: "object", properties: { n: { type: "number" } } },
    name: { type: "string" },
  },
};

test("lists, numbers and yes/no sent as text are repaired", () => {
  const out = repairArgs({ rows: '[["a","b"]]', columns: "Name", count: "12", price: "3.5", append: "TRUE", meta: '{"n":"4"}', name: "42" }, schema);
  assert.deepEqual(out, { rows: [["a", "b"]], columns: ["Name"], count: 12, price: 3.5, append: true, meta: { n: 4 }, name: "42" });
});

test("good inputs come back untouched (the same object)", () => {
  const good = { rows: [["a"]], count: 2, name: "x", other: "kept" };
  assert.equal(repairArgs(good, schema), good);
  assert.deepEqual(repairArgs({ rows: "[not json" }, schema), { rows: "[not json" });
  assert.deepEqual(repairArgs({ count: "twelve" }, schema), { count: "twelve" });
});

test("a failure gets a next step once; one that already says what to do is left alone", () => {
  assert.ok(withNextStep("Error: 404").endsWith(NEXT_STEP));
  assert.equal(withNextStep(withNextStep("Error: 404")), withNextStep("Error: 404"));
  assert.equal(withNextStep("The page refused: use open_url instead."), "The page refused: use open_url instead.");
});

test("shortening keeps the start and the end", () => {
  const t = `START${"x".repeat(2000)}END`;
  const c = cutMiddle(t, 800, (n) => `[${n} cut]`);
  assert.ok(c.startsWith("START") && c.endsWith("END") && c.includes("[1208 cut]"));
  assert.equal(cutMiddle("short", 800, () => "x"), "short");
});
