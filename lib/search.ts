// Web search through a real search API instead of scraping search engines
// (DuckDuckGo shows automated browsers a CAPTCHA and Bing serves them junk).
// - searxng: free, open-source meta-search you run yourself (see docker-compose.yml)
// - brave:   Brave Search API, your own key
// - tavily:  Tavily search API (built for agents), your own key

// - auto:    the AI provider's own built-in web search (Claude's web search tool,
//            or Gemini's Google Search grounding), so search works with no setup.

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
    const model = s.providers.gemini?.model?.includes("flash") ? s.providers.gemini.model : "gemini-2.5-flash";
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
  throw new Error("Web search needs a Claude or Gemini key (Settings → AI models), or a search service in Settings → Web search.");
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

export async function webSearch(s: Settings, query: string): Promise<SearchHit[]> {
  const cfg = s.search;
  switch (cfg.provider) {
    case "auto":
      return aiSearch(s, query);
    case "searxng": {
      const j = (await getJson("SearXNG", `${cfg.searxngUrl}/search?q=${encodeURIComponent(query)}&format=json`, { headers: { accept: "application/json" } })) as {
        results?: { title?: string; url?: string; content?: string }[];
      };
      return (j.results ?? []).slice(0, 10).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "" }));
    }
    case "brave": {
      if (!cfg.braveKey) throw new Error("Add your Brave Search API key in Settings → Web search.");
      const j = (await getJson("Brave Search", `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
        headers: { accept: "application/json", "x-subscription-token": cfg.braveKey },
      })) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
      return (j.web?.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: (r.description ?? "").replace(/<[^>]+>/g, "") }));
    }
    case "tavily": {
      if (!cfg.tavilyKey) throw new Error("Add your Tavily API key in Settings → Web search.");
      const j = (await getJson("Tavily", "https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.tavilyKey}` },
        body: JSON.stringify({ query, max_results: 8 }),
      })) as { results?: { title?: string; url?: string; content?: string }[] };
      return (j.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "" }));
    }
    default:
      throw new Error(
        "Web search isn't set up. Ask the user to pick a search provider in Settings → Web search (SearXNG is free and self-hosted; Brave and Tavily have free tiers). Meanwhile, use open_url on sites you already know (e.g. https://en.wikipedia.org/wiki/Special:Search?search=...).",
      );
  }
}
