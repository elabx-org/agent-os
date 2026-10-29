"use client";

import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A panel on the open Duo's right page (Live, Changes): a handle on its fold
 * side drags it away to the right, past a third (or a flick) closes it. A
 * tap on the handle closes it too.
 */
export function PagePanel({
  label,
  onClose,
  className,
  children,
}: {
  label: string;
  onClose?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; t: number; dx: number } | null>(null);

  const settle = (close: boolean) => {
    const el = box.current;
    if (!el) return;
    el.style.transition = "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)";
    el.style.transform = close ? "translateX(100%)" : "";
    setTimeout(
      () => {
        el.style.transition = "";
        if (close) {
          el.style.transform = "";
          onClose?.();
        }
      },
      close ? 180 : 230
    );
  };

  return (
    <div ref={box} className={cn("relative flex min-h-0", className)}>
      {onClose && (
        <button
          type="button"
          aria-label={`Close ${label}`}
          className="group absolute inset-y-0 left-0 z-10 flex w-5 cursor-ew-resize touch-none items-center justify-center"
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, t: performance.now(), dx: 0 };
            e.currentTarget.setPointerCapture(e.pointerId);
            if (box.current) box.current.style.transition = "none";
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || !box.current) return;
            d.dx = Math.max(0, e.clientX - d.x);
            box.current.style.transform = `translateX(${d.dx}px)`;
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (!d) return;
            const width = box.current?.offsetWidth || 1;
            const speed = d.dx / Math.max(1, performance.now() - d.t);
            settle(d.dx < 4 || d.dx > width / 3 || (speed > 0.6 && d.dx > 30));
          }}
          onPointerCancel={() => {
            drag.current = null;
            settle(false);
          }}
        >
          <span
            aria-hidden="true"
            className="bg-foreground/25 group-active:bg-foreground/45 h-12 w-[5px] rounded-full"
          />
        </button>
      )}
      {children}
    </div>
  );
}

/** The × in a right-page panel's header */
export function PanelClose({
  label,
  onClose,
  className,
}: {
  label: string;
  onClose: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Close ${label}`}
      onClick={onClose}
      className={cn(
        "bg-foreground/10 text-foreground hover:bg-foreground/15 -my-1 grid h-8 w-8 shrink-0 place-items-center rounded-full",
        className
      )}
    >
      <X className="h-4 w-4" strokeWidth={2.4} />
    </button>
  );
}
