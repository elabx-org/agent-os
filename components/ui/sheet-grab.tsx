"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A hand-built sheet's grabber that really drags: pull it down past a third
 * of the sheet (or flick it) and the sheet closes, else it springs back. A
 * tap closes too. It moves the element it sits in, so put it first inside
 * the sheet itself.
 */
export function SheetGrab({
  onClose,
  label = "Close",
  className,
}: {
  onClose: () => void;
  label?: string;
  className?: string;
}) {
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const sheet = (el: HTMLElement) => el.parentElement as HTMLElement;

  const settle = (el: HTMLElement, close: boolean) => {
    const s = sheet(el);
    s.style.transition = "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)";
    s.style.transform = close ? "translateY(100%)" : "";
    if (close) setTimeout(onClose, 180);
    else
      setTimeout(() => {
        s.style.transition = "";
      }, 230);
  };

  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "-mx-4 -mb-1 flex h-7 shrink-0 cursor-grab touch-none items-center justify-center self-stretch",
        className
      )}
      onPointerDown={(e) => {
        drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
        sheet(e.currentTarget).style.transition = "none";
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.dy = Math.max(0, e.clientY - d.y);
        sheet(e.currentTarget).style.transform = `translateY(${d.dy}px)`;
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const height = sheet(e.currentTarget).offsetHeight || 1;
        const speed = d.dy / Math.max(1, performance.now() - d.t);
        // A tap (no real movement) closes as well
        settle(
          e.currentTarget,
          d.dy < 4 || d.dy > height / 3 || (speed > 0.6 && d.dy > 30)
        );
      }}
      onPointerCancel={(e) => {
        drag.current = null;
        settle(e.currentTarget, false);
      }}
    >
      <span aria-hidden="true" className="sheet-grab !m-0" />
    </button>
  );
}
