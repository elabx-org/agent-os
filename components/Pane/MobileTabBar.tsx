"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Menu,
  ChevronLeft,
  ChevronRight,
  Terminal as TerminalIcon,
  FolderOpen,
  GitBranch,
  Users,
  ChevronDown,
  Circle,
  Inbox,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Session, Project } from "@/lib/db";
import type { LucideIcon } from "lucide-react";
import { useSnapshot } from "valtio";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { duoPreviewStore } from "@/stores/duoPreview";
import type { SessionStatus } from "@/components/views/types";

const STATUS_STRIP: Record<
  SessionStatus["status"],
  { word: string; dot: string }
> = {
  running: { word: "Working", dot: "bg-blue-400 ring-4 ring-blue-400/20" },
  waiting: { word: "Needs you", dot: "bg-amber-400 ring-4 ring-amber-400/20" },
  error: { word: "Error", dot: "bg-red-400" },
  idle: { word: "Idle", dot: "bg-muted-foreground" },
  dead: { word: "Stopped", dot: "bg-muted-foreground/50" },
};

type ViewMode = "terminal" | "chat" | "files" | "git" | "workers";

interface ViewModeButtonProps {
  mode: ViewMode;
  currentMode: ViewMode;
  icon: LucideIcon;
  onClick: (mode: ViewMode) => void;
  badge?: React.ReactNode;
}

function ViewModeButton({
  mode,
  currentMode,
  icon: Icon,
  onClick,
  badge,
}: ViewModeButtonProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(mode);
      }}
      className={cn(
        "rounded p-1.5 transition-colors",
        badge && "flex items-center gap-0.5",
        currentMode === mode
          ? "bg-secondary text-foreground"
          : "text-muted-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {badge}
    </button>
  );
}

interface MobileTabBarProps {
  session: Session | null | undefined;
  sessions: Session[];
  projects: Project[];
  viewMode: ViewMode;
  isConductor: boolean;
  workerCount: number;
  onMenuClick?: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onSelectSession?: (sessionId: string) => void;
}

