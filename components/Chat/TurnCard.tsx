"use client";

import { Pencil, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Turn } from "@/lib/turn-types";
import { Counts } from "./ToolCard";

/** 44px tall, a touch narrower than a page's pills (N-Undo) */
const PILL = "pill h-11 px-4 text-sm";

/**
 * After the reply that ended a turn (N-Undo, Open-Changes): "Turn 4
 * changed 3 files +40 −9", then Diff and Undo turn. An undone turn says so
 */
export function TurnCard({
  turn,
  diffOpen = false,
  onDiff,
  onUndo,
  className,
}: {
  turn: Turn;
  /** Its diff review is open: accent edge, the Diff pill pressed */
  diffOpen?: boolean;
  onDiff: () => void;
  onUndo: () => void;
  className?: string;
}) {
  const count = turn.files.length;
  const undone = turn.undoneAt !== null;
  return (
    <div
      aria-label={`Turn ${turn.turnNo} summary`}
      className={cn(
        "turn-card",
        diffOpen && "border-primary dark:border-meter border-[1.5px]",
        className
      )}
    >
      <div className="text-foreground/80 flex items-center gap-2 text-sm">
        <Pencil className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          Turn {turn.turnNo} changed {count} {count === 1 ? "file" : "files"}
        </span>
        <Counts added={turn.added} removed={turn.removed} />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDiff}
          aria-pressed={diffOpen}
          className={cn(
            PILL,
            "pill-secondary active:opacity-80",
            diffOpen && "border-primary dark:border-meter bg-primary/25 border"
          )}
        >
          Diff
        </button>
        {undone ? (
          <span className="text-muted-foreground flex items-center gap-1.5 px-2 text-sm">
            <Undo2 className="h-4 w-4" />
            Undone
          </span>
        ) : (
          <button
            type="button"
            onClick={onUndo}
            className={cn(PILL, "pill-outline active:opacity-80")}
          >
            Undo turn
          </button>
        )}
      </div>
    </div>
  );
}
