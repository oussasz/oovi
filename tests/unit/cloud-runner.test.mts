// The cloud runner's rules inside the app (lib/cloud-runner-core.ts): which steps need the user's computer,
// what the bot says then, and what a phone's job may ask the run to do.
import test from "node:test";
import assert from "node:assert/strict";
import { CLOUD_NOTE, cloudTools, firstNeedingComputer, HAND_SPEC, HAND_TO_COMPUTER, handOver, needsComputer, needsComputerText, pickLocale, runInputOf, TOO_LATE_FOR_COMPUTER } from "../../lib/cloud-runner-core.ts";

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

test("in the cloud a bot is offered only what runs there, plus one way to leave the request for the computer", () => {
  const all = ["web_search", "read_url", "create_document", "read_document", "browser", "desktop", "find_places", "mcp_zapier_send_email", "memory", "read_attachment"].map((name) => ({ name }));
  const kept = cloudTools(all).map((t) => t.name);
  assert.deepEqual(kept, ["web_search", "read_url", "find_places", "mcp_zapier_send_email", "memory", HAND_TO_COMPUTER]);
  assert.equal(HAND_SPEC.name, HAND_TO_COMPUTER);
  // Calling it ends the step as "needs the computer", like any call that can't run in the cloud.
  assert.equal(needsComputer({ name: HAND_TO_COMPUTER }), true);
  assert.match(CLOUD_NOTE, /computer is off/);
  assert.match(CLOUD_NOTE, new RegExp(HAND_TO_COMPUTER));
});

test("reading the rows of a work table runs in the cloud (a list built there is read there)", () => {
  assert.equal(needsComputer({ name: "read_rows" }), false);
  assert.equal(needsComputer({ name: "use_tool", input: { name: "read_rows" } }), false);
  // One action per row keeps its ledger on the computer: a second run in the cloud would send everything again.
  assert.equal(needsComputer({ name: "for_each_row" }), true);
});

test("a request is left for the computer whole, or not at all", () => {
  // Nothing ran, or only lookups: the computer runs the same message again from the start.
  assert.equal(handOver([]), "whole");
  assert.equal(handOver(["use_tool", "web_search", "read_url", "update_plan", "recall_history", "read_rows"]), "whole");
  // Something was sent, saved or set here: running the message again on the computer would do it twice.
  assert.equal(handOver(["mcp_zapier_gmail_send_email"]), "late");
  assert.equal(handOver(["web_search", "send_telegram"]), "late");
  assert.equal(handOver(["work_table"]), "late");
  assert.equal(handOver(["propose_routine"]), "late");
  assert.match(TOO_LATE_FOR_COMPUTER, /twice/);
});

test("a Telegram message handed to the cloud keeps where its answer goes", () => {
  const r = runInputOf("message", { text: "hi", entryId: "tg123", channel: "telegram", telegramChatId: 5550001 }) as Record<string, unknown>;
  assert.equal(r.channel, "telegram");
  assert.equal(r.telegramChatId, 5550001);
  // Only Telegram, and only with a real chat id: nothing else the phone could send sets a channel.
  assert.equal((runInputOf("message", { text: "hi", channel: "slack" }) as Record<string, unknown>).channel, undefined);
  assert.equal((runInputOf("message", { text: "hi", channel: "telegram", telegramChatId: "x" }) as Record<string, unknown>).channel, undefined);
});
