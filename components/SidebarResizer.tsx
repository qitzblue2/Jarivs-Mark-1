"use client";

import { useRef } from "react";
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, clampSidebar } from "@/lib/appearance";
import { setAppearance, useAppearance } from "@/lib/appearance-store";

/**
 * The drag handle on the chat list's right edge.
 *
 * Pointer events with capture, so the drag survives leaving the thin handle
 * (and works with touch and pen as well as a mouse). It is also a real
 * separator for the keyboard and screen readers: focus it, then the arrow keys
 * resize, Home/End jump to the limits, and Enter or a double-click puts it back.
 */
export default function SidebarResizer() {
  const { sidebarWidth } = useAppearance();
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const KEY_STEP = 16;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat list"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={sidebarWidth}
      tabIndex={0}
      data-sidebar-resizer
      title="Drag to resize — double-click to reset"
      className="group absolute inset-y-0 -right-1 z-10 flex w-2 cursor-col-resize touch-none justify-center outline-offset-0"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startWidth: sidebarWidth };
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        // Not persisted until the drag ends: this runs on every pointer move.
        setAppearance({ sidebarWidth: drag.current.startWidth + e.clientX - drag.current.startX }, { persist: false });
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        drag.current = null;
        document.body.style.userSelect = "";
        setAppearance({}); // keep the width the drag ended on
      }}
      onPointerCancel={() => {
        drag.current = null;
        document.body.style.userSelect = "";
        setAppearance({});
      }}
      onDoubleClick={() => setAppearance({ sidebarWidth: SIDEBAR_DEFAULT })}
      onKeyDown={(e) => {
        const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
        const next =
          e.key === "ArrowLeft" ? sidebarWidth - step
          : e.key === "ArrowRight" ? sidebarWidth + step
          : e.key === "Home" ? SIDEBAR_MIN
          : e.key === "End" ? SIDEBAR_MAX
          : e.key === "Enter" ? SIDEBAR_DEFAULT
          : null;
        if (next === null) return;
        e.preventDefault();
        setAppearance({ sidebarWidth: clampSidebar(next) });
      }}
    >
      <span className="h-full w-px bg-transparent transition group-hover:bg-arc-dim group-focus-visible:bg-arc-dim group-active:bg-arc-dim" />
    </div>
  );
}
