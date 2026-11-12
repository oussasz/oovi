// Web search through a real search API instead of scraping search engines
// (DuckDuckGo shows automated browsers a CAPTCHA and Bing serves them junk).
// - searxng: free, open-source meta-search you run yourself (see docker-compose.yml)
// - brave:   Brave Search API, your own key
// - tavily:  Tavily search API (built for agents), your own key

// - auto:    the AI provider's own built-in web search (Claude's web search tool,
//            or Gemini's Google Search grounding), so search works with no setup.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Settings } from "./settings";

export type SearchHit = { title: string; url: string; snippet: string };

const PROMPT = (q: string) =>
  `Search the web for: ${q}\n\nReturn the 8 most relevant, current results, one per line, exactly in this format:\nTITLE | URL | one-sentence summary\nNo other text.`;

function parseLines(text: string): SearchHit[] {
  const out: SearchHit[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.replace(/^\s*[-*\d.)]+\s*/, "").match(/^(.+?)\s*\|\s*(https?:\/\/\S+?)\s*\|\s*(.+)$/);
    if (m?.[1] && m[2]) out.push({ title: m[1].trim(), url: m[2].trim(), snippet: (m[3] ?? "").trim() });
  }
  return out;
}

/** Search with the AI provider's built-in web search (cheap model, few tokens). */
async function aiSearch(s: Settings, query: string): Promise<SearchHit[]> {
  const claudeKey = s.providers.anthropic?.apiKey;
  if (claudeKey) {
    const base = (s.providers.anthropic?.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
    const j = (await getJson("Claude web search", `${base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 1200,
        messages: [{ role: "user", content: PROMPT(query) }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
      }),
    })) as { content?: { type: string; text?: string; content?: { type?: string; title?: string; url?: string }[] }[] };
    const blocks = j.content ?? [];
    const listed = parseLines(blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n"));
    if (listed.length) return listed.slice(0, 10);
    const raw = blocks.flatMap((b) => (b.type === "web_search_tool_result" && Array.isArray(b.content) ? b.content : []));
    return raw.filter((r) => r.url).slice(0, 10).map((r) => ({ title: r.title ?? r.url ?? "", url: r.url ?? "", snippet: "" }));
  }
  const geminiKey = s.providers.gemini?.apiKey;
  if (geminiKey) {
    const model = s.providers.gemini?.model?.includes("flash") ? s.providers.gemini.model : "gemini-flash-latest";
    const j = (await getJson("Gemini web search", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: PROMPT(query) }] }], tools: [{ google_search: {} }] }),
    })) as { candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[] };
    const c = j.candidates?.[0];
    const listed = parseLines((c?.content?.parts ?? []).map((p) => p.text ?? "").join("\n"));
    if (listed.length) return listed.slice(0, 10);
    return (c?.groundingMetadata?.groundingChunks ?? []).filter((g) => g.web?.uri).slice(0, 10).map((g) => ({ title: g.web?.title ?? "", url: g.web?.uri ?? "", snippet: "" }));
  }
  // No Claude or Gemini key: Exa's free public search (no key, no sign-up).
  return exaSearch(query);
}

// ---------- Exa (free, public MCP endpoint: search + page reader) ----------

const EXA_URL = "https://mcp.exa.ai/mcp";
const gx = globalThis as typeof globalThis & { __ooviExa?: Promise<Client> | null };

async function exaClient(): Promise<Client> {
  if (!gx.__ooviExa) {
    gx.__ooviExa = (async () => {
      const c = new Client({ name: "oovi", version: "1.0.0" });
      await c.connect(new StreamableHTTPClientTransport(new URL(EXA_URL)));
      return c;
    })();
    gx.__ooviExa.catch(() => (gx.__ooviExa = null));
  }
  return gx.__ooviExa;
}

async function exaCall(tool: string, args: Record<string, unknown>): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = await exaClient();
      const r = (await c.callTool({ name: tool, arguments: args }, undefined, { timeout: 30_000 })) as { content?: { type: string; text?: string }[]; isError?: boolean };
      const text = (r.content ?? []).map((x) => x.text ?? "").join("\n");
      if (r.isError) throw new Error(text.slice(0, 300) || "Exa search failed");
      return text;
    } catch (e) {
      gx.__ooviExa = null; // reconnect once (session expired)
      if (attempt === 1) throw new Error(`Exa search isn't answering: ${(e as Error).message}`);
    }
  }
  return "";
}

/** Exa's text format: blocks of "Title: … / URL: … / Published: … / Highlights: …". */
function parseExa(text: string): { title: string; url: string; published?: string; body: string }[] {
  return text
    .split(/\n(?=Title: )/)
    .map((b) => {
      const url = b.match(/^URL: (\S+)/m)?.[1] ?? "";
      return {
        title: b.match(/^Title: (.*)$/m)?.[1]?.trim() ?? url,
        url,
        published: b.match(/^Published: (\S+)/m)?.[1],
        body: b.replace(/^(Title|URL|Published|Author|ID):.*$/gm, "").replace(/^(Highlights|Text|Summary):\s*/m, "").trim(),
      };
    })
    .filter((x) => /^https?:/.test(x.url));
}

export async function exaSearch(query: string): Promise<SearchHit[]> {
  return parseExa(await exaCall("web_search_exa", { query, numResults: 8 })).map((r) => ({ title: r.title, url: r.url, snippet: r.body.replace(/\s+/g, " ").slice(0, 400) }));
}

/** Read one page through Exa (handles JavaScript-heavy pages and PDFs). */
export async function exaFetch(url: string): Promise<{ url: string; title: string; text: string; published?: string } | null> {
  const r = parseExa(await exaCall("web_fetch_exa", { urls: [url], maxCharacters: 40_000 }))[0];
  return r ? { url: r.url, title: r.title, text: r.body, published: r.published } : null;
}

const TIMEOUT = 20_000;

async function getJson(label: string, url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    throw new Error(`Could not reach ${label} (${new URL(url).origin}): ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`${label} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** One search with the provider the user chose. */
async function withProvider(s: Settings, provider: string, query: string): Promise<SearchHit[]> {
  const cfg = s.search;
  switch (provider) {
    case "searxng": {
      const j = (await getJson("SearXNG", `${cfg.searxngUrl}/search?q=${encodeURIComponent(query)}&format=json`, { headers: { accept: "application/json" } })) as {
        results?: { title?: string; url?: string; content?: string }[];
      };
      return (j.results ?? []).slice(0, 10).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "" }));
    }
    case "brave": {
      if (!cfg.braveKey) throw new Error("no Brave API key is saved");
      const j = (await getJson("Brave Search", `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
        headers: { accept: "application/json", "x-subscription-token": cfg.braveKey },
      })) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
      return (j.web?.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.description ?? "" }));
    }
    case "tavily": {
      if (!cfg.tavilyKey) throw new Error("no Tavily API key is saved");
      const j = (await getJson("Tavily", "https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.tavilyKey}` },
        body: JSON.stringify({ query, max_results: 8 }),
      })) as { results?: { title?: string; url?: string; content?: string }[] };
      return (j.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "" }));
    }
    default:
      return aiSearch(s, query);
  }
}

