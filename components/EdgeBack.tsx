"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { layoutStore } from "@/hooks/useLayoutMode";
import { haptic } from "@/lib/haptics";
import { runNav } from "@/lib/nav-actions";
import { mobileNavStore } from "@/stores/mobileNav";
import { newSurfaceStore } from "@/stores/newSurface";
import { settingsPageStore } from "@/stores/settingsPage";
import { surfaceStore } from "@/stores/surface";
import { workspacePageStore } from "@/stores/workspacePage";

/** How far in from the left a swipe may start, and how far it must go */
const EDGE = 24;
const GO = 72;

/**
 * What a swipe from the left edge closes, the way the column's ‹ would:
 * null when nothing is over the session (a swipe there is the terminal's)
 */
export function edgeBackAction(): "back" | "resume" | null {
  const wide =
    layoutStore.mode !== "phone" && layoutStore.mode !== "duo-closed";
  if (
    settingsPageStore.open ||
    newSurfaceStore.open ||
    workspacePageStore.page ||
    mobileNavStore.inboxOpen ||
    surfaceStore.searchOpen
  )
    return "back";
  if (wide && (mobileNavStore.liveOpen || mobileNavStore.changesOpen))
    return "back";
  const view = mobileNavStore.viewMode;
  if (layoutStore.mode === "duo-closed" && (view === "git" || view === "files"))
    return "back";
  // Now over a session, on one page: back to it
  if (surfaceStore.home && surfaceStore.behind && !wide) return "resume";
  return null;
}

/**
 * Swipe from the left edge to go back, on touch screens: a ‹ follows the
 * finger and goes back once it has come far enough. Esc closes the open
 * Duo's right-page panels (Live, Changes) the same way
 */
export function EdgeBack() {
  const [pull, setPull] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    dx: number;
    on: boolean;
    action: "back" | "resume";
  } | null>(null);

  useEffect(() => {
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || t.clientX > EDGE) return;
      const action = edgeBackAction();
      if (!action) return;
      drag.current = { x: t.clientX, y: t.clientY, dx: 0, on: false, action };
    };
    const move = (e: TouchEvent) => {
      const d = drag.current;
      if (!d) return;
      const t = e.touches[0];
      const dx = t.clientX - d.x;
      const dy = t.clientY - d.y;
      // Up or down first: a scroll, not a swipe
      if (!d.on && Math.abs(dy) > 10 && Math.abs(dy) > dx) {
        drag.current = null;
        setPull(null);
        return;
      }
      if (!d.on && dx > 10) d.on = true;
      if (!d.on) return;
      e.preventDefault();
      if (d.dx < GO && dx >= GO) haptic("light");
      d.dx = dx;
      setPull({ x: Math.max(0, dx), y: t.clientY });
    };
    const end = () => {
      const d = drag.current;
      drag.current = null;
      setPull(null);
      if (d?.on && d.dx >= GO) runNav(d.action);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (layoutStore.mode === "desktop") return;
      if (!mobileNavStore.liveOpen && !mobileNavStore.changesOpen) return;
      const el = e.target as HTMLElement | null;
      if (
        el?.closest(".xterm, input, textarea, [contenteditable], [role=dialog]")
      )
        return;
      if (document.querySelector("[role=dialog][data-state=open]")) return;
      runNav("back");
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
      window.removeEventListener("keydown", key);
    };
  }, []);

  if (!pull) return null;
  const go = pull.x >= GO;
  const shift = Math.min(pull.x, GO + 16) - 44;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 z-[100] grid h-11 w-11 place-items-center rounded-full shadow-lg transition-colors"
      style={{
        top: pull.y - 22,
        transform: `translateX(${shift}px)`,
        background: go
          ? "hsl(var(--primary))"
          : "hsl(var(--foreground) / 0.18)",
        color: go ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
        backdropFilter: "blur(12px)",
      }}
    >
      <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
    </div>
  );
}
