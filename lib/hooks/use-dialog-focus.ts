"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * What a keyboard or screen-reader user needs from a modal, which Escape alone
 * doesn't give them:
 *
 *   - focus moves into it when it opens (unless something inside already took
 *     it with `autoFocus`),
 *   - Tab and Shift+Tab stay inside it instead of walking off into the page
 *     behind, and
 *   - when it closes, focus goes back to whatever opened it.
 *
 * Attach the returned ref to the dialog's outermost element. Call it before any
 * early `return null`, passing whether the dialog is showing.
 */
export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const opener = document.activeElement as HTMLElement | null;

    if (!root.contains(document.activeElement)) {
      // The first real control, not the close button if there is a better one.
      const items = focusables(root);
      const target = items.find((el) => el.matches("input,textarea,select")) ?? items[0];
      if (target) target.focus();
      else {
        root.tabIndex = -1;
        root.focus();
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !root) return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !root.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !root.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    }
    root.addEventListener("keydown", onKeyDown);

    return () => {
      root.removeEventListener("keydown", onKeyDown);
      // Only if it is still there and focus hasn't already been given somewhere deliberately.
      if (opener && document.contains(opener) && (document.activeElement === document.body || root.contains(document.activeElement))) {
        opener.focus();
      }
    };
  }, [active]);

  return ref;
}
