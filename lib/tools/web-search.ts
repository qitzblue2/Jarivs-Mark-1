import { search } from "./search/registry";
import type { Tool } from "./types";

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web. Use it whenever the answer depends on recent events, " +
    "prices, releases or docs. Returns titles, URLs and snippets; call " +
    "fetch_url to read one properly.",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      count: { type: "number", description: "1-10, default 5." },
    },
    required: ["query"],
  },

  async handler(args, ctx) {
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("No search query given.");

    const requested = Number(args.count ?? 5);
    const count = Math.min(10, Math.max(1, Number.isFinite(requested) ? requested : 5));

    const { backend, results } = await search(query, count, ctx.signal);

    if (results.length === 0) return `No results for "${query}".`;

    const body = results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join("\n\n");

    return `Search results for "${query}" (via ${backend}):\n\n${body}`;
  },
};