const PROVIDER_NAME: Record<string, string> = { searxng: "SearXNG", brave: "Brave Search", tavily: "Tavily" };

/**
 * Web search that works with no setup. The provider the user chose is tried first; when it isn't
 * set, fails or finds nothing, the built-in search answers (the AI provider's own search with an own
 * key, else Exa's free public search). Search is never "off": a bot with Web search always gets
 * results, and is never sent to ask the user to set anything up.
 * note: for the bot, when the chosen provider didn't answer (so it doesn't blame the user's setup).
 */
export async function searchWithNote(s: Settings, query: string): Promise<{ hits: SearchHit[]; note: string }> {
  const chosen = s.search.provider;
  const errors: string[] = [];
  if (chosen === "searxng" || chosen === "brave" || chosen === "tavily") {
    try {
      const hits = await withProvider(s, chosen, query);
      if (hits.length) return { hits, note: "" };
    } catch (e) {
      errors.push(`${PROVIDER_NAME[chosen]}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  try {
    const hits = await aiSearch(s, query);
    if (hits.length) return { hits, note: errors.length ? `(The search service chosen in Settings didn't answer: ${errors[0]}. oovi's built-in search answered instead: nothing for the user to do.)` : "" };
  } catch (e) {
    errors.push((e as Error).message.slice(0, 200));
  }
  // An own Claude or Gemini key whose search failed: Exa's free search still answers.
  if (s.providers.anthropic?.apiKey || s.providers.gemini?.apiKey) {
    try {
      const hits = await exaSearch(query);
      if (hits.length) return { hits, note: "" };
    } catch (e) {
      errors.push((e as Error).message.slice(0, 200));
    }
  }
  if (errors.length) throw new Error(`Search didn't answer right now (${errors.join("; ")}). It is usually a passing network problem: try again in a moment, or read pages you know with read_url meanwhile. Don't ask the user to change any setting.`);
  return { hits: [], note: "" };
}

export async function webSearch(s: Settings, query: string): Promise<SearchHit[]> {
  return (await searchWithNote(s, query)).hits;
}
