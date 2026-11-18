// Connector tools: reading never asks, acting asks (lib/action-kind-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { toolKind } from "../../lib/action-kind-core.ts";

test("reading tools are reads", () => {
  for (const n of ["search_emails", "list_events", "get_thread", "listMessages", "getPage", "read_file", "find_contacts", "query_database", "describe_table", "fetch"]) assert.equal(toolKind(n), "read", n);
});

test("anything that changes, sends or pays is an action", () => {
  for (const n of ["send_email", "create_event", "delete_message", "post_message", "update_page", "get_and_delete", "list_and_archive", "pay_invoice", "createDraft", "unknown_thing"]) assert.equal(toolKind(n), "act", n);
});

test("the server's own hints win", () => {
  assert.equal(toolKind("send_email", { readOnly: true }), "read");
  assert.equal(toolKind("get_rows", { destructive: true }), "act");
});

test("Zapier's read and write actions", () => {
  assert.equal(toolKind("execute_zapier_read_action"), "read");
  assert.equal(toolKind("mcp_zapier_execute_zapier_read_action"), "read");
  assert.equal(toolKind("execute_zapier_write_action"), "act");
});
