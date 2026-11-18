"use client";

// The phone app's shared state: language and look, the account, the cloud's status, the chats kept on this
// phone and their refresh, pins and unread marks, and the messages the phone sends (POST /api/v1/cloud/jobs).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiError, SIGNED_OUT_EVENT, getChat, getCredits, getMe, getSetup, getStatus, listChats, postJob } from "../_lib/api";
import { lastShownEntry, newId, pendingOutgoing, phoneSetup, pickLang, slimChat, togglePin as togglePinList, type Lang, type Outgoing } from "../_lib/core";
import { translate, type Key } from "../_lib/i18n";
import * as L from "../_lib/local";
import type { Chat, CloudStatus, Credits, JobPayload, Me, PhoneSetup, SetupBot } from "../_lib/types";

export type SyncState = "loading" | "on" | "off" | "unavailable" | "error";

type Ctx = {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: (key: Key, vars?: Record<string, string | number>) => string;
  prefs: L.Prefs;
  setPrefs: (p: L.Prefs) => void;
  online: boolean;
  me: Me | null;
  status: CloudStatus | null;
  sync: SyncState;
  setup: PhoneSetup | null;
  bot: (id: string) => SetupBot | undefined;
  chats: Record<string, L.CachedChat>;
  refreshing: boolean;
  refresh: (opts?: { setup?: boolean }) => Promise<void>;
  loadChat: (id: string) => Promise<"ok" | "missing" | "error">;
  putChat: (version: number, chat: Chat) => void;
  pins: string[];
  togglePin: (chat: Chat) => void;
  seen: Record<string, number>;
  markSeen: (chatId: string, at?: number) => void;
  markUnread: (chatId: string) => void;
  outbox: Outgoing[];
  send: (chatId: string, text: string) => Promise<boolean>;
  retry: (entryId: string) => Promise<boolean>;
  job: (chatId: string, job: JobPayload) => Promise<string | null>;
  credits: Credits | null;
  loadCredits: () => Promise<void>;
  signedOut: () => void;
};

const MobileCtx = createContext<Ctx | null>(null);

export function useM(): Ctx {
  const c = useContext(MobileCtx);
  if (!c) throw new Error("useM outside MobileApp");
  return c;
}

const SETUP_FRESH_MS = 3 * 60_000;
const LIST_EVERY_MS = 20_000;

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

