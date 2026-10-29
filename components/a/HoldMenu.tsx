"use client";

import { useRef, type ReactNode } from "react";
import { useLongPress } from "@/hooks/useLongPress";
import { useViewport } from "@/hooks/useViewport";

/**
 * A .row whose actions open on a hold (touch) or a right-click (mouse),
 * where the mock has no ⋯ for them. .row-wrap keeps the card's hairlines
 */
export function HoldMenu({
  onOpen,
  children,
}: {
  onOpen: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { isTouch } = useViewport();
  useLongPress(ref, isTouch ? onOpen : undefined);
  return (
    <div
      ref={ref}
      className="row-wrap"
      onContextMenu={(e) => {
        e.preventDefault();
        onOpen();
      }}
    >
      {children}
    </div>
  );
}
