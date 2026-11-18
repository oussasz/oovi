// The cloud runner's rules inside the app (lib/cloud-runner-core.ts): which steps need the user's computer,
// what the bot says then, and what a phone's job may ask the run to do.
import test from "node:test";
import assert from "node:assert/strict";
import { firstNeedingComputer, needsComputer, needsComputerText, pickLocale, runInputOf } from "../../lib/cloud-runner-core.ts";

test("chat, web, places, papers, work tables, routines, connectors and Telegram run in the cloud", () => {
  for (const name of ["web_search", "research", "read_url", "find_places", "find_papers", "work_table", "work_notes", "propose_routine", "list_routines", "send_telegram", "memory", "ask_user", "run_helpers", "mcp_gmail_send_email"]) assert.equal(needsComputer({ name }), false, name);
});

test("files, desktop, the bots' browser, documents, the user's own cloud computer and other chats need the computer", () => {
  for (const name of ["read_computer_file", "find_files", "write_file", "run_command", "open_url", "click", "fill_login", "read_page", "create_document", "create_presentation", "send_file_to_user", "open_app", "computer", "open_in_user_browser", "vm_run", "read_attachment", "message_group", "work_export", "some_tool_added_later"]) assert.equal(needsComputer({ name }), true, name);
});

test("an on-demand tool's guide is judged by the tool it is about", () => {
  assert.equal(needsComputer({ name: "use_tool", input: { name: "create_presentation" } }), true);
  assert.equal(needsComputer({ name: "use_tool", input: { name: "work_table" } }), false);
  assert.equal(needsComputer({ name: "use_tool", input: {} }), false);
  assert.equal(needsComputer({ name: "use_tool", input: { name: "use_tool" } }), false);
});

test("the first call that needs the computer is the one reported", () => {
  const calls = [{ name: "web_search" }, { name: "open_app" }, { name: "click" }];
  assert.equal(firstNeedingComputer(calls)?.name, "open_app");
  assert.equal(firstNeedingComputer([{ name: "web_search" }]), null);
});

test("the answer follows the user's language", () => {
  assert.equal(pickLocale("ar", false), "ar");
  assert.equal(pickLocale("fr", true), "darija");
  assert.equal(pickLocale("fr", false), "fr");
  assert.equal(pickLocale(null, false), "en");
  assert.match(needsComputerText("en"), /needs your computer/);
  assert.match(needsComputerText("fr"), /ordinateur/);
  assert.match(needsComputerText("ar"), /حاسوبك/);
  assert.match(needsComputerText("darija"), /ordinateur ta3ek/);
  for (const l of ["en", "fr", "ar", "darija"] as const) assert.match(needsComputerText(l), /oovi/);
});

test("a phone's message becomes a run input with only the allowed fields", () => {
  const r = runInputOf("message", { text: "  hello  ", effort: "high", entryId: "abc", routine: "x", channel: "telegram", attachments: ["a"] });
  assert.deepEqual(r, { text: "hello", effort: "high", deep: false, plan: false, entryId: "abc" });
  assert.equal(runInputOf("message", { text: "   " }), "empty message");
  assert.equal(runInputOf("message", { text: "x".repeat(20_001) }), "message too long");
  assert.equal(typeof runInputOf("message", { text: "hi", entryId: "../../etc" }), "object");
  assert.equal((runInputOf("message", { text: "hi", entryId: "../../etc" }) as Record<string, unknown>).entryId, undefined);
});

test("approval answers, plan answers and question answers are cleaned", () => {
  assert.deepEqual(runInputOf("decision", { decisions: { toolu_1: true, toolu_2: "yes", "bad key!": true }, alwaysFolders: true }), { decisions: { toolu_1: true }, alwaysEdit: false, alwaysFolders: false, allowChat: false, allowSite: false });
  assert.deepEqual(runInputOf("decision", { planDecision: { approve: true, items: ["a", 3, "b"] } }), { planDecision: { approve: true, items: ["a", "b"] } });
  assert.deepEqual(runInputOf("decision", { answers: ["x", 5] }), { answers: ["x", ""] });
  assert.deepEqual(runInputOf("decision", { answers: null }), { answers: null });
  assert.equal(runInputOf("decision", { decisions: {} }), "no decision");
  assert.equal(runInputOf("stop", {}), "unknown kind stop");
});
