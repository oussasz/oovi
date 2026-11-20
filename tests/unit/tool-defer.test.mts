// Tools on demand (lib/tool-defer.ts): rarely used tools go as one line inside use_tool; calls come back as real calls.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFERRED, deferTools, guideSeen, guideText, isGuide, unwrapCalls, USE_TOOL, useToolResult, wrapHistory } from "../../lib/tool-defer.ts";

const spec = (name: string, size = 50) => ({ name, description: `${name} does things. ${"x".repeat(size)}`, parameters: { type: "object", properties: { filename: { type: "string" } }, required: ["filename"] } });
// (memory stands for any everyday tool that is always sent in full.)
const tools = [spec("read_url"), spec("create_image", 3000), spec("memory"), spec("create_presentation", 2500), spec("edit_copy_of_file", 2500)];

test("on-demand tools are folded into use_tool; everyday tools are untouched and keep their order", () => {
  const d = deferTools(tools);
  assert.deepEqual(d.sent.map((t) => t.name), ["read_url", "memory", USE_TOOL]);
  assert.deepEqual(d.deferred.map((t) => t.name), ["create_image", "create_presentation", "edit_copy_of_file"]);
  const use = d.sent.at(-1)!;
  for (const n of ["create_image", "create_presentation", "edit_copy_of_file"]) assert.ok(use.description.includes(`- ${n}: ${DEFERRED[n]}`));
  assert.deepEqual((use.parameters as { properties: { name: { enum: string[] } } }).properties.name.enum, ["create_image", "create_presentation", "edit_copy_of_file"]);
  assert.ok(JSON.stringify(d.sent).length < JSON.stringify(tools).length / 2, "the request gets much smaller");
  // Same tools, same request: the cached top of the request never changes.
  assert.equal(JSON.stringify(deferTools(tools).sent), JSON.stringify(d.sent));
});

test("nothing is folded for a bot with fewer than two on-demand tools", () => {
  const few = [spec("read_url"), spec("create_image")];
  assert.equal(deferTools(few).sent, few);
  assert.equal(deferTools(few).deferred.length, 0);
});

test("the first call gets the guide; with the guide in view, the call becomes the real tool's call", () => {
  const d = deferTools(tools);
  const ask = { id: "a", name: USE_TOOL, input: { name: "create_image" } };
  assert.deepEqual(unwrapCalls([ask], d, []), [ask]);
  const guide = useToolResult(ask, tools);
  assert.ok(!guide.isError && isGuide(guide) && guide.content.includes('"filename"') && guide.content.includes("create_image does things"));
  assert.equal(guide.content, guideText(tools[1]!));
  const seen = [{ role: "assistant" as const, text: "", toolCalls: [ask] }, { role: "tool" as const, results: [guide] }];
  assert.equal(guideSeen(seen, "create_image"), true);
  assert.equal(guideSeen(seen, "edit_copy_of_file"), false);
  const real = { id: "b", name: USE_TOOL, input: { name: "create_image", input: { filename: "a.png" } } };
  assert.deepEqual(unwrapCalls([real], d, seen), [{ id: "b", name: "create_image", input: { filename: "a.png" } }]);
  // Input sent as JSON text is read too.
  assert.deepEqual(unwrapCalls([{ ...real, input: { name: "create_image", input: '{"filename":"a.png"}' } }], d, seen)[0]!.name, "create_image");
  // Called with input before reading the guide: it stays a use_tool call, answered with the guide (never run on guessed parameters).
  assert.deepEqual(unwrapCalls([real], d, []), [real]);
  assert.ok(isGuide(useToolResult(real, tools)));
  // A guide that was shortened no longer counts.
  const cutGuide = [{ role: "tool" as const, results: [{ ...guide, content: `${guide.content.slice(0, 200)}\n[older result shortened]` }] }];
  assert.equal(guideSeen(cutGuide, "create_image"), false);
  // Everyday calls pass through.
  const plain = { id: "c", name: "read_url", input: { url: "https://example.com" } };
  assert.deepEqual(unwrapCalls([plain], d, seen), [plain]);
});

