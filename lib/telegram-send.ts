// Bots message the user on their own Telegram (the chat they paired in Settings > Telegram), right away.
// Before this, a request like "send me that on Telegram now" had no built-in way, and bots tried Zapier.
import type { ToolSpec } from "./llm";
import { cloudRunner } from "./cloud-flag";
import { sendToMainChat, telegramConnected } from "./telegram";
import type { ToolCall, ToolResult } from "./types";

export const SEND_TELEGRAM_SPEC: ToolSpec = {
  name: "send_telegram",
  description:
    "Send a message to the user's own Telegram right now (the oovi chat they connected in Settings > Telegram). Use it when the user asks to get something on Telegram or on their phone. Never use Zapier or another connector for the user's own Telegram. Plain text, up to 4,000 characters. To send later or on a schedule, propose a routine instead.",
  parameters: { type: "object", properties: { text: { type: "string", description: "The message, in the user's language" } }, required: ["text"] },
};

export async function runSendTelegram(c: ToolCall): Promise<ToolResult> {
  const text = String(c.input.text ?? "").trim();
  if (!text) return { id: c.id, name: c.name, content: "Write the message (text).", isError: true };
  // On the cloud server there is no Telegram file: the website sends it with the account's own connection.
  const cloud = cloudRunner();
  if (!cloud && !telegramConnected())
    return { id: c.id, name: c.name, content: "Telegram isn't connected in oovi yet. Tell the user in one line, with this link: [Connect Telegram](oovi://settings/telegram). Don't use Zapier for it.", isError: true };
  const ok = await sendToMainChat(text.slice(0, 4000)).catch(() => false);
  if (!ok && cloud)
    return { id: c.id, name: c.name, content: "Couldn't send it to Telegram from oovi's cloud server (Telegram may not be connected for this account). Say so in one line; it is in this chat.", isError: true };
  return ok
    ? { id: c.id, name: c.name, content: `Sent to the user's Telegram${text.length > 4000 ? " (cut at 4,000 characters)" : ""}. It is queued and retried if Telegram or the network is down.` }
    : { id: c.id, name: c.name, content: "Couldn't send it to Telegram. Ask the user to check Settings > Telegram.", isError: true };
}
