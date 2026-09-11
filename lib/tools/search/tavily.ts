import type { SearchBackend, SearchResult } from "./types";
import { tidy } from "./types";

/**
 * Tavily — built for agents, so results come back as extracted content
 * rather than raw links. 1,000 searches/month free, no credit card.
 */
export const tavily: SearchBackend = {
  id: "tavily",
  label: "Tavily",
  setupHint: "Free key (no card) at https://app.tavily.com — set TAVILY_API_KEY",

  isConfigured() {
    return Boolean(process.env.TAVILY_API_KEY);
  },

  async search(query, count, signal) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      },
      signal,
      body: JSON.stringify({
        query,
        max_results: count,
        search_depth: "basic",
      }),
    });

    if (!res.ok) {
      throw new Error(`Tavily returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    const json = await res.json();
    const rows: unknown[] = Array.isArray(json?.results) ? json.results : [];

    return rows
      .map((row) => {
        const r = row as { title?: string; url?: string; content?: string };
        return {
          title: tidy(r.title ?? "", 150),
          url: r.url ?? "",
          snippet: tidy(r.content ?? ""),
        };
      })
      .filter((r): r is SearchResult => Boolean(r.url));
  },
};
