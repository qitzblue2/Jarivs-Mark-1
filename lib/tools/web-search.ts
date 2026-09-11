import { search } from "./search/registry";
import type { Tool } from "./types";

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web for current information. Use this whenever a question " +
    "depends on recent events, prices, releases, documentation or anything " +
    "that may have changed since your training data. Returns titles, URLs and " +
    "snippets — call fetch_url afterwards to read a promising result in full.",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." },
      count: {
        type: "number",
        description: "How many results to return (1-10, default 5).",
      },
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
