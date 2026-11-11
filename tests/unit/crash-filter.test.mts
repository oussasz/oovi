import { test } from "node:test";
import assert from "node:assert/strict";
import { isRealCrash } from "../../lib/crash-filter.ts";

test("browser notices that aren't crashes are not reported", () => {
  assert.equal(isRealCrash("ResizeObserver loop completed with undelivered notifications."), false);
  assert.equal(isRealCrash("ResizeObserver loop limit exceeded"), false);
  assert.equal(isRealCrash("Uncaught ResizeObserver loop completed with undelivered notifications."), false);
  assert.equal(isRealCrash("Script error."), false);
});

test("real errors are still reported", () => {
  assert.equal(isRealCrash("Cannot read properties of undefined (reading 'map')"), true);
  assert.equal(isRealCrash("ResizeObserver is not defined"), true);
  assert.equal(isRealCrash("Unknown error"), true);
  assert.equal(isRealCrash(""), true);
});
