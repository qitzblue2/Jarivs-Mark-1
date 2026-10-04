"use client";

import { useSyncExternalStore } from "react";
import {
  applyAppearance,
  cleanAppearance,
  DEFAULT_APPEARANCE,
  loadAppearance,
  saveAppearance,
  THEME_COLOR,
  APPEARANCE_KEY,
  type Appearance,
} from "@/lib/appearance";

/**
 * The live appearance for this tab: one value, shared by everything that
 * shows or changes it, kept in step with localStorage, with other tabs, and
 * with the operating system's light/dark setting while the theme is "system".
 */

let current: Appearance = DEFAULT_APPEARANCE;
let started = false;
const listeners = new Set<() => void>();

const lightQuery = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null);

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function paint(): void {
  applyAppearance(document.documentElement, current, lightQuery()?.matches ?? false);
  const resolved = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[resolved]);
}

function emit(): void {
  for (const l of listeners) l();
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const store = storage();
  if (store) current = loadAppearance(store);
  paint();
  lightQuery()?.addEventListener("change", () => {
    if (current.theme === "system") paint();
  });
  window.addEventListener("storage", (e) => {
    if (e.key !== APPEARANCE_KEY) return;
    const s = storage();
    if (!s) return;
    current = loadAppearance(s);
    paint();
    emit();
  });
}

export function getAppearance(): Appearance {
  start();
  return current;
}

/**
 * Change some of it. `persist: false` is for a drag in progress — repainting
 * on every pointer move is cheap, writing to disk on every one is not.
 */
export function setAppearance(patch: Partial<Appearance>, options: { persist?: boolean } = {}): void {
  start();
  current = cleanAppearance({ ...current, ...patch });
  paint();
  if (options.persist !== false) {
    const store = storage();
    if (store) saveAppearance(store, current);
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, getAppearance, () => DEFAULT_APPEARANCE);
}
