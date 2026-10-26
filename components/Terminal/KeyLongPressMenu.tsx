"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { useLongPress } from "@/hooks/useLongPress";

export interface MenuKey {
  label: string;
  key: string;
}

/** The rarer keys behind a key: hold it (or right-click) for a small row of
    them above it; a tap still sends the key itself */
export function KeyLongPressMenu({
  label,
  keyCode,
  menu,
  onKeyPress,
  className,
  extra,
}: {
  label: ReactNode;
  keyCode: string;
  menu: MenuKey[];
  onKeyPress: (key: string) => void;
  className?: string;
  /** Shown after the keys, e.g. the toolbar settings */
  extra?: (close: () => void) => ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = () => setAnchor(null);
  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAnchor(rect);
  };
  useLongPress(buttonRef, open);

  // Any touch outside, a scroll or a resize puts it away
  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setAnchor(null);
    };
    const dismiss = () => setAnchor(null);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [anchor]);

  // Open toward the middle of the screen so it never runs off an edge
  const toRight = anchor && anchor.left + anchor.width / 2 > innerWidth / 2;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          onKeyPress(keyCode);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          open();
        }}
        className={className}
      >
        {label}
      </button>
      {anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="bg-popover border-border fixed z-50 flex gap-1 rounded-xl border p-1.5 shadow-lg"
            style={{
              bottom: innerHeight - anchor.top + 6,
              ...(toRight
                ? { right: Math.max(4, innerWidth - anchor.right) }
                : { left: Math.max(4, anchor.left) }),
            }}
          >
            {menu.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  haptic("light");
                  onKeyPress(item.key);
                  close();
                }}
                className={cn(
                  "bg-secondary text-secondary-foreground flex h-[40px] min-w-[40px] items-center justify-center rounded-lg px-2 text-[13px] font-medium",
                  "active:bg-primary active:text-primary-foreground"
                )}
              >
                {item.label}
              </button>
            ))}
            {extra?.(close)}
          </div>,
          document.body
        )}
    </>
  );
}
