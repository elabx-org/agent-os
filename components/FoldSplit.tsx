"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { useFoldDeck } from "@/hooks/useFoldDeck";
import { useTabletop } from "@/hooks/useTabletop";

interface FoldSplitProps {
  /** Above the fold: the work to watch */
  top: ReactNode;
  /** Below the fold, on the base: the controls, nearest the thumbs */
  base: ReactNode;
  /** What shows when there is no horizontal fold to split around */
  children: ReactNode;
  /**
   * Split around the fold where it crosses this element (a pane), rather
   * than the whole viewport. The element should hold the FoldSplit at its
   * full height.
   */
  el?: RefObject<HTMLElement | null>;
  /** Pixels at the bottom that something else covers (a keyboard inset) */
  coveredBottom?: number;
  className?: string;
}

/**
 * Tabletop layout: the top slot above the fold, an empty gap where the fold
 * bends (no control may sit there) and the base slot below it. Renders the
 * children unchanged in every other pose.
 */
export function FoldSplit({
  top,
  base,
  children,
  el,
  coveredBottom = 0,
  className,
}: FoldSplitProps) {
  const unused = useRef<HTMLElement>(null);
  const page = useTabletop(coveredBottom, !el);
  const deck = useFoldDeck(el ?? unused, coveredBottom, !!el);

  const split = el
    ? deck && { top: undefined, gap: deck.gap, base: deck.deck }
    : page;
  if (!split) return <>{children}</>;

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col", className)}
      // In a pane the top slot fills what's left, so it mustn't take the
      // covered strip too or the gap slides off the fold
      style={el && coveredBottom ? { paddingBottom: coveredBottom } : undefined}
    >
      <div
        className={cn(
          "flex min-h-0 flex-col overflow-hidden",
          split.top === undefined ? "flex-1" : "shrink-0"
        )}
        style={split.top === undefined ? undefined : { height: split.top }}
      >
        {top}
      </div>
      <div aria-hidden className="shrink-0" style={{ height: split.gap }} />
      <div
        className="flex min-h-0 shrink-0 flex-col overflow-hidden"
        style={{ height: split.base }}
      >
        {base}
      </div>
    </div>
  );
}
