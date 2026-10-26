"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AdaptiveKey as Key } from "@/lib/adaptive-keys";
import { useKeyRepeat } from "@/hooks/useKeyRepeat";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/** How far up a flick goes before it picks the second key, in px */
const FLICK_PX = 18;
/** Held this long, a key that repeats starts repeating, in ms */
const HOLD_MS = 180;

/**
 * A key of the adaptive row: a tap sends it, a flick up its second key
 * (shown small in the corner, and above the key while flicking). A key
 * that repeats does so while held, unless the touch flicks.
 */
export function AdaptiveKey({
  k,
  onKeyPress,
}: {
  k: Key;
  onKeyPress: (key: string) => void;
}) {
  // The key's place while flicking, for the second key shown above it
  // (over the composer, which sits above the key row)
  const [flicking, setFlicking] = useState<DOMRect | null>(null);
  const startY = useRef<number | null>(null);
  const press = useCallback(() => onKeyPress(k.key), [onKeyPress, k.key]);
  const { startRepeat, stopRepeat } = useKeyRepeat(press);
  // Held past this without flicking, a key that repeats starts repeating
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeated = useRef(false);
  const stop = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    stopRepeat();
  }, [stopRepeat]);
  useEffect(() => stop, [stop]);

  const sendFlick = () => {
    if (!k.flick) return;
    haptic("light");
    k.flick.keys.forEach((key, i) =>
      i ? setTimeout(() => onKeyPress(key), i * 80) : onKeyPress(key)
    );
  };

  return (
    <button
      type="button"
      aria-label={
        k.flick ? `${k.label}, flick up for ${k.flick.label}` : k.label
      }
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        startY.current = e.clientY;
        repeated.current = false;
        // Arrows repeat while held: not at once, so a flick sends only its key
        if (k.repeats)
          holdTimer.current = setTimeout(() => {
            holdTimer.current = null;
            repeated.current = true;
            startRepeat();
          }, HOLD_MS);
      }}
      onPointerMove={(e) => {
        if (startY.current === null || !k.flick) return;
        const up = startY.current - e.clientY >= FLICK_PX;
        if (up !== !!flicking) {
          setFlicking(up ? e.currentTarget.getBoundingClientRect() : null);
          if (up) stop();
        }
      }}
      onPointerUp={() => {
        stop();
        if (startY.current === null) return;
        startY.current = null;
        if (flicking) sendFlick();
        else if (!repeated.current) {
          haptic("light");
          press();
        }
        setFlicking(null);
      }}
      onPointerCancel={() => {
        stop();
        startY.current = null;
        setFlicking(null);
      }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "relative flex h-[40px] min-w-[40px] touch-none items-center justify-center gap-1.5 rounded-xl px-2 text-[13px] font-medium select-none",
        k.danger
          ? "border border-red-500/40 bg-red-500/15 text-red-400"
          : "bg-secondary text-secondary-foreground",
        !flicking && "active:bg-primary active:text-primary-foreground",
        k.caption && "adaptive-wide"
      )}
    >
      <span>{k.label}</span>
      {k.caption && (
        <span className="text-muted-foreground text-xs font-normal">
          {k.caption}
        </span>
      )}
      {k.flick && (
        <span
          aria-hidden="true"
          className="text-muted-foreground/70 absolute top-0.5 right-1 text-[9px] leading-none font-normal"
        >
          {k.flick.label}
        </span>
      )}
      {flicking &&
        k.flick &&
        createPortal(
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground pointer-events-none fixed z-50 -translate-x-1/2 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap shadow-lg"
            style={{
              left: flicking.left + flicking.width / 2,
              bottom: innerHeight - flicking.top + 6,
            }}
          >
            {k.flick.label}
          </span>,
          document.body
        )}
    </button>
  );
}
