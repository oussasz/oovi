// Telegram while the computer is off: oovi's cloud server answers it, as it answers the phone
// (web/lib/telegram-cloud-core.ts). Before, the user got "open oovi on your computer" and waited.
import test from "node:test";
import assert from "node:assert/strict";
import { telegramToCloud } from "../../web/lib/telegram-cloud-core.ts";

const base = { relayOffline: true, desktopOnline: false, serverUp: true, syncOn: true, tgChatId: 777, pairedChatId: 777, mainChat: "dm-abc123", text: "شحال تجي 7 × 8؟", voice: false, updateId: 10, lastHanded: 0 };

test("computer off, server up, the paired chat writes: the cloud answers it", () => {
  assert.deepEqual(telegramToCloud(base), { cloud: true, chatId: "dm-abc123", payload: { text: "شحال تجي 7 × 8؟", entryId: "tg10", channel: "telegram", telegramChatId: 777 } });
  // /yes and /no go too: the server answers what it asked.
  assert.equal(telegramToCloud({ ...base, text: "/yes" }).cloud, true);
});

test("otherwise the message waits for the computer, as before", () => {
  for (const [why, x] of [
    ["the computer is on", { relayOffline: false }],
    ["a desktop was seen in the last minute", { desktopOnline: true }],
    ["the cloud server is down", { serverUp: false }],
    ["sync is off", { syncOn: false }],
    ["a linked group chat, not the paired chat", { tgChatId: 999 }],
    ["no main chat known yet (older app)", { mainChat: "" }],
    ["a voice note (it needs the computer's keys)", { voice: true, text: "" }],
    ["empty", { text: "  " }],
    ["/start", { text: "/start abc" }],
    ["Telegram sent the same update again", { updateId: 10, lastHanded: 10 }],
  ] as const) assert.equal(telegramToCloud({ ...base, ...x }).cloud, false, why);
});
