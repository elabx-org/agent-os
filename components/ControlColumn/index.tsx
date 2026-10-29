"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useIsNative } from "@/hooks/useIsNative";
import { useSurface } from "@/stores/surface";
import { ColumnItems } from "./ColumnItems";
import { useColumn } from "./columnState";
import { useKeyboardUp } from "./useKeyboardUp";
import { HBar } from "./HBar";
import { TabBar } from "./TabBar";

export { HBar } from "./HBar";
export { TabBar } from "./TabBar";

/** Width of the column capsule: 46px items, 5px padding and the border */
export const COLUMN_WIDTH = 58;
/** Under the camera and the clock/status glyphs at the top of the Duo's column */
const SIDE_RAIL_TOP = 132;
/** With the keyboard up the column moves up to stay above it (Closed-Terminal) */
const SIDE_RAIL_TOP_KEYBOARD = 76;

interface ControlColumnProps {
  /**
   * column: a vertical capsule, placed by the parent (or by sideRailWidth);
   * hbar: the tabletop's centred bar (HBar); tabs: the phone's tab bar and
   * New button (TabBar), or in a session the bar of views. `bar` is the old
   * name for `tabs`
   */
  variant: "column" | "bar" | "hbar" | "tabs";
  /**
   * The iPhone Duo's right-hand system column in a browser: the capsule is
   * fixed in it, under the status glyphs, and stays above a docked keyboard
   */
  sideRailWidth?: number;
  className?: string;
}

/**
 * The one view switcher: what lib/column-spec.ts lists for the surface and
 * the posture, as a column, the tabletop bar or the phone's tab bar
 */
export function ControlColumn({
  variant,
  sideRailWidth,
  className,
}: ControlColumnProps) {
  if (variant === "hbar") return <HBar className={className} />;
  if (variant === "tabs" || variant === "bar")
    return <PhoneBar className={className} />;
  return <Column sideRailWidth={sideRailWidth} className={className} />;
}

/** A phone: the tab bar over the home and its pages, the views in a session */
function PhoneBar({ className }: { className?: string }) {
  const surface = useSurface();
  return surface === "session" || surface === "beside" ? (
    <HBar className={className} />
  ) : (
    <TabBar className={className} />
  );
}

function Column({
  sideRailWidth,
  className,
}: {
  sideRailWidth?: number;
  className?: string;
}) {
  const native = useIsNative();
  const sideRail = !!sideRailWidth;
  const keyboardUp = useKeyboardUp(sideRail);
  const { items } = useColumn(keyboardUp, native);
  const top = keyboardUp ? SIDE_RAIL_TOP_KEYBOARD : SIDE_RAIL_TOP;

  // Stay above a docked keyboard: it covers the system column too
  const [maxHeight, setMaxHeight] = useState<number | undefined>();
  useEffect(() => {
    const vv = window.visualViewport;
    if (!sideRail || !vv) return;
    const update = () => setMaxHeight(Math.max(120, vv.height - top - 8));
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, [sideRail, top]);

  if (!items.length) return null;

  return (
    <nav
      aria-label="Main"
      className={cn(
        "glass flex shrink-0 flex-col items-center gap-0.5 rounded-[30px] p-[5px]",
        // Scrolling would clip the hover hints, so only the Duo's needs it
        sideRail && "fixed z-40 overflow-y-auto",
        className
      )}
      style={{
        width: COLUMN_WIDTH,
        ...(sideRail && {
          top,
          right: Math.max(0, (sideRailWidth - COLUMN_WIDTH) / 2),
          maxHeight,
        }),
      }}
    >
      <ColumnItems items={items} orientation="vertical" />
    </nav>
  );
}
