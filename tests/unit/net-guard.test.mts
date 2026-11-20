// Reading a page for a bot must never reach a private address: not by its name's DNS answer, and not by a
// redirect (lib/net-guard-core.ts). On oovi's cloud server those addresses are the server's own network.
import test from "node:test";
import assert from "node:assert/strict";
import { fetchGuarded, resolvesPrivate } from "../../lib/net-guard-core.ts";

const isPrivate = (h: string) => h === "localhost" || /^(10\.|127\.|169\.254\.|192\.168\.)/.test(h) || h === "::1";
const dns: Record<string, string[]> = { "public.example": ["93.184.216.34"], "rebind.example": ["93.184.216.34", "10.0.0.7"], "meta.example": ["169.254.169.254"] };
const lookup = async (h: string) => {
  if (!dns[h]) throw new Error("ENOTFOUND");
  return dns[h];
};

test("a name is private when any address it resolves to is", async () => {
  assert.equal(await resolvesPrivate("public.example", lookup, isPrivate), false);
  assert.equal(await resolvesPrivate("rebind.example", lookup, isPrivate), true);
  assert.equal(await resolvesPrivate("meta.example", lookup, isPrivate), true);
  assert.equal(await resolvesPrivate("10.1.2.3", lookup, isPrivate), true);
  // A name that doesn't resolve is not refused here: the download fails by itself.
  assert.equal(await resolvesPrivate("nowhere.example", lookup, isPrivate), false);
});

test("a public page that redirects to a private address is refused before that address is asked", async () => {
  const asked: string[] = [];
  const fetchFn = async (url: string) => {
    asked.push(url);
    if (url === "https://public.example/start") return new Response(null, { status: 302, headers: { location: "http://meta.example/latest/meta-data" } });
    return new Response("secret", { status: 200 });
  };
  await assert.rejects(() => fetchGuarded("https://public.example/start", {}, { allowPrivate: false, lookup, isPrivate, fetchFn }), /private/i);
  assert.deepEqual(asked, ["https://public.example/start"]);
});

test("a name that resolves to a private address is refused before anything is asked", async () => {
  const asked: string[] = [];
  const fetchFn = async (url: string) => (asked.push(url), new Response("x"));
  await assert.rejects(() => fetchGuarded("http://rebind.example/", {}, { allowPrivate: false, lookup, isPrivate, fetchFn }), /private/i);
  assert.deepEqual(asked, []);
});

test("ordinary redirects are followed, and the answer says where it ended", async () => {
  const fetchFn = async (url: string) =>
    url === "https://public.example/a" ? new Response(null, { status: 301, headers: { location: "/b" } }) : new Response(`body of ${url}`, { status: 200 });
  const r = await fetchGuarded("https://public.example/a", {}, { allowPrivate: false, lookup, isPrivate, fetchFn });
  assert.equal(r.url, "https://public.example/b");
  assert.equal(await r.res.text(), "body of https://public.example/b");
  // Too many redirects end the read instead of going round for ever.
  const loop = async (url: string) => new Response(null, { status: 302, headers: { location: url + "x" } });
  await assert.rejects(() => fetchGuarded("https://public.example/", {}, { allowPrivate: false, lookup, isPrivate, fetchFn: loop }), /redirect/i);
});

test("with the local network allowed (the user's own setting, never in the cloud) nothing is refused", async () => {
  const fetchFn = async () => new Response("ok");
  const r = await fetchGuarded("http://rebind.example/", {}, { allowPrivate: true, lookup, isPrivate, fetchFn });
  assert.equal(await r.res.text(), "ok");
});
