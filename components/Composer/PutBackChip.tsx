"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ImageThumb } from "./ImagePill";
import { imageName } from "./text";
import type { ComposerEngine } from "./useComposer";

/**
 * Pictures the box lost without being sent (its text cleared by mistake):
 * "IMG_7721 was removed · Put back", until put back, dismissed or sent
 */
export function PutBackChip({
  composer,
  className,
}: {
  composer: ComposerEngine;
  className?: string;
}) {
  const { dropped } = composer;
  if (!dropped.length) return null;
  const name =
    dropped.length === 1
      ? imageName(dropped[0]).replace(/‑/g, "-")
      : `${dropped.length} images`;
  // Keeps the box's focus (and the keyboard) while it's touched
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  return (
    <div
      role="status"
      className={cn(
        "glass mb-2 flex min-h-11 items-center gap-2.5 rounded-2xl py-1 pr-1 pl-1.5 text-[13px]",
        className
      )}
    >
      <span className="flex flex-none -space-x-3">
        {dropped.slice(0, 3).map((path) => (
          <ImageThumb
            key={path}
            path={path}
            className="ring-background h-8 w-8 rounded-lg ring-2"
          />
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {name} {dropped.length === 1 ? "was" : "were"} removed
      </span>
      <button
        type="button"
        onMouseDown={keep}
        onClick={composer.putBack}
        className="bg-primary text-primary-foreground h-9 flex-none rounded-full px-3.5 font-semibold"
      >
        Put back
      </button>
      <button
        type="button"
        onMouseDown={keep}
        onClick={composer.dismissDropped}
        aria-label="Dismiss"
        className="text-muted-foreground active:bg-foreground/10 relative flex h-9 w-9 flex-none items-center justify-center rounded-full after:absolute after:-inset-1 after:content-['']"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
