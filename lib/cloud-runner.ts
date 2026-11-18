// The cloud runner's side inside the app's server (OOVI_CLOUD_RUNNER=1, started by runner/job-server.cjs for one
// job, in a fresh data folder). runner/ talks to it over the process's IPC channel; nothing is served over HTTP.
//   prepare {chatId, chat, work} → the account's setup (through the runner's proxy), then the chat and its work
//                                   files; answers the connectors the chat's bots use (mcpIds)
//   connectors {vault}           → those connectors with their sign-in, from the account's vault
//   run {chatId, kind, payload}  → runs it with the app's own orchestrator; "step" after every saved change,
//                                   "ended" at the end (needsComputer: the tool that needed the computer)
//   stop {chatId}, chat {chatId} (the chat and its work files as they are now)
//   finish                       → the setup goes back to the account (memory, routines, lessons made by the
//                                   job), and the connectors' refreshed sign-ins are returned to the runner
// Never logs chat content.

import { onNeedsComputer } from "./cloud-flag";
import { runInputOf } from "./cloud-runner-core";
import { installVaultConnector, vaultSignIn, type VaultConnector } from "./mcp";
import type { RunInput } from "./orchestrator";
import { startRun, stopRun, subscribe } from "./runner";
import { pullSetup, syncSetup } from "./setup-sync";
import { getChat, listBots, saveChat } from "./store";
import type { Chat } from "./types";
import { loadWork, saveWork } from "./workfiles";
import type { WorkStore } from "./workfiles-core";

type Msg = { type: string; id?: number; [k: string]: unknown };
const send = (m: Record<string, unknown>) => {
  try {
    process.send?.(m);
  } catch {
    /* the runner is gone: this process ends with it */
  }
};
const reply = (m: Msg, body: Record<string, unknown>) => send({ type: "reply", id: m.id, ...body });

const g = globalThis as typeof globalThis & { __ooviCloudRunner?: boolean };
const signIns = new Map<string, string>();

async function handle(m: Msg): Promise<void> {
  if (m.type === "prepare") {
    await pullSetup();
    const chat = m.chat as Chat | null;
    if (chat && typeof chat.id === "string") saveChat(chat);
    if (chat && m.work && typeof m.work === "object") saveWork(chat.id, m.work as WorkStore);
    // The connectors this chat's bots use: only those are fetched from the vault.
    const here = getChat(String(m.chatId));
    const bots = listBots().filter((b) => here?.memberIds.includes(b.id));
    const mcpIds = [...new Set(bots.flatMap((b) => b.tools.mcp ?? []))];
    return reply(m, { ok: !!here, mcpIds, ...(here ? {} : { error: "chat not found" }) });
  }
  if (m.type === "connectors") {
    let connectors = 0;
    for (const v of Array.isArray(m.vault) ? (m.vault as VaultConnector[]) : []) {
      if (!installVaultConnector(v)) continue;
      connectors++;
      signIns.set(v.id, JSON.stringify(vaultSignIn(v.id)));
    }
    return reply(m, { ok: true, connectors });
  }
  if (m.type === "run") {
    const chatId = String(m.chatId);
    if (!getChat(chatId)) return reply(m, { ok: false, error: "chat not found" });
    const input = runInputOf(String(m.kind), m.payload);
    if (typeof input === "string") return reply(m, { ok: false, error: input });
    let needs: string | null = null;
    const off = onNeedsComputer((id, tool) => {
      if (id !== chatId) return;
      needs = tool;
      stopRun(chatId); // teammates working at the same time stop too: the rest is done on the computer
    });
    if (!startRun(chatId, input as RunInput)) {
      off();
      return reply(m, { ok: false, error: "already running" });
    }
    const unsub = subscribe(chatId, (e) => {
      if (e.type === "entry" || e.type === "approval") send({ type: "step", chatId });
      else if (e.type === "error") send({ type: "run-error", chatId });
      else if (e.type === "done") {
        unsub?.();
        off();
        // The run's last save happens before "done": the chat on disk is final here.
        setTimeout(() => send({ type: "ended", chatId, needsComputer: needs }), 0);
      }
    });
    return reply(m, { ok: true });
  }
  if (m.type === "stop") {
    stopRun(String(m.chatId));
    return reply(m, { ok: true });
  }
  if (m.type === "chat") {
    const chatId = String(m.chatId);
    const chat = getChat(chatId);
    const work = loadWork(chatId);
    const hasWork = Object.keys(work.tables).length || Object.keys(work.notes).length;
    return reply(m, { ok: !!chat, chat, ...(hasWork ? { work } : {}) });
  }
  if (m.type === "finish") {
    const sync = await syncSetup();
    const changed: { id: string; oauth: unknown }[] = [];
    for (const [id, before] of signIns) {
      const now = vaultSignIn(id);
      if (now && JSON.stringify(now) !== before) changed.push({ id, oauth: now });
    }
    return reply(m, { ok: true, setup: sync.ok, signIns: changed });
  }
  reply(m, { ok: false, error: `unknown message ${m.type}` });
}

/** Called once at the server's start (instrumentation.ts) when OOVI_CLOUD_RUNNER=1. */
export function startCloudRunner(): void {
  if (g.__ooviCloudRunner || !process.send) return;
  g.__ooviCloudRunner = true;
  process.on("message", (raw) => {
    const m = raw as Msg;
    if (!m || typeof m.type !== "string") return;
    handle(m).catch((e) => reply(m, { ok: false, error: String((e as Error)?.message || e).slice(0, 300) }));
  });
  send({ type: "ready" });
}
