// What the real model API refuses, so the scripted model refuses it too. Without this a scenario
// passes on a request the real service rejects (that is how the "prefill" error reached users).
function refusal(body) {
  const msgs = Array.isArray(body && body.messages) ? body.messages : [];
  if (!msgs.length) return "messages: at least one message is required";
  if (msgs[msgs.length - 1].role !== "user") return "This model does not support assistant message prefill. The conversation must end with a user message.";
  for (let i = 1; i < msgs.length; i++) if (msgs[i].role === msgs[i - 1].role) return `messages: roles must alternate (message ${i})`;
  return null;
}
module.exports = { refusal };
