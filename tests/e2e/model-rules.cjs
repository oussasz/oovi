// What the real model API refuses, so the scripted model refuses it too. Without this a scenario
// passes on a request the real service rejects (that is how the "prefill" error reached users).
function refusal(body) {
  const msgs = Array.isArray(body && body.messages) ? body.messages : [];
  if (!msgs.length) return "messages: at least one message is required";
  if (msgs[msgs.length - 1].role !== "user") return "This model does not support assistant message prefill. The conversation must end with a user message.";
  for (let i = 1; i < msgs.length; i++) if (msgs[i].role === msgs[i - 1].role) return `messages: roles must alternate (message ${i})`;
  return null;
}
// The done-check (lib/done-check-core.ts) is a separate call: by default it says "done", so a scenario
// sees only its bots' own calls. A scenario that tests the check sets doneCheck.verdict(body) => {status,…}.
const doneCheck = { verdict: () => ({ status: "done", missing: "", goal: "" }) };
const isDoneCheck = (body) => {
  const sys = typeof body.system === "string" ? body.system : Array.isArray(body.system) ? body.system.map((x) => x.text || "").join("\n") : "";
  return /You check whether an AI assistant has finished what the user asked/.test(sys);
};
const doneReply = (body) => ({ id: "msg_check", type: "message", role: "assistant", model: "theOovi", content: [{ type: "text", text: JSON.stringify(doneCheck.verdict(body)) }], stop_reason: "end_turn", usage: { input_tokens: 50, output_tokens: 20 } });
module.exports = { refusal, doneCheck, isDoneCheck, doneReply };
