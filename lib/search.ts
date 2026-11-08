// Web search through a real search API instead of scraping search engines
// (DuckDuckGo shows automated browsers a CAPTCHA and Bing serves them junk).
// - searxng: free, open-source meta-search you run yourself (see docker-compose.yml)
// - brave:   Brave Search API, your own key
// - tavily:  Tavily search API (built for agents), your own key

import type { SearchConfig } from "./settings";

export type SearchHit = { title: string; url: string; snippet: string };

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

export async function webSearch(cfg: SearchConfig, query: string): Promise<SearchHit[]> {
  switch (cfg.provider) {
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
