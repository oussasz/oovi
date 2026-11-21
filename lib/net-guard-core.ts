// Downloading a page for a bot without ever reaching a private address. The address a bot gives was checked by
// its text only: a public name whose DNS answer is a private address passed, and a redirect was followed to its
// end before the last address was looked at (so the private address had already been asked). On oovi's cloud
// server those addresses are the server's own network; on a computer they are the user's home or office network.
// Pure (the lookup and the fetch are given): tests/unit/net-guard.test.mts.

export type GuardDeps = {
  /** The user's own "allow local network" setting (never on in the cloud). */
  allowPrivate: boolean;
  /** Every address a name resolves to. */
  lookup: (host: string) => Promise<string[]>;
  /** A host name or address of a private network (lib/browser.ts isPrivateHost). */
  isPrivate: (host: string) => boolean;
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
  maxRedirects?: number;
};

const bare = (host: string) => host.replace(/^\[|\]$/g, "");

/** True when the host is private by its text, or any address its name resolves to is. A name that doesn't resolve: false. */
export async function resolvesPrivate(host: string, lookup: GuardDeps["lookup"], isPrivate: GuardDeps["isPrivate"]): Promise<boolean> {
  const h = bare(host);
  if (isPrivate(h)) return true;
  // Already an address: nothing to resolve.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return false;
  let addrs: string[] = [];
  try {
    addrs = await lookup(h);
  } catch {
    return false;
  }
  return addrs.some((a) => isPrivate(bare(a)));
}

const refused = (host: string) => new Error(`Blocked: ${host} is a local/private address.`);

/**
 * fetch that follows redirects itself, one hop at a time: each address is checked (text and DNS) before it is
 * asked. Returns the last answer and the address it came from.
 */
export async function fetchGuarded(url: string, init: RequestInit, d: GuardDeps): Promise<{ res: Response; url: string }> {
  let at = url;
  const max = d.maxRedirects ?? 5;
  for (let hop = 0; hop <= max; hop++) {
    const u = new URL(at);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`Only http(s) URLs are allowed (got ${u.protocol}).`);
    if (!d.allowPrivate && (await resolvesPrivate(u.hostname, d.lookup, d.isPrivate))) throw refused(u.hostname);
    const res = await d.fetchFn(at, { ...init, redirect: "manual" });
    const to = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!to) return { res, url: at };
    try {
      await res.body?.cancel();
    } catch {
      /* nothing to drop */
    }
    at = new URL(to, at).href;
  }
  throw new Error("Too many redirects.");
}

/** A host name or address of a private network (localhost, LAN, link-local, carrier-grade NAT, IPv6 local). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/.test(h)) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) return h === "::1" || h === "::" || /^(fc|fd|fe8|fe9|fea|feb)/.test(h) || h.startsWith("::ffff:");
  return false;
}
