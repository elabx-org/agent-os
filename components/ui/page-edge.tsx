"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The grip on a layer's left edge: drag it right a third of the way (at most 160px) or flick it
 * and the layer slides away and `onClose` runs, else it springs back. A tap
 * closes too. It moves the element it sits in, which must be positioned
 */
export function PageEdge({
  label,
  onClose,
  className,
}: {
  label: string;
  onClose: () => void;
  className?: string;
}) {
  const drag = useRef<{ x: number; t: number; dx: number } | null>(null);
  const layer = (el: HTMLElement) => el.parentElement as HTMLElement;

  const settle = (el: HTMLElement, close: boolean) => {
    const box = layer(el);
    box.style.transition = "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)";
    box.style.transform = close ? "translateX(100%)" : "";
    setTimeout(
      () => {
        box.style.transition = "";
        if (close) {
          box.style.transform = "";
          onClose();
        }
      },
      close ? 180 : 230
    );
  };

  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "group absolute inset-y-0 left-0 z-20 flex w-5 cursor-ew-resize touch-none items-center justify-center",
        className
      )}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, t: performance.now(), dx: 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
        layer(e.currentTarget).style.transition = "none";
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.dx = Math.max(0, e.clientX - d.x);
        layer(e.currentTarget).style.transform = `translateX(${d.dx}px)`;
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const width = layer(e.currentTarget).offsetWidth || 1;
        const speed = d.dx / Math.max(1, performance.now() - d.t);
        settle(
          e.currentTarget,
          d.dx < 4 ||
            d.dx > Math.min(width / 3, 160) ||
            (speed > 0.6 && d.dx > 30)
        );
      }}
      onPointerCancel={(e) => {
        drag.current = null;
        settle(e.currentTarget, false);
      }}
    >
      <span
        aria-hidden="true"
        className="bg-foreground/25 group-active:bg-foreground/45 h-12 w-[5px] rounded-full"
      />
    </button>
  );
}
