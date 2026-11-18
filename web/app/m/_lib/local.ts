"use client";

// What the phone keeps in this browser (so the app opens at once and works offline): chats without tool results,
// the bots' names and faces, pins, what was read, messages on their way, and this phone's choices. Everything
// is removed on sign-out (clearLocal). Every read and write survives private mode and a full storage.
import type { ConnectorView } from "./connectors";
import type { Outgoing } from "./core";
import type { Chat, CloudStatus, Credits, Me, PhoneSetup } from "./types";

const P = "oovi.m.";

export function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(P + key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(P + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export type CachedChat = { version: number; chat: Chat };
export type ChatCache = { since: string | null; chats: Record<string, CachedChat> };

export const loadChats = (): ChatCache => read<ChatCache>("chats", { since: null, chats: {} });

/** Saves the chats; when the phone's storage is full, the oldest chats are left out until it fits. */
export function saveChats(c: ChatCache) {
  if (write("chats", c)) return;
  const ids = Object.keys(c.chats).sort((a, b) => (c.chats[a]!.chat.updatedAt ?? 0) - (c.chats[b]!.chat.updatedAt ?? 0));
  const kept = { ...c.chats };
  while (ids.length > 1) {
    delete kept[ids.shift()!];
    // since = null: the next refresh lists every chat again, so the ones left out come back from the server.
    if (write("chats", { since: null, chats: kept })) return;
  }
}

export type Prefs = { lang: "auto" | "en" | "fr" | "ar"; theme: "auto" | "light" | "dark" };
export const loadPrefs = (): Prefs => ({ lang: "auto", theme: "auto", ...read<Partial<Prefs>>("prefs", {}) });
export const savePrefs = (p: Prefs) => write("prefs", p);

export const loadSetup = () => read<{ at: number; setup: PhoneSetup } | null>("setup", null);
export const saveSetup = (setup: PhoneSetup) => write("setup", { at: Date.now(), setup });
export const loadStatus = () => read<CloudStatus | null>("status", null);
export const saveStatus = (s: CloudStatus) => write("status", s);
export const loadCredits = () => read<Credits | null>("credits", null);
export const saveCredits = (c: Credits) => write("credits", c);
export const loadMe = () => read<Me | null>("me", null);
export const saveMe = (m: Me) => write("me", m);
/** Connectors as the phone shows them (name, on/off, bots, signed in or not): never a key or a token. */
export const loadConnectors = () => read<{ at: number; views: Record<string, ConnectorView>; versions: Record<string, number> }>("connectors", { at: 0, views: {}, versions: {} });
export const saveConnectors = (c: { at: number; views: Record<string, ConnectorView>; versions: Record<string, number> }) => write("connectors", c);
export const loadPins = () => read<string[]>("pins", []);
export const savePins = (p: string[]) => write("pins", p);
export const loadSeen = () => read<Record<string, number> | null>("seen", null);
export const saveSeen = (s: Record<string, number>) => write("seen", s);
export const loadOutbox = () => read<Outgoing[]>("outbox", []);
export const saveOutbox = (o: Outgoing[]) => write("outbox", o.slice(-50));

/** Sign-out: everything this app kept on the phone, and the offline copies of its pages. */
export async function clearLocal() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(P) && k !== `${P}device` && k !== `${P}prefs`) localStorage.removeItem(k);
  } catch {
    /* nothing kept */
  }
  try {
    if ("caches" in window) for (const k of await caches.keys()) if (k.startsWith("oovi-m")) await caches.delete(k);
  } catch {
    /* no caches */
  }
}
