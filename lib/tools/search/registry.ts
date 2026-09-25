import { duckduckgo } from "./duckduckgo";
import { searxng } from "./searxng";
import { tavily } from "./tavily";
import type { SearchBackend, SearchResult } from "./types";

/**
 * Backends in preference order. Quality first, keyless last — so search works
 * with no configuration at all, and gets better if you add a key.
 */
const BACKENDS: SearchBackend[] = [tavily, searxng, duckduckgo];

export function searchBackends(): SearchBackend[] {
  return BACKENDS;
}

export function configuredBackends(): SearchBackend[] {
  const preferred = process.env.JARVIS_SEARCH_BACKEND;
  const available = BACKENDS.filter((b) => b.isConfigured());

  if (preferred) {
    const first = available.find((b) => b.id === preferred);
    if (first) return [first, ...available.filter((b) => b.id !== preferred)];
  }
  return available;
}

export interface SearchOutcome {
  backend: string;
  results: SearchResult[];
}

/**
 * Search, falling through to the next backend on failure — the same
 * roll-over behaviour the model providers already use.
 */
export async function search(
  query: string,
  count: number,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const backends = configuredBackends();
  if (backends.length === 0) throw new Error("No search backend is configured.");

  const failures: string[] = [];

  for (const backend of backends) {
    try {
      const results = await backend.search(query, count, signal);
      if (results.length > 0) return { backend: backend.id, results };
      failures.push(`${backend.label}: no results`);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      failures.push(`${backend.label}: ${(err as Error).message}`);
    }
  }

  throw new Error(`Every search backend failed — ${failures.join("; ")}`);
}
