"use client";

import { useSnapshot } from "valtio";
import { toast } from "sonner";
import {
  ChevronLeft,
  MoreHorizontal,
  Users,
  GitBranch,
  SquareTerminal,
  Copy,
  Unplug,
  Plus,
  SplitSquareHorizontal,
  SplitSquareVertical,
  X,
  Settings,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Session, Project } from "@/lib/db";
import type { PaneViewMode } from "@/stores/mobileNav";
import { mobileNavStore } from "@/stores/mobileNav";
import { duoPreviewStore } from "@/stores/duoPreview";
import { runNav } from "@/lib/nav-actions";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useIsNative } from "@/hooks/useIsNative";
import {
  STATE_TEXT_CLASS,
  STATE_WORD,
  fromSessionStatus,
} from "@/lib/agent-state";

interface SessionTitleBarProps {
  session: Session | null | undefined;
  projects: Project[];
  /** What a tab without a session shows instead (its tmux name) */
  fallbackTitle?: string | null;
  isMobile: boolean;
  isFocused: boolean;
  viewMode: PaneViewMode;
  workerCount: number;
  onViewModeChange: (mode: PaneViewMode) => void;
  hasAttachedTmux: boolean;
  onDetach: () => void;
  // The wide layout's drawers and pane controls
  gitDrawerOpen?: boolean;
  shellDrawerOpen?: boolean;
  canSplit?: boolean;
  canClose?: boolean;
  onGitDrawerToggle?: () => void;
  onShellDrawerToggle?: () => void;
  onTabAdd?: () => void;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onClose?: () => void;
}

// The buttons look 36px but take a 44pt touch
const TOUCH_TARGET =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-1 pointer-coarse:after:content-['']";

/**
 * The session's header: back, its title and a crumb, and ⋯. Views switch
 * from the control column, so nothing here changes what the pane shows
 * except the less used ones (Workers, the drawers).
 */
export function SessionTitleBar({
  session,
  projects,
  fallbackTitle,
  isMobile,
  isFocused,
  viewMode,
  workerCount,
  onViewModeChange,
  hasAttachedTmux,
  onDetach,
  gitDrawerOpen,
  shellDrawerOpen,
  canSplit,
  canClose,
  onGitDrawerToggle,
  onShellDrawerToggle,
  onTabAdd,
  onSplitHorizontal,
  onSplitVertical,
  onClose,
}: SessionTitleBarProps) {
  const native = useIsNative();
  const { statuses, railActive, railWidth } = useSnapshot(mobileNavStore);
  // The iOS app's closed-screen trial: a bigger title, as a page has
  const { on: duoPreview } = useSnapshot(duoPreviewStore);
  const pageTitle = duoPreview && railActive && isMobile;
  const titles = useListTitles(session ? [session] : []);
  const { copy } = useCopyToClipboard();

  const { title, idLabel } = session
    ? displayTitle(session, titles)
    : { title: fallbackTitle || "No session", idLabel: undefined };
  const projectName = session?.project_id
    ? projects.find((p) => p.id === session.project_id)?.name
    : null;
  const state = session
    ? fromSessionStatus(statuses[session.id]?.status ?? "idle")
    : null;
  const crumb = [
    projectName && projectName !== "Uncategorized" ? projectName : null,
    idLabel,
  ].filter(Boolean);

  const wide = !isMobile;
  const hasFolder = !!session?.working_directory;
  // Plain phones get the column as a bottom bar, which has no room for it
  const settingsHere = isMobile && !native && railWidth === 0;

  return (
    <div
      className={cn(
        "native-top-inset kb-compact-hide border-border/60 bg-background flex items-center gap-1.5 border-b py-1.5 pr-[calc(0.5rem+var(--safe-right,env(safe-area-inset-right)))] pl-[calc(0.25rem+env(safe-area-inset-left))]",
        wide && !isFocused && "opacity-70"
      )}
    >
      <button
        type="button"
        onClick={() => runNav("sessions")}
        aria-label="Sessions"
        className={cn(
          "text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
          TOUCH_TARGET
        )}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "truncate leading-tight font-semibold",
            pageTitle ? "text-xl font-bold" : "text-[15px]"
          )}
        >
          {title}
        </span>
        {state && (
          <span className="text-muted-foreground truncate text-xs leading-tight">
            {crumb.map((part) => `${part} · `)}
            <span className={STATE_TEXT_CLASS[state]}>{STATE_WORD[state]}</span>
          </span>
        )}
      </div>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More"
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
              TOUCH_TARGET
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px]">
          {workerCount > 0 && (
            <DropdownMenuItem
              onSelect={() =>
                onViewModeChange(
                  viewMode === "workers" ? "terminal" : "workers"
                )
              }
            >
              <Users className="h-4 w-4" />
              <span className="flex-1">
                {viewMode === "workers" ? "Hide workers" : "Workers"}
              </span>
              <span className="text-muted-foreground text-xs">
                {workerCount}
              </span>
            </DropdownMenuItem>
          )}
          {/* Changes is a view too; the drawer keeps it beside the others */}
          {wide && !native && hasFolder && onGitDrawerToggle && (
            <DropdownMenuItem onSelect={onGitDrawerToggle}>
              <GitBranch className="h-4 w-4" />
              {gitDrawerOpen ? "Hide changes drawer" : "Changes drawer"}
            </DropdownMenuItem>
          )}
          {wide && hasFolder && onShellDrawerToggle && (
            <DropdownMenuItem onSelect={onShellDrawerToggle}>
              <SquareTerminal className="h-4 w-4" />
              {shellDrawerOpen ? "Hide shell drawer" : "Shell drawer"}
            </DropdownMenuItem>
          )}
          {session && (
            <DropdownMenuItem
              onSelect={async () => {
                if (await copy(session.id)) toast.success("Session ID copied");
                else toast.error("Couldn't copy the session ID");
              }}
            >
              <Copy className="h-4 w-4" />
              Copy session ID
            </DropdownMenuItem>
          )}
          {hasAttachedTmux && (
            <DropdownMenuItem onSelect={onDetach}>
              <Unplug className="h-4 w-4" />
              Detach from tmux
            </DropdownMenuItem>
          )}
          {wide && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onTabAdd}>
                <Plus className="h-4 w-4" />
                New tab
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canSplit}
                onSelect={onSplitHorizontal}
              >
                <SplitSquareHorizontal className="h-4 w-4" />
                Split horizontal
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canSplit} onSelect={onSplitVertical}>
                <SplitSquareVertical className="h-4 w-4" />
                Split vertical
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canClose} onSelect={onClose}>
                <X className="h-4 w-4" />
                Close pane
              </DropdownMenuItem>
            </>
          )}
          {settingsHere && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => runNav("settings")}>
                <Settings className="h-4 w-4" />
                Settings
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
