"use client";

import { cn } from "@/lib/utils";
import { runNav } from "@/lib/nav-actions";
import { useIsNative } from "@/hooks/useIsNative";
import { ItemBadge } from "./ColumnItem";
import { columnIcon } from "./icons";
import { useColumn } from "./columnState";
import { useKeyboardUp } from "./useKeyboardUp";
import { useBarHeight } from "./barHeight";

/** About 28px off the screen's edge on an iPhone, clear of the home indicator */
const BOTTOM = "max(16px, calc(env(safe-area-inset-bottom) - 6px))";
/** The 64px capsule and a gap above it */
const TAB_BAR_HEIGHT = 72;

/**
 * A regular iPhone in Safari (E-iPhone): a glass capsule of Now · Needs you
 * · Projects · Find · Settings (64px, radius 32) and a separate 64px New
 * button. Hidden while the keyboard is up; sets --control-bar-h for the
 * layers above.
 */
export function TabBar({ className }: { className?: string }) {
  const native = useIsNative();
  const keyboardUp = useKeyboardUp(true);
  const { items } = useColumn(keyboardUp, native);
  const shown = !keyboardUp && items.length > 0;
  useBarHeight(shown ? `calc(${TAB_BAR_HEIGHT}px + ${BOTTOM})` : null, false);
  if (!shown) return null;

  const tabs = items.filter((item) => !item.prominent);
  const fab = items.find((item) => item.prominent);
  const FabIcon = fab && columnIcon(fab.icon);
  return (
    <div
      data-control-column
      className={cn(
        "fixed right-[calc(16px+env(safe-area-inset-right))] left-[calc(16px+env(safe-area-inset-left))] z-50 flex items-center gap-2.5",
        className
      )}
      style={{ bottom: BOTTOM }}
    >
      <nav
        aria-label="Sections"
        className="glass flex h-[64px] min-w-0 flex-1 items-center rounded-[32px] px-[5px]"
      >
        {tabs.map((tab) => {
          const Icon = columnIcon(tab.icon);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => runNav(tab.id)}
              aria-current={tab.selected ? "page" : undefined}
              aria-label={
                tab.badge ? `${tab.label}, ${tab.badge} waiting` : undefined
              }
              className={cn(
                "relative flex h-[54px] min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-[27px] text-[10px] font-semibold outline-none",
                "focus-visible:ring-ring focus-visible:ring-2",
                tab.selected
                  ? "text-foreground bg-black/8 dark:bg-white/14"
                  : "text-foreground/75"
              )}
            >
              <Icon aria-hidden className="h-5 w-5" strokeWidth={1.9} />
              {/* Five don't fit their names in an iPad split to 320 */}
              <span className="max-w-full truncate max-[359px]:sr-only">
                {tab.label}
              </span>
              {!!tab.badge && (
                <ItemBadge
                  count={tab.badge}
                  tone={tab.badgeTone}
                  className="absolute top-1 right-3.5"
                />
              )}
            </button>
          );
        })}
      </nav>
      {fab && FabIcon && (
        <button
          type="button"
          onClick={() => runNav(fab.id)}
          aria-label={fab.label}
          className="bg-primary text-primary-foreground focus-visible:ring-ring flex h-[64px] w-[64px] shrink-0 touch-manipulation items-center justify-center rounded-full outline-none focus-visible:ring-2 active:opacity-80"
        >
          <FabIcon aria-hidden className="h-6 w-6" strokeWidth={1.9} />
        </button>
      )}
    </div>
  );
}
