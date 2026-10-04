import type { SearchBackend, SearchResult } from "./types";
import { tidy } from "./types";

/**
 * DuckDuckGo's HTML-only endpoint. No key, no signup — the zero-config path
 * so search works the moment you clone the repo.
 *
 * This is an unofficial interface: it is scraping, so it can break when the
 * markup changes. That is why it sits last in the chain, behind the two
 * backends with real APIs.
 */
export const duckduckgo: SearchBackend = {
  id: "duckduckgo",
  label: "DuckDuckGo",
  setupHint: "No setup — works out of the box, but it is an unofficial scrape.",

  isConfigured() {
    return true;
  },

  async search(query, count, signal) {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Without a browser-ish UA this endpoint returns an empty page.
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      },
      body: new URLSearchParams({ q: query, kl: "wt-wt" }),
    });

    if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status}`);

    return parseDuckDuckGoHtml(await res.text(), count);
  },
};

/** Exported for testing against a captured fixture. */
export function parseDuckDuckGoHtml(html: string, count: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Each hit is an <a class="result__a" href="...">title</a> followed by a
  // snippet in .result__snippet.
  const linkPattern =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetPattern =
    /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  const snippets: string[] = [];
  let snippetMatch: RegExpExecArray | null;
  while ((snippetMatch = snippetPattern.exec(html))) {
    snippets.push(stripTags(snippetMatch[1]));
  }

  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = linkPattern.exec(html)) && results.length < count) {
    const url = decodeRedirect(match[1]);
    const title = stripTags(match[2]);
    if (url && title) {
      results.push({ title: tidy(title, 150), url, snippet: tidy(snippets[index] ?? "") });
    }
    index++;
  }

  return results;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** DDG wraps results in /l/?uddg=<encoded>. Unwrap to the real target. */
function decodeRedirect(href: string): string {
  const raw = href.startsWith("//") ? `https:${href}` : href;
  try {
    const url = new URL(raw, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : url.toString();
  } catch {
    return "";
  }
}
