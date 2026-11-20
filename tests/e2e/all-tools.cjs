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

/**
 * A request as a stand-in model reads it: calls made through use_tool appear under the tool's own name, and
 * the guide a one-step tool brings with its first result is taken off the result. The scenarios' stand-ins
 * decide by "which tool did I call last" and "what did it answer", like the real model does after use_tool.
 */
module.exports.asModel = function asModel(body) {
  if (!body || !Array.isArray(body.messages)) return body;
  // What was taken off the results: the guides the bot was given so far (a scenario can check what they say).
  let guides = "";
  const strip = (s) => {
    if (typeof s !== "string" || !s.startsWith("[guide:")) return s;
    const end = s.indexOf("[/guide]");
    const rest = end < 0 ? "" : s.slice(end + 8).replace(/^\n/, "");
    guides += `${end < 0 ? s : s.slice(0, end + 8)}\n`;
    return rest || s; // a guide alone (the answer to a request for it) stays
  };
  const messages = body.messages.map((m) =>
    !Array.isArray(m.content)
      ? m
      : {
          ...m,
          content: m.content.map((b) =>
            b.type === "tool_use" && b.name === "use_tool" && b.input && typeof b.input.name === "string" && b.input.input !== undefined
              ? { ...b, name: b.input.name, input: b.input.input }
              : b.type === "tool_result"
                ? { ...b, content: typeof b.content === "string" ? strip(b.content) : Array.isArray(b.content) ? b.content.map((c) => (c.type === "text" ? { ...c, text: strip(c.text) } : c)) : b.content }
                : b,
          ),
        },
  );
  return { ...body, messages, tools: module.exports(body), guides };
};
