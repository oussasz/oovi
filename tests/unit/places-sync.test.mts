import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The app and the oovi server read the open places data with the same code: one change, both places.
const root = path.resolve(import.meta.dirname, "../..");
for (const f of ["places-core.ts", "places-data.ts"]) {
  test(`web/lib/${f} is the same file as lib/${f}`, () => {
    assert.equal(fs.readFileSync(path.join(root, "web/lib", f), "utf8"), fs.readFileSync(path.join(root, "lib", f), "utf8"));
  });
}
