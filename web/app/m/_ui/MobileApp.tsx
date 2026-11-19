"use client";

// The phone app's shared state: language and look, the account, the cloud's status, the chats kept on this
// phone and their refresh, pins and unread marks, and the messages the phone sends (POST /api/v1/cloud/jobs).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiError, SIGNED_OUT_EVENT, addToSetup, changeSetup, deleteChat, removeFromSetup, finishSignIn, getChat, getCredits, getMe, getSetup, getStatus, getVault, listChats, listVault, postJob } from "../_lib/api";
import { finishProblem, pendingToHandle, viewOfVault, type ConnectorView, type PendingSignIn } from "../_lib/connectors";
import { useToast } from "./kit";
import { signInRecent } from "./signin";
import { dmId, setupWithoutBot, lastShownEntry, newBotItem, newGroupItem, newId, pendingOutgoing, phoneSetup, setupId, pickLang, slimChat, toggleArchive as toggleArchiveList, togglePin as togglePinList, type Lang, type Outgoing, type SendOptions } from "../_lib/core";
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
  /** After the person changed their name or photo in Settings. */
  updateMe: (m: Me) => void;
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
  /** Chats moved out of the list (kept under "Archived" on this phone). */
  archived: string[];
  toggleArchive: (chatId: string) => void;
  /** Deletes a chat on every device. */
  removeChat: (chatId: string) => Promise<boolean>;
  /** Adds a bot or a group to the account (the computer adds it at its next setup sync). Answers its id. */
  /** Changes the account's setup (a bot or group edited here); 409 → read again and apply again. */
  editSetup: (change: (items: Record<string, unknown>) => Record<string, unknown>) => Promise<boolean>;
  /** Deletes a bot as the computer does (it leaves its groups), and its direct chat everywhere. */
  removeBot: (botId: string) => Promise<boolean>;
  addBot: (input: { name: string; role: string; face: Record<string, unknown> }) => Promise<string | null>;
  addGroup: (input: { name: string; memberIds: string[] }) => Promise<string | null>;
  seen: Record<string, number>;
  markSeen: (chatId: string, at?: number) => void;
  markUnread: (chatId: string) => void;
  outbox: Outgoing[];
  send: (chatId: string, text: string, replyTo?: Outgoing["replyTo"], opts?: SendOptions) => Promise<boolean>;
  retry: (entryId: string) => Promise<boolean>;
  /** The job's id, or null when it couldn't be sent (lastJobError says why, in words for people). */
  job: (chatId: string, job: JobPayload) => Promise<string | null>;
  lastJobError: () => string;
  credits: Credits | null;
  loadCredits: () => Promise<void>;
  /** The account's connectors in the vault (no keys or tokens). */
  connectors: Record<string, ConnectorView>;
  refreshConnectors: () => Promise<void>;
  putConnector: (id: string, view: ConnectorView | null, version?: number) => void;
  /** A short message at the bottom of the screen. */
  toast: (msg: string) => void;
  signedOut: () => void;
};

const MobileCtx = createContext<Ctx | null>(null);

