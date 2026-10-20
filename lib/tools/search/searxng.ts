import type { SearchBackend, SearchResult } from "./types";
import { tidy } from "./types";

/**
 * SearXNG — a self-hostable metasearch front end. No API key at all.
 *
 * Caveat worth knowing: most PUBLIC instances disable `format=json`, so this
 * usually means pointing SEARXNG_URL at your own instance:
 *   docker run -d -p 8080:8080 searxng/searxng
 * and enabling the json format in its settings.yml.
 */
export const searxng: SearchBackend = {
  id: "searxng",
  label: "SearXNG",
  setupHint:
    "No key needed. Set SEARXNG_URL to an instance with the JSON API enabled " +
    "(self-host: docker run -d -p 8080:8080 searxng/searxng)",

  isConfigured() {
    return Boolean(process.env.SEARXNG_URL);
  },

  async search(query, count, signal) {
    const base = (process.env.SEARXNG_URL ?? "").replace(/\/+$/, "");
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&safesearch=1`;

    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });

    if (!res.ok) {
      throw new Error(
        res.status === 403
          ? "SearXNG refused the JSON API (403). Most public instances disable it — self-host, or enable json in settings.yml."
          : `SearXNG returned ${res.status}`,
      );
    }

    const json = await res.json();
    const rows: unknown[] = Array.isArray(json?.results) ? json.results : [];

    return rows
      .slice(0, count)
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
