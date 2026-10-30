"use client";

import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Your last message": shown while the user's last message is above the
 * view (a long reply after it), a tap goes back to where it starts
 */
export function LastMinePill({
  visible,
  onJump,
  className,
}: {
  visible: boolean;
  onJump: () => void;
  className?: string;
}) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onJump}
      className={cn(
        "glass text-foreground flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium shadow-lg",
        className
      )}
    >
      <ArrowUp className="h-3.5 w-3.5" />
      Your last message
    </button>
  );
}
