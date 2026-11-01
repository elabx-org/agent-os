"use client";

import { Clipboard, ImagePlus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getButtonDef,
  type ToolbarButtonId,
} from "@/components/Terminal/toolbar-config";

export interface ChatKeyRowProps {
  ids: ToolbarButtonId[];
  /** Text for the reply box: "/", "@", a new line */
  onText: (text: string) => void;
  onImage: () => void;
  onPaste: () => void;
  /** To Claude itself, as in its own input */
  onShiftTab: () => void;
  onEsc: () => void;
  className?: string;
}

const ICONS: Partial<Record<ToolbarButtonId, LucideIcon>> = {
  image: ImagePlus,
  paste: Clipboard,
};

/**
 * The chat's shortcut row above the reply box (Settings → Keys → Chat):
 * the keys a message needs, without the keyboard's symbol pages
 */
export function ChatKeyRow({
  ids,
  onText,
  onImage,
  onPaste,
  onShiftTab,
  onEsc,
  className,
}: ChatKeyRowProps) {
  const press = (id: ToolbarButtonId) => {
    if (id === "image") return onImage();
    if (id === "paste") return onPaste();
    if (id === "shift-tab") return onShiftTab();
    if (id === "esc") return onEsc();
    const key = getButtonDef(id)?.key;
    if (key) onText(key);
  };
  return (
    <div
      role="toolbar"
      aria-label="Shortcuts"
      className={cn(
        "flex gap-1 overflow-x-auto [scrollbar-width:none]",
        className
      )}
    >
      {ids.map((id) => {
        const def = getButtonDef(id);
        if (!def) return null;
        const Icon = ICONS[id];
        return (
          <button
            key={id}
            type="button"
            aria-label={def.label}
            title={def.label}
            // The reply box keeps focus (and the keyboard stays up)
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => press(id)}
            className={cn(
              "tkey h-[38px] min-w-[40px] flex-shrink-0 rounded-xl px-3 text-[13px] font-medium",
              "active:bg-primary active:text-primary-foreground active:bg-none",
              id === "esc" && "esc"
            )}
          >
            {Icon ? <Icon className="h-4 w-4" /> : def.displayLabel}
          </button>
        );
      })}
    </div>
  );
}