/** Screens opened inside the app since it started: Back goes back to the last one rather than to a fixed page. */
let screensVisited = 0;
export const canGoBack = () => screensVisited > 1;

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
  const [archived, setArchived] = useState<string[]>([]);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [connectors, setConnectors] = useState<Record<string, ConnectorView>>({});
  const vaultVersions = useRef<Record<string, number>>({});
  const vaultAt = useRef(0);
  const told = useRef(new Set<string>());
  const [toastNode, toast] = useToast();
  const cache = useRef<L.ChatCache>({ since: null, chats: {} });
  const setupAt = useRef(0);
  const busy = useRef(false);
  const seenBase = useRef<Record<string, number> | null>(null);
  const meChecked = useRef(false);

  const lang = pickLang(navLangs, prefs.lang === "auto" ? null : prefs.lang);
  const langRef = useRef(lang);
  langRef.current = lang;
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
    const st = L.loadStatus();
    setStatus(st);
    // Start from what this phone last knew, so screens don't flash "not synced" while the status loads.
    if (st) setSync(st.enabled ? "on" : "off");
    setMe(L.loadMe());
    setCredits(L.loadCredits());
    setPins(L.loadPins());
    setArchived(L.loadArchived());
    const sn = L.loadSeen();
    seenBase.current = sn;
    setSeen(sn ?? {});
    setOutbox(L.loadOutbox());
    const cn = L.loadConnectors();
    setConnectors(cn.views);
    vaultVersions.current = cn.versions;
    setReady(true);
    // A new account (the website's sign-up sends it here with ?welcome=1).
    if (new URLSearchParams(window.location.search).get("welcome") === "1") window.setTimeout(() => toast(translate(langRef.current, "acct.welcome")), 600);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    screensVisited++;
  }, [pathname]);

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
    setArchived([]);
    setSeen({});
    setConnectors({});
    vaultVersions.current = {};
    vaultAt.current = 0;
    seenBase.current = null;
    meChecked.current = false;
    setupAt.current = 0;
    const next = window.location.pathname + window.location.search;
    if (!window.location.pathname.startsWith("/m/login")) router.replace(`/m/login?next=${encodeURIComponent(next)}`);
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

  // ---------- connectors ----------
  const saveConn = useCallback((views: Record<string, ConnectorView>) => {
    L.saveConnectors({ at: Date.now(), views, versions: vaultVersions.current });
  }, []);

  const putConnector = useCallback(
    (id: string, view: ConnectorView | null, version?: number) => {
      setConnectors((cur) => {
        const next = { ...cur };
        if (view) next[id] = view;
        else delete next[id];
        if (version !== undefined) vaultVersions.current[id] = version;
        if (!view) delete vaultVersions.current[id];
        saveConn(next);
        return next;
      });
    },
    [saveConn],
  );

  /** Sign-ins this phone started that came back in another browser: finished here, or explained. */
  const handlePending = useCallback(
    async (pending: PendingSignIn[]) => {
      const { finish, confirm } = pendingToHandle(pending);
      for (const p of finish) {
        try {
          const r = await finishSignIn(p.flowId);
          putConnector(r.connectorId, viewOfVault(r.connectorId, r.data), r.version);
          toast(translate(langRef.current, "conn.connected", { name: viewOfVault(r.connectorId, r.data).name }));
        } catch (err) {
          if (err instanceof ApiError && err.status !== 404) toast(translate(langRef.current, finishProblem(err.status)));
        }
      }
      for (const p of confirm) {
        if (told.current.has(p.flowId)) continue;
        told.current.add(p.flowId);
        toast(translate(langRef.current, "conn.err.confirm"));
      }
    },
    [putConnector, toast],
  );

  const refreshConnectors = useCallback(async () => {
    const r = await listVault();
    vaultAt.current = Date.now();
    const listed = new Map((r?.items ?? []).map((i) => [i.connectorId, i.version]));
    const views: Record<string, ConnectorView> = {};
    const cur = L.loadConnectors().views;
    await pool([...listed.keys()], 4, async (id) => {
      if (cur[id] && vaultVersions.current[id] === listed.get(id)) {
        views[id] = cur[id]!;
        return;
      }
      try {
        const one = await getVault(id);
        views[id] = viewOfVault(id, one.data);
        vaultVersions.current[id] = one.version;
      } catch {
        if (cur[id]) views[id] = cur[id]!;
      }
    });
    for (const id of Object.keys(vaultVersions.current)) if (!listed.has(id)) delete vaultVersions.current[id];
    setConnectors(views);
    saveConn(views);
    if (r?.pending?.length) await handlePending(r.pending);
  }, [saveConn, handlePending]);

  const refresh = useCallback(
    async (opts: { setup?: boolean } = {}) => {
      if (busy.current) return;
      busy.current = true;
      setRefreshing(true);
      try {
        // Once per start: if another account signed in on this phone (the website's session changed), what was
        // kept for the previous one goes before anything new is shown or merged.
        if (!meChecked.current) {
          const m = await getMe().catch(() => undefined);
          if (m) {
            meChecked.current = true;
            const before = L.loadMe();
            if (before && before.id !== m.id) {
              await L.clearLocal();
              cache.current = { since: null, chats: {} };
              setChats({});
              setSetup(null);
              setupAt.current = 0;
              setStatus(null);
              setCredits(null);
              setOutbox([]);
              setPins([]);
              setSeen({});
              seenBase.current = null;
            }
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
          if (st.enabled && (opts.setup || Date.now() - vaultAt.current > 60_000)) await refreshConnectors().catch(() => {});
        } catch (err) {
          if (err instanceof ApiError && err.code === "sync_off") setSync("off");
          else if (err instanceof ApiError && (err.status === 404 || err.status === 501)) setSync("unavailable");
          else if (err instanceof ApiError && err.status === 401) return;
          else setSync((s) => (s === "loading" ? (Object.keys(cache.current.chats).length ? "on" : "error") : s === "on" ? "on" : "error"));
        }
        await setupJob;
      } finally {
        busy.current = false;
        setRefreshing(false);
      }
    },
    [refreshChats, refreshConnectors],
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

  // Back from a connector's sign-in page (maybe in another browser): finish or explain it at once.
  useEffect(() => {
    if (!ready || onLogin) return;
    const back = () => {
      if (document.visibilityState === "visible" && signInRecent()) void refreshConnectors().catch(() => {});
    };
    back();
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [ready, onLogin, refreshConnectors]);

  // ---------- pins and unread ----------
  const togglePin = useCallback((chat: Chat) => {
    setPins((p) => {
      const next = togglePinList(p, chat);
      L.savePins(next);
      return next;
    });
  }, []);

  const toggleArchive = useCallback((chatId: string) => {
    setArchived((a) => {
      const next = toggleArchiveList(a, chatId);
      L.saveArchived(next);
      return next;
    });
  }, []);

  const applySetupItems = useCallback((items: Record<string, unknown>) => {
    const s = phoneSetup(items);
    setSetup(s);
    L.saveSetup(s);
    setupAt.current = Date.now();
  }, []);

  // Deleting a chat removes it on every device. A group is also removed from the account's setup (on the computer,
  // deleting a group's chat removes the group); a bot stays, its chat starts again on the next message.
  const updateMe = useCallback((u: Me) => {
    setMe(u);
    L.saveMe(u);
  }, []);

  const removeChat = useCallback(
    async (chatId: string) => {
      try {
        await deleteChat(chatId);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) return false;
      }
      if (setup?.groups.some((g) => g.id === chatId)) {
        try {
          applySetupItems(await removeFromSetup([`group:${chatId}`]));
        } catch {
          /* the chat is gone; the group comes back at the next setup read and can be deleted again */
        }
      }
      delete cache.current.chats[chatId];
      commit();
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, setup],
  );

  const editSetup = useCallback(
    async (change: (items: Record<string, unknown>) => Record<string, unknown>) => {
      try {
        applySetupItems(await changeSetup(change));
        return true;
      } catch {
        return false;
      }
    },
    [applySetupItems],
  );

  const removeBot = useCallback(
    async (botId: string) => {
      try {
        applySetupItems(await changeSetup((items) => setupWithoutBot(items, botId)));
      } catch {
        return false;
      }
      try {
        await deleteChat(dmId(botId));
      } catch {
        /* never synced, or already gone */
      }
      delete cache.current.chats[dmId(botId)];
      commit();
      return true;
    },
    [applySetupItems, commit],
  );

  const addBot = useCallback(
    async (input: { name: string; role: string; face: Record<string, unknown> }) => {
      const id = setupId();
      try {
        applySetupItems(await addToSetup({ [`bot:${id}`]: newBotItem(input, Date.now()) }));
        return id;
      } catch {
        return null;
      }
    },
    [applySetupItems],
  );

  const addGroup = useCallback(
    async (input: { name: string; memberIds: string[] }) => {
      const item = newGroupItem(input, Date.now());
      if (!item) return null;
      const id = setupId();
      try {
        applySetupItems(await addToSetup({ [`group:${id}`]: item }));
        return id;
      } catch {
        return null;
      }
    },
    [applySetupItems],
  );

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

  const jobError = useRef<Key>("chat.sendFailed");
  const job = useCallback(async (chatId: string, j: JobPayload): Promise<string | null> => {
    try {
      const r = await postJob(chatId, j);
      return r?.jobId ?? "";
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      jobError.current = code === "busy" ? "chat.busy" : code === "sync_off" ? "chat.syncOff" : code === "too_big" ? "chat.tooBig" : "chat.sendFailed";
      if (code === "sync_off") setSync("off");
      return null;
    }
  }, []);

  const deliver = useCallback(
    async (o: Outgoing) => {
      updateOutbox((list) => list.map((x) => (x.entryId === o.entryId ? { ...x, state: "sending" } : x)));
      const jobId = await job(o.chatId, { kind: "message", payload: { text: o.text, entryId: o.entryId, ...(o.replyTo ? { replyTo: o.replyTo.id } : {}), ...(o.opts?.effort && o.opts.effort !== "auto" ? { effort: o.opts.effort } : {}), ...(o.opts?.plan ? { plan: true } : {}), ...(o.opts?.deep ? { deep: true } : {}) } });
      updateOutbox((list) => list.map((x) => (x.entryId === o.entryId ? { ...x, state: jobId === null ? "failed" : "sent", ...(jobId ? { jobId } : {}) } : x)));
      return jobId !== null;
    },
    [job, updateOutbox],
  );

  const send = useCallback(
    async (chatId: string, text: string, replyTo?: Outgoing["replyTo"], opts?: SendOptions) => {
      const o: Outgoing = { entryId: newId(), chatId, text: text.slice(0, 20_000), at: Date.now(), state: "sending", ...(replyTo ? { replyTo } : {}), ...(opts && (opts.plan || opts.deep || (opts.effort && opts.effort !== "auto")) ? { opts } : {}) };
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
    () => ({ lang, dir, t, prefs, setPrefs, online, me, updateMe, status, sync, setup, bot, chats, refreshing, refresh, loadChat, putChat, pins, togglePin, archived, toggleArchive, removeChat, editSetup, removeBot, addBot, addGroup, seen, markSeen, markUnread, outbox, send, retry, job, lastJobError: () => t(jobError.current), credits, loadCredits: loadCreditsNow, signedOut, connectors, refreshConnectors, putConnector, toast }),
    [lang, dir, t, prefs, setPrefs, online, me, updateMe, status, sync, setup, bot, chats, refreshing, refresh, loadChat, putChat, pins, togglePin, archived, toggleArchive, removeChat, editSetup, removeBot, addBot, addGroup, seen, markSeen, markUnread, outbox, send, retry, job, credits, loadCreditsNow, signedOut, connectors, refreshConnectors, putConnector, toast],
  );

  return (
    <MobileCtx.Provider value={value}>
      <div className="mapp" dir={dir} lang={lang} data-ready={ready ? "1" : "0"}>
        {ready ? children : null}
        {toastNode}
      </div>
    </MobileCtx.Provider>
  );
}
