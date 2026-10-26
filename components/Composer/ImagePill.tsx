"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { THUMB_ROOM, type Chip } from "./text";

/** Where the page loads an attached image from (app/api/files/image) */
export const imageSrc = (path: string) =>
  `/api/files/image?path=${encodeURIComponent(path)}`;

/** The picture itself, or an icon when it can't be shown */
export function ImageThumb({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground flex items-center justify-center overflow-hidden",
        className
      )}
    >
      {failed === path ? (
        <ImageIcon className="h-3.5 w-3.5" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc(path)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(path)}
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}

/**
 * An image pill as the layer behind the box draws it: the thumbnail over
 * the room its text leaves for it, then "IMG_7654 · 1.2 MB ×". Its text is
 * the box's own, so the two stay in step. Vertical padding on an inline
 * box paints without moving lines.
 */
export function ImagePill({ chip }: { chip: Chip }) {
  return (
    <span className="bg-foreground/10 text-foreground relative rounded-lg py-[5px] shadow-[0_0_0_2px_hsl(var(--foreground)/0.1)]">
      <span className="relative">
        <ImageThumb
          path={chip.text}
          className="absolute top-1/2 left-0 h-7 w-7 -translate-y-1/2 rounded-md"
        />
        {chip.token.slice(0, THUMB_ROOM.length)}
      </span>
      {chip.token.slice(THUMB_ROOM.length, -1)}
      <span className="text-muted-foreground">{chip.token.slice(-1)}</span>
    </span>
  );
}

/**
 * The same pill in the layer over the box, there only to be touched: the
 * pill opens the viewer, its × takes it out. Transparent: the box's
 * caret and selection still show through around it.
 */
export function ImagePillTarget({
  chip,
  name,
  onOpen,
  onRemove,
}: {
  chip: Chip;
  name: string;
  onOpen: (chip: Chip) => void;
  onRemove: (chip: Chip) => void;
}) {
  // Said with plain hyphens
  const label = name.replace(/\u2011/g, "-");
  return (
    <>
      <span
        role="button"
        aria-label={`View ${label}`}
        // Keeps the box's focus (and the keyboard) while it's touched
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onOpen(chip)}
        className="pointer-events-auto cursor-pointer py-[5px]"
      >
        {chip.token.slice(0, -1)}
      </span>
      <span
        role="button"
        aria-label={`Remove ${label}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onRemove(chip)}
        // A bigger target than the × itself
        className="pointer-events-auto relative cursor-pointer after:absolute after:-inset-x-2 after:-inset-y-2.5 after:content-['']"
      >
        {chip.token.slice(-1)}
      </span>
    </>
  );
}