export function MobileApp({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/m";
  const onLogin = pathname.startsWith("/m/login");
  const [ready, setReady] = useState(false);
  const [prefs, setPrefsState] = useState<L.Prefs>({ lang: "auto", theme: "auto" });
  const [navLangs, setNavLangs] = useState<readonly string[]>([]);
  const [online, setOnline] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [sync, setSync] = useState<SyncState>("loading");
  const [setup, setSetup] = useState<PhoneSetup | null>(null);
  const [chats, setChats] = useState<Record<string, L.CachedChat>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [pins, setPins] = useState<string[]>([]);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [credits, setCredits] = useState<Credits | null>(null);
  const cache = useRef<L.ChatCache>({ since: null, chats: {} });
  const setupAt = useRef(0);
  const busy = useRef(false);
  const seenBase = useRef<Record<string, number> | null>(null);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;

  const lang = pickLang(navLangs, prefs.lang === "auto" ? null : prefs.lang);
  const dir = lang === "ar" ? "rtl" : "ltr";
  const t = useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  // ---------- start: what this phone kept ----------
  useEffect(() => {
    setPrefsState(L.loadPrefs());
    setNavLangs(navigator.languages?.length ? navigator.languages : [navigator.language]);
    setOnline(navigator.onLine);
    cache.current = L.loadChats();
    setChats(cache.current.chats);
    const s = L.loadSetup();
    if (s) {
      setSetup(s.setup);
      setupAt.current = s.at;
    }
    setStatus(L.loadStatus());
    setMe(L.loadMe());
    setCredits(L.loadCredits());
    setPins(L.loadPins());
    const sn = L.loadSeen();
    seenBase.current = sn;
    setSeen(sn ?? {});
    setOutbox(L.loadOutbox());
    setReady(true);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Language, direction and look on the page itself (the website's root page says lang="en").
  useEffect(() => {
    if (!ready) return;
    const h = document.documentElement;
    h.lang = lang === "ar" ? "ar" : lang;
    h.dir = dir;
    h.dataset.mtheme = prefs.theme;
  }, [ready, lang, dir, prefs.theme]);

  const signedOut = useCallback(() => {
    void L.clearLocal();
    cache.current = { since: null, chats: {} };
    setChats({});
    setSetup(null);
    setStatus(null);
    setMe(null);
    setCredits(null);
    setOutbox([]);
    setPins([]);
    setSeen({});
    seenBase.current = null;
    if (!window.location.pathname.startsWith("/m/login")) {
      const next = window.location.pathname + window.location.search;
      router.replace(`/m/login?next=${encodeURIComponent(next)}`);
    }
  }, [router]);

  useEffect(() => {
    const h = () => signedOut();
    window.addEventListener(SIGNED_OUT_EVENT, h);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, h);
  }, [signedOut]);

  // ---------- chats ----------
  const commit = useCallback(() => {
    L.saveChats(cache.current);
    setChats({ ...cache.current.chats });
  }, []);

  const putChat = useCallback(
    (version: number, chat: Chat) => {
      const cur = cache.current.chats[chat.id];
      if (cur && cur.version > version) return;
      cache.current.chats[chat.id] = { version, chat: slimChat(chat) };
      commit();
    },
    [commit],
  );

  const loadChat = useCallback(
    async (id: string): Promise<"ok" | "missing" | "error"> => {
      try {
        const r = await getChat(id);
        if (r?.chat) putChat(r.version, { ...r.chat, id });
        return "ok";
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          if (cache.current.chats[id]) {
            delete cache.current.chats[id];
            commit();
          }
          return "missing";
        }
        return "error";
      }
    },
    [putChat, commit],
  );

  const refreshChats = useCallback(async () => {
    const c = cache.current;
    const full = !c.since;
    const r = await listChats(c.since ?? undefined);
    const listed = new Set<string>();
    const todo: string[] = [];
    for (const it of r.chats ?? []) {
      listed.add(it.chatId);
      if (it.deleted) delete c.chats[it.chatId];
      else if ((c.chats[it.chatId]?.version ?? -1) < it.version) todo.push(it.chatId);
    }
    if (full) for (const id of Object.keys(c.chats)) if (!listed.has(id)) delete c.chats[id];
    await pool(todo, 4, async (id) => {
      try {
        const one = await getChat(id);
        if (one?.chat) c.chats[id] = { version: one.version, chat: slimChat({ ...one.chat, id }) };
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) delete c.chats[id];
      }
    });
    c.since = typeof r.now === "string" ? r.now : null;
    commit();
    // First time on this phone: everything already there counts as read.
    if (!seenBase.current) {
      const base: Record<string, number> = {};
      for (const [id, { chat }] of Object.entries(c.chats)) base[id] = lastShownEntry(chat)?.at ?? chat.updatedAt;
      seenBase.current = base;
      setSeen(base);
      L.saveSeen(base);
    }
  }, [commit]);

  const refresh = useCallback(
    async (opts: { setup?: boolean } = {}) => {
      if (busy.current) return;
      busy.current = true;
      setRefreshing(true);
      try {
        if (!meRef.current) {
          const m = await getMe().catch(() => null);
          if (m) {
            setMe(m);
            L.saveMe(m);
          }
        }
        const setupJob =
          opts.setup || Date.now() - setupAt.current > SETUP_FRESH_MS
            ? getSetup()
                .then((r) => {
                  const s = phoneSetup(r?.items ?? null);
                  setSetup(s);
                  L.saveSetup(s);
                  setupAt.current = Date.now();
                })
                .catch(() => {})
            : Promise.resolve();
        try {
          const st = await getStatus();
          setStatus(st);
          L.saveStatus(st);
          setSync(st.enabled ? "on" : "off");
          if (st.enabled) await refreshChats();
        } catch (err) {
          if (err instanceof ApiError && (err.status === 404 || err.status === 501)) setSync("unavailable");
          else if (err instanceof ApiError && err.status === 401) return;
          else setSync((s) => (s === "loading" ? (Object.keys(cache.current.chats).length ? "on" : "error") : s === "on" ? "on" : "error"));
        }
        await setupJob;
      } finally {
        busy.current = false;
        setRefreshing(false);
      }
    },
    [refreshChats],
  );

  // Refresh when the app opens, comes back to the front, every 20 s while it is open, and when the connection is back.
  useEffect(() => {
    if (!ready || onLogin) return;
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void refresh();
    };
    const every = window.setInterval(tick, LIST_EVERY_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
    return () => {
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("online", tick);
    };
  }, [ready, onLogin, refresh]);

  // ---------- pins and unread ----------
  const togglePin = useCallback((chat: Chat) => {
    setPins((p) => {
      const next = togglePinList(p, chat);
      L.savePins(next);
      return next;
    });
  }, []);

  const markSeen = useCallback((chatId: string, at?: number) => {
    setSeen((s) => {
      const chat = cache.current.chats[chatId]?.chat;
      const when = at ?? (chat ? (lastShownEntry(chat)?.at ?? chat.updatedAt) : Date.now());
      if ((s[chatId] ?? 0) >= when) return s;
      const next = { ...s, [chatId]: when };
      seenBase.current = next;
      L.saveSeen(next);
      return next;
    });
  }, []);

  const markUnread = useCallback((chatId: string) => {
    setSeen((s) => {
      const next = { ...s, [chatId]: 0 };
      seenBase.current = next;
      L.saveSeen(next);
      return next;
    });
  }, []);

  // ---------- sending ----------
  const updateOutbox = useCallback((fn: (o: Outgoing[]) => Outgoing[]) => {
    setOutbox((o) => {
      const next = fn(o);
      L.saveOutbox(next);
      return next;
    });
  }, []);

  // Messages the chats now show are done; old ones the server never confirmed are kept a day as "failed".
  useEffect(() => {
    if (!ready) return;
    updateOutbox((o) => {
      const now = Date.now();
      const left = o.filter((x) => pendingOutgoing(chats[x.chatId]?.chat, [x]).length && now - x.at < 86_400_000);
      return left.length === o.length ? o : left;
    });
  }, [ready, chats, updateOutbox]);

  const job = useCallback(async (chatId: string, j: JobPayload): Promise<string | null> => {
    try {
      const r = await postJob(chatId, j);
      return r?.jobId ?? "";
    } catch {
      return null;
    }
  }, []);

  const deliver = useCallback(
    async (o: Outgoing) => {
      updateOutbox((list) => list.map((x) => (x.entryId === o.entryId ? { ...x, state: "sending" } : x)));
      const jobId = await job(o.chatId, { kind: "message", payload: { text: o.text, entryId: o.entryId } });
      updateOutbox((list) => list.map((x) => (x.entryId === o.entryId ? { ...x, state: jobId === null ? "failed" : "sent", ...(jobId ? { jobId } : {}) } : x)));
      return jobId !== null;
    },
    [job, updateOutbox],
  );

  const send = useCallback(
    async (chatId: string, text: string) => {
      const o: Outgoing = { entryId: newId(), chatId, text: text.slice(0, 20_000), at: Date.now(), state: "sending" };
      updateOutbox((list) => [...list, o]);
      return deliver(o);
    },
    [deliver, updateOutbox],
  );

  const retry = useCallback(
    async (entryId: string) => {
      const o = outbox.find((x) => x.entryId === entryId);
      return o ? deliver({ ...o, at: Date.now() }) : false;
    },
    [outbox, deliver],
  );

  const loadCreditsNow = useCallback(async () => {
    try {
      const c = await getCredits();
      setCredits(c);
      L.saveCredits(c);
    } catch {
      /* keep the saved numbers */
    }
  }, []);

  const setPrefs = useCallback((p: L.Prefs) => {
    setPrefsState(p);
    L.savePrefs(p);
  }, []);

  const bot = useCallback((id: string) => setup?.bots.find((b) => b.id === id), [setup]);

  const value = useMemo<Ctx>(
    () => ({ lang, dir, t, prefs, setPrefs, online, me, status, sync, setup, bot, chats, refreshing, refresh, loadChat, putChat, pins, togglePin, seen, markSeen, markUnread, outbox, send, retry, job, credits, loadCredits: loadCreditsNow, signedOut }),
    [lang, dir, t, prefs, setPrefs, online, me, status, sync, setup, bot, chats, refreshing, refresh, loadChat, putChat, pins, togglePin, seen, markSeen, markUnread, outbox, send, retry, job, credits, loadCreditsNow, signedOut],
  );

  return (
    <MobileCtx.Provider value={value}>
      <div className="mapp" dir={dir} lang={lang} data-ready={ready ? "1" : "0"}>
        {ready ? children : null}
      </div>
    </MobileCtx.Provider>
  );
}
