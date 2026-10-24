"use client";

import { Keyboard, KeyboardOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface KeybarToggleButtonProps {
  isVisible: boolean;
  onToggle: () => void;
  /** Measured keybar height, so the button sits just above it */
  keybarHeight?: number;
  /** Keybar moved to the top for a split/floating keyboard */
  keybarAtTop?: boolean;
}

/**
 * Floating button to toggle mobile keybar visibility.
 * Positioned at bottom-right of terminal, above the keybar when visible.
 */
export function KeybarToggleButton({
  isVisible,
  onToggle,
  keybarHeight = 0,
  keybarAtTop = false,
}: KeybarToggleButtonProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "absolute right-[calc(0.75rem+env(safe-area-inset-right))] z-30",
        "flex items-center justify-center",
        "h-11 w-11 rounded-full",
        "bg-secondary/90 backdrop-blur-sm",
        "shadow-lg",
        "text-muted-foreground hover:bg-accent hover:text-foreground",
        "touch-manipulation transition-all duration-200",
        "active:scale-95",
        // Default position when the keybar is hidden or at the top
        (!isVisible || keybarAtTop || !keybarHeight) &&
          "bottom-[calc(1rem+env(safe-area-inset-bottom))]"
      )}
      style={
        isVisible && !keybarAtTop && keybarHeight
          ? { bottom: keybarHeight + 12 }
          : undefined
      }
      aria-label={isVisible ? "Hide keys" : "Show keys"}
      title={isVisible ? "Hide keys" : "Show keys"}
    >
      {isVisible ? (
        <KeyboardOff className="h-5 w-5" />
      ) : (
        <Keyboard className="h-5 w-5" />
      )}
    </button>
  );
}
