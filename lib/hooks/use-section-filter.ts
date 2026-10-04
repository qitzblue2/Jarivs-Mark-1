"use client";

import { useEffect, useState, type RefObject } from "react";

/** Whether `text` contains every word of `query`, in any order, ignoring case. An empty query matches everything. */
export function matchesAllWords(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = text.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * Show only the sections of a long form that mention what was typed. Works on
 * the container's direct children — each section is one — by toggling their
 * `hidden` attribute, so the form's own state (what is typed in a field in a
 * hidden section) is untouched. A child marked `data-filter-keep` (the search
 * box itself) is never hidden. Returns how many sections are showing.
 */
export function useSectionFilter(ref: RefObject<HTMLElement | null>, query: string, ready: unknown): number | null {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let count = 0;
    for (const el of root.children) {
      if (!(el instanceof HTMLElement) || el.hasAttribute("data-filter-keep")) continue;
      const match = matchesAllWords(el.textContent ?? "", query);
      el.hidden = !match;
      if (match) count++;
    }
    setShown(query.trim() ? count : null);
  }, [ref, query, ready]);
  return shown;
}
