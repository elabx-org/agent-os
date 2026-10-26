"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { lineCount, type Chip } from "./text";
import { GROUP_HEADING, POPOVER } from "./SuggestionPopover";

interface PasteChipProps {
  chip: Chip;
  onUnfold: (chip: Chip) => void;
  onRemove: (chip: Chip) => void;
  onClose: () => void;
}

const PREVIEW_LINES = 6;

const ACTION =
  "bg-muted text-foreground active:bg-accent hover:bg-accent min-h-8 rounded-full px-3 text-xs pointer-coarse:min-h-11";

function size(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** A pill's preview: the first lines of a paste, or the image's path */
export function PasteChip({
  chip,
  onUnfold,
  onRemove,
  onClose,
}: PasteChipProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Closing the preview, not an Esc for Claude
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const paste = chip.kind === "paste";
  const lines = chip.text.split("\n");
  const shown = paste ? lines.slice(0, PREVIEW_LINES).join("\n") : chip.text;
  const more = lines.length - PREVIEW_LINES;

  return (
    <div ref={rootRef} className={POPOVER}>
      <div className={GROUP_HEADING}>
        {paste
          ? `Pasted text #${chip.n} · ${lineCount(chip.text)} lines · ${size(chip.text)}`
          : `Image #${chip.n}`}
      </div>
      <pre className="text-foreground/85 mx-1 my-1 max-h-40 overflow-auto rounded-[10px] bg-black/25 px-2.5 py-2 font-mono text-[11px] leading-4 break-all whitespace-pre-wrap">
        {shown}
        {paste && more > 0 && `\n… ${more} more lines`}
      </pre>
      <div className="flex gap-1.5 px-1 pt-1 pb-0.5">
        {paste && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onUnfold(chip)}
            className={ACTION}
          >
            Expand inline
          </button>
        )}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onRemove(chip)}
          className={ACTION}
        >
          Remove
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClose}
          className={cn(
            ACTION,
            "bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/80 ml-auto"
          )}
        >
          Done
        </button>
      </div>
    </div>
  );
}
