"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CornerDownLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SPECIAL_KEYS } from "./toolbar-config";

interface DeckKey {
  label: string;
  key: string;
  icon?: typeof ArrowUp;
  area: string;
  tone?: "stop";
}

// Claude Code's menus need arrows, Enter, Esc and Tab; ^C stands apart
const KEYS: DeckKey[] = [
  { label: "Esc", key: SPECIAL_KEYS.ESC, area: "esc" },
  { label: "Tab", key: SPECIAL_KEYS.TAB, area: "tab" },
  { label: "^C", key: SPECIAL_KEYS.CTRL_C, area: "stop", tone: "stop" },
  { label: "Enter", key: "\r", icon: CornerDownLeft, area: "enter" },
  { label: "Up", key: SPECIAL_KEYS.UP, icon: ArrowUp, area: "up" },
  { label: "Left", key: SPECIAL_KEYS.LEFT, icon: ArrowLeft, area: "left" },
  { label: "Down", key: SPECIAL_KEYS.DOWN, icon: ArrowDown, area: "down" },
  { label: "Right", key: SPECIAL_KEYS.RIGHT, icon: ArrowRight, area: "right" },
];

/**
 * Big keys on the deck below the fold when the phone is half open like a
 * laptop and the keyboard is down: the space under the composer, within the
 * thumbs' reach.
 */
export function DeckPad({ onKeyPress }: { onKeyPress: (key: string) => void }) {
  return (
    <div
      className="grid min-h-0 flex-1 gap-2 overflow-hidden px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      style={{
        gridTemplateAreas: `"esc tab . up stop" "enter enter left down right"`,
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        gridTemplateRows: "repeat(2, minmax(44px, 72px))",
        alignContent: "end",
      }}
    >
      {KEYS.map(({ label, key, icon: Icon, area, tone }) => (
        <button
          key={area}
          type="button"
          aria-label={label}
          style={{ gridArea: area }}
          // Keep focus (and the keyboard state) where it is
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onKeyPress(key)}
          className={cn(
            "flex touch-manipulation items-center justify-center rounded-2xl text-sm font-medium active:opacity-70",
            tone === "stop"
              ? "border border-red-500/40 bg-red-500/15 text-red-400"
              : "bg-secondary text-foreground"
          )}
        >
          {Icon ? <Icon className="h-5 w-5" /> : label}
        </button>
      ))}
    </div>
  );
}
