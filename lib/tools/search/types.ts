export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchBackend {
  id: string;
  label: string;
  /** Where to get access, shown when the backend isn't configured. */
  setupHint: string;
  /** True when this backend has what it needs to run right now. */
  isConfigured(): boolean;
  search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]>;
}

/** Collapse whitespace and clip, so snippets stay cheap in context. */
export function tidy(text: string, max = 300): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
