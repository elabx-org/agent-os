"use client";

import { cn } from "@/lib/utils";
import { useIsNative } from "@/hooks/useIsNative";
import { ColumnItems } from "./ColumnItems";
import { useColumn } from "./columnState";
import { useKeyboardUp } from "./useKeyboardUp";
import { useBarHeight } from "./barHeight";

/** 46px items, 5px padding and the border, then the gap above it */
const HBAR_HEIGHT = 64;
const BOTTOM = "max(12px, env(safe-area-inset-bottom))";

/**
 * Half folded (Fold-Chat, Fold-Terminal): the column as a centred glass bar
 * on the base, 46px items, separators as in the spec. In the flow below the
 * pane; away while the keyboard is up.
 */
export function HBar({ className }: { className?: string }) {
  const native = useIsNative();
  const keyboardUp = useKeyboardUp(true);
  const { items } = useColumn(keyboardUp, native);
  const shown = !keyboardUp && items.length > 0;
  useBarHeight(shown ? `calc(${HBAR_HEIGHT}px + ${BOTTOM})` : null, true);
  if (!shown) return null;
  return (
    <div
      className={cn(
        "flex shrink-0 justify-center pt-1.5 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]",
        className
      )}
      style={{ paddingBottom: BOTTOM }}
    >
      {/* A phone's session gets it too: an iPad split to 320 scrolls it
          rather than push items off the side (the hover hints need room
          above it otherwise) */}
      <nav
        aria-label="Main"
        data-control-column
        className="glass flex max-w-full items-center gap-0.5 rounded-[30px] p-[5px] max-[359px]:overflow-x-auto"
      >
        <ColumnItems items={items} orientation="horizontal" />
      </nav>
    </div>
  );
}