export function MobileTabBar({
  session,
  sessions,
  projects,
  viewMode,
  isConductor,
  workerCount,
  onMenuClick,
  onViewModeChange,
  onSelectSession,
}: MobileTabBarProps) {
  const { railActive, statuses } = useSnapshot(mobileNavStore);
  // In the iOS app's trial layout the title is part of the page: no band, no
  // arrows (swipe the terminal sideways for the next session)
  const { on: duoPreview } = useSnapshot(duoPreviewStore);
  const pageTitle = duoPreview && railActive;
  const waitingCount = Object.values(statuses).filter(
    (s) => s.status === "waiting"
  ).length;
  const status = session
    ? STATUS_STRIP[statuses[session.id]?.status ?? "idle"]
    : null;

  // Find current session index and calculate prev/next
  const currentIndex = session
    ? sessions.findIndex((s) => s.id === session.id)
    : -1;

  // Get project name for current session
  const projectName = session?.project_id
    ? projects.find((p) => p.id === session.project_id)?.name
    : null;
  const hasProject = !!projectName && projectName !== "Uncategorized";
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < sessions.length - 1;

  // Debounce to prevent rapid clicking causing command interference
  const [isNavigating, setIsNavigating] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const handleNavigate = useCallback(
    (sessionId: string) => {
      if (isNavigating || !onSelectSession) return;

      setIsNavigating(true);
      onSelectSession(sessionId);

      // Allow next navigation after delay (tmux commands need time)
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setIsNavigating(false);
      }, 500);
    },
    [isNavigating, onSelectSession]
  );

  const handlePrev = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasPrev && !isNavigating) {
      handleNavigate(sessions[currentIndex - 1].id);
    }
  };

  const handleNext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasNext && !isNavigating) {
      handleNavigate(sessions[currentIndex + 1].id);
    }
  };

  return (
    <div
      className={cn(
        "native-top-inset kb-compact-hide flex items-center gap-2 py-1.5 pr-[calc(0.5rem+var(--safe-right,env(safe-area-inset-right)))] pl-[calc(0.5rem+env(safe-area-inset-left))]",
        pageTitle
          ? "bg-background pl-[calc(0.75rem+env(safe-area-inset-left))]"
          : "bg-muted"
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Menu button */}
      {onMenuClick && !railActive && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            onMenuClick();
          }}
          className="h-8 w-8 shrink-0"
        >
          <Menu className="h-4 w-4" />
        </Button>
      )}

      {/* Session/Tab navigation */}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <button
          type="button"
          onClick={handlePrev}
          disabled={!hasPrev || isNavigating}
          aria-label="Previous session"
          className={cn(
            "hover:bg-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:pointer-events-none disabled:opacity-50",
            pageTitle && "hidden"
          )}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Session selector dropdown */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            {pageTitle ? (
              <button
                type="button"
                className="active:bg-accent flex min-h-11 min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg px-1 py-1 text-left"
              >
                <span className="flex max-w-full min-w-0 items-center gap-1.5">
                  <span className="truncate text-xl leading-tight font-bold">
                    {(hasProject ? projectName : session?.name) || "No session"}
                  </span>
                  <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
                </span>
                {session && status && (
                  <span className="text-muted-foreground flex max-w-full min-w-0 items-center gap-1.5 text-xs leading-tight">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        status.dot
                      )}
                    />
                    <span className="truncate">
                      {status.word}
                      {hasProject && ` · ${session.name}`}
                      {currentIndex >= 0 &&
                        sessions.length > 1 &&
                        ` · ${currentIndex + 1} of ${sessions.length}`}
                    </span>
                  </span>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="hover:bg-accent active:bg-accent flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1 text-left"
              >
                {status && (
                  <span
                    aria-hidden="true"
                    className={cn("h-2 w-2 shrink-0 rounded-full", status.dot)}
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm leading-tight font-semibold">
                    {(hasProject ? projectName : session?.name) || "No session"}
                  </span>
                  {session && status && (
                    <span className="text-muted-foreground truncate text-xs leading-tight">
                      {hasProject
                        ? `${session.name} · ${status.word}`
                        : status.word}
                    </span>
                  )}
                </span>
                <ChevronDown className="text-muted-foreground h-3 w-3 shrink-0" />
              </button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            className="max-h-[300px] min-w-[200px] overflow-y-auto"
          >
            {sessions
              .filter((s) => !s.conductor_session_id)
              .map((s) => {
                const sessionProject = s.project_id
                  ? projects.find((p) => p.id === s.project_id)
                  : null;
                const isActive = s.id === session?.id;

                return (
                  <DropdownMenuItem
                    key={s.id}
                    onSelect={() => onSelectSession?.(s.id)}
                    className={cn(
                      "flex items-center gap-2",
                      isActive && "bg-accent"
                    )}
                  >
                    <Circle
                      className={cn(
                        "h-2 w-2",
                        isActive
                          ? "fill-primary text-primary"
                          : "text-muted-foreground"
                      )}
                    />
                    <span className="flex-1 truncate">{s.name}</span>
                    {sessionProject &&
                      sessionProject.name !== "Uncategorized" && (
                        <span className="text-muted-foreground text-xs">
                          [{sessionProject.name}]
                        </span>
                      )}
                  </DropdownMenuItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={handleNext}
          disabled={!hasNext || isNavigating}
          aria-label="Next session"
          className={cn(
            "hover:bg-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:pointer-events-none disabled:opacity-50",
            pageTitle && "hidden"
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Inbox: the rail carries it when shown */}
      {!railActive && waitingCount > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            mobileNavActions.setInboxOpen(true);
          }}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-amber-400/15 px-2.5 text-xs font-semibold text-amber-400"
          aria-label={`Inbox, ${waitingCount} waiting`}
        >
          <Inbox className="h-3.5 w-3.5" />
          {waitingCount}
        </button>
      )}

      {/* View mode toggle */}
      {session?.working_directory && !railActive && (
        <div className="bg-accent/50 flex shrink-0 items-center rounded-md p-0.5">
          <ViewModeButton
            mode="terminal"
            currentMode={viewMode}
            icon={TerminalIcon}
            onClick={onViewModeChange}
          />
          <ViewModeButton
            mode="chat"
            currentMode={viewMode}
            icon={MessageSquare}
            onClick={onViewModeChange}
          />
          <ViewModeButton
            mode="files"
            currentMode={viewMode}
            icon={FolderOpen}
            onClick={onViewModeChange}
          />
          <ViewModeButton
            mode="git"
            currentMode={viewMode}
            icon={GitBranch}
            onClick={onViewModeChange}
          />
          {isConductor && (
            <ViewModeButton
              mode="workers"
              currentMode={viewMode}
              icon={Users}
              onClick={onViewModeChange}
              badge={
                <span className="bg-primary/20 text-primary rounded px-1 text-[10px]">
                  {workerCount}
                </span>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
