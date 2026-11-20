// The tools a bot has in a request, as a stand-in model sees them: the ones sent in full, plus the ones listed
// in one line inside use_tool (lib/tool-defer.ts). A stand-in calls a listed tool by its own name, as a real
// model's use_tool call arrives after it is unwrapped.
module.exports = function allTools(body) {
  const tools = body.tools || [];
  const use = tools.find((t) => t.name === "use_tool");
  if (!use) return tools;
  const names = (((use.input_schema || {}).properties || {}).name || {}).enum || [];
  const line = (n) => (new RegExp(`^- ${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\([^)]*\\))?: (.*)$`, "m").exec(use.description || "") || [])[2] || "";
  return [...tools, ...names.filter((n) => !tools.some((t) => t.name === n)).map((n) => ({ name: n, description: line(n), onDemand: true }))];
};
