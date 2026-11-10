import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTools, hasComputerToolset, supportsComputerToolset } from "../../web/lib/ai-tools.ts";

const app = { name: "web_search", description: "Search", input_schema: { type: "object", properties: {} } };

test("app tools pass as before", () => {
  assert.deepEqual(cleanTools(undefined), []);
  assert.deepEqual(cleanTools([app]), [app]);
  assert.deepEqual(cleanTools([{ ...app, cache_control: { type: "ephemeral", ttl: "1h" }, extra: 1 }]), [{ ...app, cache_control: { type: "ephemeral" } }]);
  assert.equal(cleanTools([{ name: "bad name", input_schema: {} }]), null);
  assert.equal(cleanTools([{ name: "x" }]), null);
});

test("the computer toolset entry is accepted", () => {
  assert.deepEqual(cleanTools([app, { type: "computer_toolset_20260801" }]), [app, { type: "computer_toolset_20260801" }]);
  assert.deepEqual(cleanTools([{ type: "computer_toolset_20260801", cache_control: { type: "ephemeral" } }]), [{ type: "computer_toolset_20260801", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(cleanTools([{ type: "computer_toolset_20260801", configs: { zoom: { enabled: false } } }]), [{ type: "computer_toolset_20260801", configs: { zoom: { enabled: false } } }]);
  assert.deepEqual(cleanTools([{ type: "computer_toolset_20260801", configs: {} }]), [{ type: "computer_toolset_20260801" }]);
  // A custom tool may share a member's name ("type"): Anthropic tells them apart by toolset_name.
  assert.ok(cleanTools([{ ...app, name: "type" }, { type: "computer_toolset_20260801" }]));
  const t = cleanTools([app, { type: "computer_toolset_20260801" }]);
  assert.equal(hasComputerToolset(t!), true);
  assert.equal(hasComputerToolset(cleanTools([app])!), false);
});

test("malformed toolset entries are refused", () => {
  const bad: unknown[] = [
    [{ type: "computer_toolset_20260801" }, { type: "computer_toolset_20260801" }],
    [{ type: "computer_toolset_20260801", name: "computer" }],
    [{ type: "computer_toolset_20260801", display_width_px: 1024, display_height_px: 768 }],
    [{ type: "computer_toolset_20260801", enable_zoom: true }],
    [{ type: "computer_toolset_20260801", defer_loading: true }],
    [{ type: "computer_toolset_20260801", allowed_callers: ["direct"] }],
    [{ type: "computer_toolset_20260801", strict: true }],
    [{ type: "computer_toolset_20260801", configs: [] }],
    [{ type: "computer_toolset_20260801", configs: { teleport: { enabled: true } } }],
    [{ type: "computer_toolset_20260801", configs: { zoom: { enabled: "no" } } }],
    [{ type: "computer_toolset_20260801", configs: { zoom: { enabled: false, defer_loading: true } } }],
    [{ type: "computer_toolset_20260801", configs: { zoom: true } }],
    [{ type: "computer_20251124", name: "computer", display_width_px: 1024, display_height_px: 768 }],
    [{ type: "browser_toolset_20260801" }],
    [{ type: "web_search_20260209", name: "web_search" }],
    [{ type: "bash_20250124", name: "bash" }],
    [{ type: "custom", name: "x", input_schema: {} }],
    [{ name: "computer", description: "", input_schema: { type: "object" } }],
    [null],
    "computer_toolset_20260801",
  ];
  for (const b of bad) assert.equal(cleanTools(b), null, JSON.stringify(b));
  const all = Object.fromEntries(["screenshot", "zoom", "left_click", "right_click", "middle_click", "double_click", "triple_click", "left_click_drag", "mouse_move", "left_mouse_down", "left_mouse_up", "cursor_position", "scroll", "type", "key", "hold_key", "wait"].map((m) => [m, { enabled: false }]));
  assert.equal(cleanTools([{ type: "computer_toolset_20260801", configs: all }]), null);
});

test("models that may answer with the toolset", () => {
  for (const m of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-fable-5-2"]) assert.ok(supportsComputerToolset(m), m);
  for (const m of ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-7", "", "gpt-5"]) assert.equal(supportsComputerToolset(m), false, m);
});
