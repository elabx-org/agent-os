"use client";

import { useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import {
  FolderOpen,
  GitBranch,
  Inbox,
  Plus,
  Search,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";

const RAIL_WIDTH = 56;
/** Clear of the camera and the clock/status glyphs at the top of the column */
const RAIL_TOP = 136;

interface RailButtonProps {
  icon: LucideIcon;
  label: string;
  selected?: boolean;
  badge?: number;
  ariaLabel?: string;
  onClick: () => void;
}

function RailButton({
  icon: Icon,
  label,
  selected,
  badge,
  ariaLabel,
  onClick,
}: RailButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "relative flex h-[52px] w-[52px] touch-manipulation flex-col items-center justify-center gap-[3px] rounded-2xl text-[10px] leading-none font-medium",
        selected
          ? "bg-accent text-foreground"
          : "text-muted-foreground active:bg-accent/60"
      )}
    >
      <Icon className="h-5 w-5" strokeWidth={1.8} />
      {label}
      {!!badge && (
        <span className="absolute top-1 right-1.5 h-4 min-w-4 rounded-full bg-amber-400 px-1 text-center text-[10px] leading-4 font-semibold text-amber-950">
          {badge}
        </span>
      )}
    </button>
  );
}

interface NavRailProps {
  /** Width of the right-hand column the rail is centred in */
  columnWidth: number;
  waitingCount: number;
  onInbox: () => void;
  onSessions: () => void;
  onFind: () => void;
  onNewSession: () => void;
}

/**
 * Vertical nav in the iPhone Duo outer display's right-hand system column,
 * under the status glyphs where the right thumb rests.
 */
export function NavRail({
  columnWidth,
  waitingCount,
  onInbox,
  onSessions,
  onFind,
  onNewSession,
}: NavRailProps) {
  const { viewMode } = useSnapshot(mobileNavStore);

  // Stay above a docked keyboard: it covers the system column too
  const [maxHeight, setMaxHeight] = useState<number | undefined>();
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setMaxHeight(Math.max(120, vv.height - RAIL_TOP - 8));
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);

  return (
    <nav
      aria-label="Main"
      className="bg-card border-border fixed z-40 flex flex-col items-center gap-0.5 overflow-y-auto rounded-[28px] border px-0.5 py-1"
      style={{
        top: RAIL_TOP,
        right: Math.max(0, (columnWidth - RAIL_WIDTH) / 2),
        width: RAIL_WIDTH,
        maxHeight,
      }}
    >
      <RailButton
        icon={Inbox}
        label="Inbox"
        badge={waitingCount}
        ariaLabel={
          waitingCount
            ? `Inbox, ${waitingCount} waiting`
            : "Inbox, nothing waiting"
        }
        onClick={onInbox}
      />
      <RailButton
        icon={SquareTerminal}
        label="Session"
        selected={viewMode === "terminal"}
        ariaLabel="Session (tap again for all sessions)"
        onClick={() =>
          viewMode === "terminal"
            ? onSessions()
            : mobileNavActions.requestViewMode("terminal")
        }
      />
      <RailButton
        icon={GitBranch}
        label="Changes"
        selected={viewMode === "git"}
        onClick={() => mobileNavActions.requestViewMode("git")}
      />
      <RailButton
        icon={FolderOpen}
        label="Files"
        selected={viewMode === "files"}
        onClick={() => mobileNavActions.requestViewMode("files")}
      />
      <RailButton icon={Search} label="Find" onClick={onFind} />
      <RailButton
        icon={Plus}
        label="New"
        ariaLabel="New session"
        onClick={onNewSession}
      />
    </nav>
  );
}
