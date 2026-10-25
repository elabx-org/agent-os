"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { gestures } from "@/lib/gestures";

export interface SwipeAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Background of the revealed action, e.g. "bg-red-500" */
  tone: string;
  onAction: () => void;
}

interface SwipeRowProps {
  children: React.ReactNode;
  /** Revealed by swiping right */
  leading?: SwipeAction;
  /** Revealed by swiping left */
  trailing?: SwipeAction;
  disabled?: boolean;
  className?: string;
}

// Past this the action runs on release (and the phone ticks once)
const TRIGGER_PX = 88;
// A move this far decides between a swipe and a scroll
const DECIDE_PX = 10;

/**
 * Swipe actions on a list row, like Mail: swipe right for the leading
 * action, left for the trailing one, and let go past the mark to run it.
 * Vertical moves scroll the list as usual; a drag in progress wins.
 */
export function SwipeRow({
  children,
  leading,
  trailing,
  disabled,
  className,
}: SwipeRowProps) {
  const rowRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [offset, setOffset] = React.useState(0);
  const [settling, setSettling] = React.useState(false);
  // Read at release, so a re-render mid-swipe doesn't reset the gesture
  const actions = React.useRef({ leading, trailing });
  actions.current = { leading, trailing };
  const hasLeading = !!leading;
  const hasTrailing = !!trailing;

  React.useEffect(() => {
    const row = rowRef.current;
    if (!row || disabled || (!hasLeading && !hasTrailing)) return;

    let start: { x: number; y: number } | null = null;
    let mode: "undecided" | "swipe" | "scroll" = "undecided";
    let dx = 0;
    let armed = false;
    let swipedAt = 0;

    const clamp = (x: number) => {
      if (x > 0 && !hasLeading) return 0;
      if (x < 0 && !hasTrailing) return 0;
      // Resistance past the mark
      const sign = Math.sign(x);
      const abs = Math.abs(x);
      return (
        sign * (abs < TRIGGER_PX ? abs : TRIGGER_PX + (abs - TRIGGER_PX) / 3)
      );
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      mode = "undecided";
      dx = 0;
      armed = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!start || mode === "scroll") return;
      if (gestures.dragging) {
        start = null;
        return;
      }
      const t = e.touches[0];
      const mx = t.clientX - start.x;
      const my = t.clientY - start.y;
      if (mode === "undecided") {
        if (Math.abs(my) > DECIDE_PX && Math.abs(my) >= Math.abs(mx)) {
          mode = "scroll";
          return;
        }
        if (Math.abs(mx) < DECIDE_PX) return;
        mode = "swipe";
        gestures.swiping = true;
        setSettling(false);
      }
      e.preventDefault();
      dx = clamp(mx);
      setOffset(dx);
      const nowArmed = Math.abs(dx) >= TRIGGER_PX;
      if (nowArmed !== armed) {
        armed = nowArmed;
        if (armed) haptic("selection");
      }
    };

    const onEnd = () => {
      if (mode === "swipe") {
        swipedAt = Date.now();
        const { leading, trailing } = actions.current;
        const action = armed ? (dx > 0 ? leading : trailing) : undefined;
        setSettling(true);
        setOffset(0);
        if (action) {
          haptic(action.tone.includes("red") ? "warning" : "light");
          action.onAction();
        }
      }
      gestures.swiping = false;
      start = null;
      mode = "undecided";
    };

    // The tap that ends a swipe isn't a tap on the row
    const onClick = (e: MouseEvent) => {
      if (Date.now() - swipedAt < 400) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    row.addEventListener("touchstart", onStart, { passive: true });
    row.addEventListener("touchmove", onMove, { passive: false });
    row.addEventListener("touchend", onEnd);
    row.addEventListener("touchcancel", onEnd);
    row.addEventListener("click", onClick, true);
    return () => {
      row.removeEventListener("touchstart", onStart);
      row.removeEventListener("touchmove", onMove);
      row.removeEventListener("touchend", onEnd);
      row.removeEventListener("touchcancel", onEnd);
      row.removeEventListener("click", onClick, true);
    };
  }, [hasLeading, hasTrailing, disabled]);

  const shown = offset > 0 ? leading : offset < 0 ? trailing : undefined;
  const armed = Math.abs(offset) >= TRIGGER_PX;

  return (
    <div
      ref={rowRef}
      data-swipe-row
      className={cn("relative overflow-hidden rounded-md", className)}
    >
      {shown && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center px-4 text-white transition-opacity",
            shown.tone,
            offset > 0 ? "justify-start" : "justify-end",
            armed ? "opacity-100" : "opacity-70"
          )}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <shown.icon className="h-5 w-5" />
            {shown.label}
          </span>
        </div>
      )}
      <div
        ref={contentRef}
        className={cn(
          "bg-background relative",
          settling && "transition-transform duration-200 ease-out"
        )}
        style={offset ? { transform: `translateX(${offset}px)` } : undefined}
        onTransitionEnd={() => setSettling(false)}
      >
        {children}
      </div>
    </div>
  );
}
