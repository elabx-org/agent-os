"use client";

import { useSnapshot } from "valtio";
import { undoToasts } from "@/lib/undo";
import { cn } from "@/lib/utils";

/**
 * The glass toasts with Undo at the foot of Now (N-Settle): "Deck state
 * line fix settled" over "PR #106 merged". Inside the page, so they stay
 * clear of the column and, on the open Duo, on the left of the fold
 */
export function SettleToasts({
  inset = "inset-x-4",
  fill = false,
}: {
  /** Its sides: the page's own gutters, so it lines up with the cards */
  inset?: string;
  /** As wide as the cards (a narrow page), else at most 400px, centred */
  fill?: boolean;
}) {
  const { list } = useSnapshot(undoToasts);
  if (!list.length) return null;
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-[calc(18px+var(--home-pad-b,0px))] z-20 flex flex-col items-center gap-2",
        inset
      )}
    >
      {list.slice(-3).map((t) => (
        <div
          key={t.key}
          role="status"
          className={cn(
            "glass pointer-events-auto flex h-[52px] w-full items-center gap-2.5 rounded-[26px] pr-1.5 pl-[18px]",
            !fill && "max-w-[400px]"
          )}
        >
          <span className="flex min-w-0 flex-1 flex-col leading-[1.25]">
            <span className="truncate text-[14px] font-semibold">
              {t.title}
            </span>
            {t.caption && (
              <span className="text-muted-foreground truncate text-[12px]">
                {t.caption}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => t.onUndo()}
            className="pill pill-secondary pill-sm shrink-0 text-[#6D28D9] active:opacity-70 dark:text-[#C4B5FD]"
          >
            Undo
          </button>
        </div>
      ))}
    </div>
  );
}

/** Room the toasts take at the foot of the page (px), 0 when none show */
export function useSettleToastsRoom(): number {
  const { list } = useSnapshot(undoToasts);
  const n = Math.min(list.length, 3);
  // 52px each, 8px apart, 18px off the bottom
  return n ? n * 52 + (n - 1) * 8 + 18 : 0;
}
