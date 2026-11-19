import { test } from "node:test";
import assert from "node:assert/strict";
import { problemKey } from "../../web/lib/problem-key.ts";


test("the same error on two sites is one problem; a 403 and a 500 are two", () => {
  assert.equal(problemKey("read_url failed on a.com: HTTP 403 Forbidden"), problemKey("read_url failed on b.dz: HTTP 403 Forbidden"));
  assert.notEqual(problemKey("read_url failed on a.com: HTTP 403 Forbidden"), problemKey("read_url failed on a.com: HTTP 500 Error"));
});
