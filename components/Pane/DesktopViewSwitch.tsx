"use client";

import { Activity } from "lucide-react";
import { useSnapshot } from "valtio";
import { cn } from "@/lib/utils";
import { runNav } from "@/lib/nav-actions";
import { mobileNavStore, type PaneViewMode } from "@/stores/mobileNav";

const VIEWS: { mode: PaneViewMode; label: string }[] = [
  { mode: "chat", label: "Chat" },
  { mode: "terminal", label: "Terminal" },
  { mode: "git", label: "Changes" },
  { mode: "files", label: "Files" },
];

/**
 * The desktop shell has no control column: its views switch here, as
 * Desk-Chat's Chat | Terminal | Changes segment, and Live activity opens
 * from here whenever the rail is off (two panes, a narrow window)
 */
export function DesktopViewSwitch({
  viewMode,
  onViewModeChange,
}: {
  viewMode: PaneViewMode;
  onViewModeChange: (mode: PaneViewMode) => void;
}) {
  const { railShown, liveOpen } = useSnapshot(mobileNavStore);
  return (
    <>
      <div
        role="group"
        aria-label="View"
        className="seg bg-card shrink-0 @max-[560px]/bar:hidden"
      >
        {VIEWS.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            aria-pressed={viewMode === mode}
            onClick={() => onViewModeChange(mode)}
            className="hover:text-foreground"
          >
            {label}
          </button>
        ))}
      </div>
      {!railShown && (
        <button
          type="button"
          onClick={() => runNav("live")}
          aria-label="Live activity"
          aria-pressed={liveOpen}
          title="Live activity"
          className={cn(
            "hover:bg-accent hover:text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            liveOpen ? "text-primary" : "text-muted-foreground"
          )}
        >
          <Activity className="h-[18px] w-[18px]" />
        </button>
      )}
    </>
  );
}
