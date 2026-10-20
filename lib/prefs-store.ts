"use client";

import { useSyncExternalStore } from "react";
import { applyPrefs, cleanPrefs, DEFAULT_PREFS, PREFS_KEY, type Prefs } from "@/lib/prefs";

/**
 * The live preferences for this tab: one value shared by everything that reads
 * or changes it, kept in step with localStorage and with other tabs.
 */

let current: Prefs = DEFAULT_PREFS;
let started = false;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(): Prefs {
  try {
    return cleanPrefs(JSON.parse(storage()?.getItem(PREFS_KEY) ?? "null"));
  } catch {
    return DEFAULT_PREFS;
  }
}

function emit(): void {
  for (const l of listeners) l();
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  current = read();
  applyPrefs(document.documentElement, current);
  window.addEventListener("storage", (e) => {
    if (e.key !== PREFS_KEY) return;
    current = read();
    applyPrefs(document.documentElement, current);
    emit();
  });
}

export function getPrefs(): Prefs {
  start();
  return current;
}

export function setPrefs(patch: Partial<Prefs>): void {
  start();
  current = cleanPrefs({ ...current, ...patch });
  applyPrefs(document.documentElement, current);
  try {
    storage()?.setItem(PREFS_KEY, JSON.stringify(current));
  } catch {
    /* a full quota costs only the memory of the choice */
  }
  emit();
}

export function resetPrefs(): void {
  start();
  current = DEFAULT_PREFS;
  applyPrefs(document.documentElement, current);
  try {
    storage()?.removeItem(PREFS_KEY);
  } catch {
    /* nothing to remove */
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs, () => DEFAULT_PREFS);
}
