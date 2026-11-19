// oovi phone app: offline worker (scope /m). Pages of the app are kept so it opens without a connection;
// the website's code files are kept by their (unchanging) names. Nothing from /api is ever stored here:
// chats and account data travel only through signed-in requests, and the app keeps its own copy.
const SHELL = "oovi-m-shell-v1";
const STATIC = "oovi-m-static-v1";
const KEEP = [SHELL, STATIC];
const PRECACHE = ["/m", "/m/offline", "/m/bots", "/m/settings", "/m/login", "/m/manifest.webmanifest", "/m/icon-192.png"];
const MAX_PAGES = 60;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) =>
      Promise.all(
        PRECACHE.map((u) =>
          fetch(u, { credentials: "same-origin", redirect: "manual" })
            .then((r) => (r.ok && r.type === "basic" ? c.put(u, r) : null))
            .catch(() => null),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("oovi-m") && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_PAGES; i++) await cache.delete(keys[i]);
}

async function page(request) {
  const url = new URL(request.url);
  const key = url.origin + url.pathname;
  try {
    const res = await fetch(request);
    // Only real pages of the app (not a redirect to sign-in, not an error) are kept.
    if (res.ok && !res.redirected && res.type === "basic" && url.pathname.startsWith("/m")) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(key, copy).then(() => trim(c)));
    }
    return res;
  } catch {
    const c = await caches.open(SHELL);
    return (await c.match(key)) || (await c.match(url.origin + "/m/offline")) || Response.error();
  }
}

async function staticFile(request) {
  const c = await caches.open(STATIC);
  const hit = await c.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") c.put(request, res.clone());
  return res;
}

async function asset(request) {
  const c = await caches.open(SHELL);
  const hit = await c.match(request);
  const net = fetch(request)
    .then((res) => {
      if (res.ok && res.type === "basic") c.put(request, res.clone());
      return res;
    })
    .catch(() => hit || Response.error());
  return hit || net;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate" && (url.pathname === "/m" || url.pathname.startsWith("/m/"))) {
    event.respondWith(page(req));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFile(req));
    return;
  }
  if (url.pathname.startsWith("/m/") && /\.(png|webmanifest)$/.test(url.pathname)) {
    event.respondWith(asset(req));
  }
});
