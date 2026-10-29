"use client";

import { useRef } from "react";
import { flushSync } from "react-dom";
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
  Maximize2,
  Minimize2,
  ArrowLeftRight,
  Columns2,
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
import { focusStore } from "@/stores/focus";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useIsNative } from "@/hooks/useIsNative";
import { usePanes } from "@/contexts/PaneContext";
import { BesideItems } from "@/components/BesideItems";
import { useReplyPage } from "@/components/ReplyContext/store";
import {
  STATE_DOT_CLASS,
  STATE_TEXT_CLASS,
  STATE_WORD,
  fromSessionStatus,
  type AgentState,
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

// The box to type into that the pane shows now: a composer, else the
// terminal's own textarea (a hidden tab's or view's has no box)
function visibleInput(pane: Element): HTMLTextAreaElement | null {
  const shown = [...pane.querySelectorAll("textarea")].filter(
    (el) =>
      el.getClientRects().length > 0 && el.getAttribute("inputmode") !== "none"
  );
  return (
    shown.find((el) => !el.classList.contains("xterm-helper-textarea")) ??
    shown[0] ??
    null
  );
}

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
  const { statuses, railActive, railWidth, nativeKeyboard } =
    useSnapshot(mobileNavStore);
  // The iOS app's closed-screen trial: a bigger title, as a page has
  const { on: duoPreview } = useSnapshot(duoPreviewStore);
  const focus = useSnapshot(focusStore);
  const { paneCount, canSplitDown } = usePanes();
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

  // Typing with the keyboard up swaps the header for one slim line. The web
  // marks a short docked keyboard on <html> (useKeyboardInset); the iOS app
  // reports its keyboard instead.
  const nativeTyping = native && nativeKeyboard;
  // The open Duo's right page answers the turn on the left one
  const replyPage = useReplyPage(session?.id);
  const slimRef = useRef<HTMLDivElement>(null);
  const peek =
    session && (viewMode === "terminal" || viewMode === "chat")
      ? viewMode
      : null;
  // Switch in the tap itself and focus the other view's box there, so the
  // keyboard stays up and the shared draft carries on where it was
  const peekTo = (mode: "terminal" | "chat") => {
    if (mode === viewMode) return;
    flushSync(() => onViewModeChange(mode));
    const pane = slimRef.current?.parentElement;
    const input = pane && visibleInput(pane);
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  };

  return (
    <>
      <div
        ref={slimRef}
        className={cn(
          "border-border/60 bg-background shrink-0 border-b pr-[calc(0.5rem+var(--safe-right,env(safe-area-inset-right)))] pl-[calc(0.75rem+env(safe-area-inset-left))] [html[data-native]_&]:pt-[env(safe-area-inset-top)]",
          nativeTyping
            ? "block"
            : "hidden [html[data-keyboard-compact]_&]:block"
        )}
      >
        <div className="flex h-[26px] items-center gap-1.5 text-[12.5px]">
          {state && (
            <span
              role="img"
              aria-label={STATE_WORD[state]}
              className={cn(
                "h-[7px] w-[7px] shrink-0 rounded-full",
                STATE_DOT_CLASS[state]
              )}
            />
          )}
          {replyPage && (
            <span className="text-muted-foreground shrink-0 text-[10px] font-medium tracking-[0.08em] uppercase">
              Your reply ·
            </span>
          )}
          <span className="min-w-0 truncate font-semibold">{title}</span>
          {idLabel && !replyPage && (
            <span className="text-muted-foreground shrink-0">· {idLabel}</span>
          )}
          {peek && (
            <div
              role="group"
              aria-label="View"
              className="bg-secondary ml-auto flex shrink-0 gap-0.5 rounded-lg p-0.5 text-[11px]"
            >
              {(["terminal", "chat"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={peek === mode}
                  // Keep the box focused so the keyboard doesn't drop first
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => peekTo(mode)}
                  className={cn(
                    "relative rounded-md px-2 py-0.5 leading-4 after:absolute after:-inset-x-0.5 after:-inset-y-3 after:content-['']",
                    peek === mode
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {mode === "terminal" ? "Terminal" : "Chat"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div
        className={cn(
          "native-top-inset kb-compact-hide border-border/60 bg-background flex items-center gap-1.5 border-b py-1.5 pr-[calc(0.5rem+var(--safe-right,env(safe-area-inset-right)))] pl-[calc(0.25rem+env(safe-area-inset-left))]",
          wide && !isFocused && "opacity-70",
          nativeTyping && "hidden"
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
              <span className={STATE_TEXT_CLASS[state]}>
                {STATE_WORD[state]}
              </span>
            </span>
          )}
        </div>

        {session && (
          <button
            type="button"
            onClick={() => runNav("focus")}
            aria-label={focus.on ? "Leave Focus" : "Focus"}
            aria-pressed={focus.on}
            className={cn(
              "hover:bg-accent hover:text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
              focus.on ? "text-primary" : "text-muted-foreground",
              TOUCH_TARGET
            )}
          >
            {focus.on ? (
              <Minimize2 className="h-[18px] w-[18px]" />
            ) : (
              <Maximize2 className="h-[18px] w-[18px]" />
            )}
          </button>
        )}
        {/* Two side by side on the open Duo: trade pages */}
        {native && wide && paneCount === 2 && (
          <button
            type="button"
            onClick={() => runNav("swap")}
            aria-label="Swap sides"
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
              TOUCH_TARGET
            )}
          >
            <ArrowLeftRight className="h-[18px] w-[18px]" />
          </button>
        )}
        {wide && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Split"
                className={cn(
                  "text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                  TOUCH_TARGET
                )}
              >
                <Columns2 className="h-[18px] w-[18px]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[260px]">
              <BesideItems exclude={session ? [session.id] : undefined} />
              {!native && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!canSplit}
                    onSelect={onSplitHorizontal}
                  >
                    <SplitSquareHorizontal className="h-4 w-4" />
                    Split right
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canSplitDown}
                    onSelect={onSplitVertical}
                  >
                    <SplitSquareVertical className="h-4 w-4" />
                    Split down
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {wide && paneCount > 1 && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close this side"
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
              TOUCH_TARGET
            )}
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        )}

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
                  if (await copy(session.id))
                    toast.success("Session ID copied");
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
    </>
  );
}
