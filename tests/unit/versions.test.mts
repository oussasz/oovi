import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, tooOld } from "../../web/lib/versions.ts";

test("versions compare as numbers, not text (0.10.7 is newer than 0.9.12)", () => {
  assert.equal(compareVersions("0.10.7", "0.9.12"), 1);
  assert.equal(compareVersions("0.10.6", "0.10.7"), -1);
  assert.equal(compareVersions("0.10.13", "0.10.13"), 0);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), 0);
});

test("only versions below the minimum are asked to update; no minimum, unknown or dev versions never", () => {
  const cfg = { minAppVersion: "0.10.7" };
  assert.equal(tooOld("0.10.6", cfg), true);
  assert.equal(tooOld("0.10.3", cfg), true);
  assert.equal(tooOld("0.10.7", cfg), false);
  assert.equal(tooOld("0.10.13", cfg), false);
  assert.equal(tooOld(null, cfg), false);
  assert.equal(tooOld("dev", cfg), false);
  assert.equal(tooOld("0.10.3", { minAppVersion: "" }), false);
});