test("wrong names are explained", () => {
  assert.match(useToolResult({ id: "a", name: USE_TOOL, input: { name: "read_url" } }, tools).content, /call it directly/);
  const none = useToolResult({ id: "a", name: USE_TOOL, input: { name: "fly" } }, tools);
  assert.ok(none.isError && /create_image, create_presentation, edit_copy_of_file/.test(none.content));
});

test("the conversation is sent with on-demand calls shown through use_tool, the same way every time", () => {
  const d = deferTools(tools);
  const history = [
    { role: "user" as const, content: "make a poster" },
    { role: "assistant" as const, text: "", toolCalls: [{ id: "b", name: "create_image", input: { filename: "a.png" } }, { id: "c", name: "read_url", input: { url: "u" } }] },
    { role: "tool" as const, results: [{ id: "b", name: "create_image", content: "Created" }, { id: "c", name: "read_url", content: "page" }] },
  ];
  const sent = wrapHistory(history, d);
  assert.deepEqual((sent[1] as (typeof history)[1]).toolCalls, [{ id: "b", name: USE_TOOL, input: { name: "create_image", input: { filename: "a.png" } } }, { id: "c", name: "read_url", input: { url: "u" } }]);
  assert.deepEqual((sent[2] as (typeof history)[2]).results.map((r) => r.name), [USE_TOOL, "read_url"]);
  assert.equal(JSON.stringify(wrapHistory(history, d)), JSON.stringify(sent));
  assert.equal(history[1]!.toolCalls[0]!.name, "create_image", "the saved conversation keeps the real names");
  assert.equal(wrapHistory(history, deferTools([spec("read_url")])), history);
});

test("many connector tools are sent on demand too; a few stay in full", async () => {
  const { deferTools, onDemand, MANY_CONNECTOR_TOOLS } = await import("../../lib/tool-defer.ts");
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `mcp_x_tool_${i}`, description: `Does thing ${i}. More words here.`, parameters: { type: "object", properties: {} } }));
  const few = [...mk(MANY_CONNECTOR_TOOLS), { name: "create_image", description: "x", parameters: {} }, { name: "create_presentation", description: "y", parameters: {} }];
  assert.ok(deferTools(few as never).sent.some((t) => t.name === "mcp_x_tool_0"));
  const many = [...mk(MANY_CONNECTOR_TOOLS + 1), { name: "read_url", description: "r", parameters: {} }];
  const d = deferTools(many as never);
  assert.ok(!d.sent.some((t) => t.name.startsWith("mcp_")));
  assert.ok(d.sent.some((t) => t.name === "read_url"));
  const use = d.sent.find((t) => t.name === "use_tool")!;
  assert.match(use.description, /- mcp_x_tool_3\(\): Does thing 3\./);
  assert.ok(onDemand(many as never, "mcp_x_tool_0") && !onDemand(many as never, "read_url"));
});

test("a connector tool is used in one step: its line names its parameters, and a call with input is the real call", async () => {
  const { deferTools, unwrapCalls, paramsHint } = await import("../../lib/tool-defer.ts");
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `mcp_z_tool_${i}`, description: `Does thing ${i}. More words.`, parameters: { type: "object", properties: { selected_api: { type: "string" }, params: { type: "object" }, note: { type: "string" } }, required: ["selected_api", "params"] } }));
  const many = [...mk(16), { name: "read_url", description: "r", parameters: {} }];
  const d = deferTools(many as never);
  const use = d.sent.find((t) => t.name === "use_tool")!;
  assert.match(use.description, /- mcp_z_tool_3\(selected_api, params, note\?\): Does thing 3\./);
  const call = { id: "a", name: "use_tool", input: { name: "mcp_z_tool_3", input: { selected_api: "Gmail", params: { to: "a@b.dz" } } } };
  assert.deepEqual(unwrapCalls([call], d, []), [{ id: "a", name: "mcp_z_tool_3", input: { selected_api: "Gmail", params: { to: "a@b.dz" } } }]);
  // With no input it is still a request for the guide.
  const ask = { id: "b", name: "use_tool", input: { name: "mcp_z_tool_3" } };
  assert.deepEqual(unwrapCalls([ask], d, []), [ask]);
  assert.match(paramsHint(many[0] as never), /"selected_api"/);
});

test("a connector tool that takes nothing runs when it is named: there is no input to wait for", async () => {
  const { deferTools, unwrapCalls } = await import("../../lib/tool-defer.ts");
  const many = Array.from({ length: 16 }, (_, i) => ({ name: `mcp_q_tool_${i}`, description: `Does thing ${i}.`, parameters: { type: "object", properties: {} } }));
  const d = deferTools(many as never);
  assert.deepEqual(unwrapCalls([{ id: "a", name: "use_tool", input: { name: "mcp_q_tool_2" } }], d, []), [{ id: "a", name: "mcp_q_tool_2", input: {} }]);
});

test("everyday-but-long tools are listed in one line with their parameters and called in one step", async () => {
  const { deferTools, unwrapCalls, DIRECT } = await import("../../lib/tool-defer.ts");
  const mk = (name: string, props: Record<string, unknown>, required: string[] = []) => ({ name, description: `${name} does things. ${"x".repeat(900)}`, parameters: { type: "object", properties: props, required } });
  const list = [mk("read_url", { url: {} }, ["url"]), mk("work_table", { action: {}, table: {}, rows: {} }, ["action", "table"]), mk("find_places", { area: {}, categories: {} }, ["area"]), mk("create_image", { filename: {} }, ["filename"]), mk("create_presentation", { filename: {} }, ["filename"])];
  assert.ok("work_table" in DIRECT && "find_places" in DIRECT);
  const d = deferTools(list as never);
  assert.deepEqual(d.sent.map((t) => t.name), ["read_url", "use_tool"]);
  const use = d.sent.at(-1)!;
  assert.match(use.description, /- work_table\(action, table, rows\?\): /);
  assert.match(use.description, /- find_places\(area, categories\?\): /);
  // A tool whose first call IS the deliverable still gets its guide first.
  assert.match(use.description, /- create_image: /);
  const call = { id: "a", name: "use_tool", input: { name: "work_table", input: { action: "read", table: "T" } } };
  assert.deepEqual(unwrapCalls([call], d, []), [{ id: "a", name: "work_table", input: { action: "read", table: "T" } }]);
  const img = { id: "b", name: "use_tool", input: { name: "create_image", input: { filename: "a.png" } } };
  assert.deepEqual(unwrapCalls([img], d, []), [img]);
});

test("the first result of a one-step tool carries its guide, once: no round trip to learn it, and it survives shortening", async () => {
  const { withFirstGuide, splitGuide } = await import("../../lib/tool-defer.ts");
  const spec = { name: "work_table", description: "The team's tables. Long rules here.", parameters: { type: "object", properties: { action: {} } } };
  const first = withFirstGuide({ id: "1", name: "work_table", content: "3 added." }, spec as never, []);
  assert.match(first.content, /^\[guide:work_table\]/);
  assert.match(first.content, /Long rules here/);
  assert.match(first.content, /\[\/guide\]\n3 added\.$/);
  const history = [{ role: "tool" as const, results: [first] }];
  const second = withFirstGuide({ id: "2", name: "work_table", content: "2 added." }, spec as never, history);
  assert.equal(second.content, "2 added.");
  const parts = splitGuide(first.content);
  assert.match(parts.guide, /\[\/guide\]$/);
  assert.equal(parts.rest, "3 added.");
  assert.deepEqual(splitGuide("plain"), { guide: "", rest: "plain" });
});
