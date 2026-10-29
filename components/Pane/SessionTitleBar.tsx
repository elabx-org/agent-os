"use client";

import { useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import { useSnapshot } from "valtio";
import { toast } from "sonner";
import {
  ChevronLeft,
  MoreHorizontal,
  Workflow,
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
  FolderOpen,
  Activity,
  MessageSquare,
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
import { besidePills, useSpreadPanes } from "@/components/views/SessionSpread";
import { usePanes } from "@/contexts/PaneContext";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { DesktopLiveButton } from "./DesktopViewSwitch";
import { BesideItems } from "@/components/BesideItems";
import { useReplyPage } from "@/components/ReplyContext/store";
import {
  STATE_DOT_CLASS,
  STATE_TEXT_CLASS,
  STATE_WORD,
  sessionState,
} from "@/lib/agent-state";
import { useGitStatus } from "@/data/git/queries";
import {
  Crumb,
  DesktopHeader,
  FoldHeader,
  PageHeader,
  PaneCardHeader,
  type HeaderInfo,
} from "@/components/Session/SessionHeader";
import { addedLines } from "@/components/Session/activity-format";
import { headerVariant } from "@/lib/session-views";
import {
  PermissionChip,
  PermissionMenuItem,
} from "@/components/Session/PermissionChip";
import { PermissionSheetHost } from "@/components/Session/PermissionSheet";

interface SessionTitleBarProps {
  session: Session | null | undefined;
  projects: Project[];
  /** What a tab without a session shows instead (its tmux name) */
  fallbackTitle?: string | null;
  isMobile: boolean;
  isFocused: boolean;
  viewMode: PaneViewMode;
  /** Agents the session started: the ⋯ menu's Agents item */
  agentCount: number;
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
 * except the less used ones (Agents, the drawers). The desktop shell has
 * no column: there the views switch here.
 */
export function SessionTitleBar({
  session,
  projects,
  fallbackTitle,
  isMobile,
  isFocused,
  viewMode,
  agentCount,
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
  // The title in the page (the default); off, the classic header band
  const { on: duoPreview } = useSnapshot(duoPreviewStore);
  const focus = useSnapshot(focusStore);
  const { paneCount, canSplitDown } = usePanes();
  // Open-Beside: the session pill above names the page and the column holds
  // the actions, so this bar steps aside
  const pilled =
    useSpreadPanes()?.mode === "fold" && !!session && besidePills();
  const titles = useListTitles(session ? [session] : []);
  const { copy } = useCopyToClipboard();

  const { title, idLabel } = session
    ? displayTitle(session, titles)
    : { title: fallbackTitle || "No session", idLabel: undefined };
  const projectName = session?.project_id
    ? projects.find((p) => p.id === session.project_id)?.name
    : null;
  const state = session
    ? sessionState(session, statuses[session.id]?.status)
    : null;
  const crumb = [
    projectName && projectName !== "Uncategorized" ? projectName : null,
    idLabel,
  ].filter(Boolean);

  const wide = !isMobile;
  // The desktop shell has no column, so its views switch in this bar
  const layout = useLayoutMode();
  const hasFolder = !!session?.working_directory;
  // Plain phones get the column as a bottom bar, which has no room for it
  const settingsHere = isMobile && !native && railWidth === 0;

  const variant = headerVariant({
    hasSession: !!session,
    layout,
    native,
    paneCount,
    titleInPage: duoPreview,
    columnShown: railActive,
  });
  const info: HeaderInfo | null =
    session && state
      ? {
          session,
          title,
          project:
            projectName && projectName !== "Uncategorized" ? projectName : null,
          state,
        }
      : null;
  // Desk-Chat's "Changes +59" and branch, from the folder's shared poll
  const { data: git } = useGitStatus(session?.working_directory ?? "", {
    enabled: variant === "desktop",
  });
  const added = useMemo(
    () =>
      git ? addedLines([...git.staged, ...git.unstaged, ...git.untracked]) : 0,
    [git]
  );

  // Typing with the keyboard up swaps the header for one slim line. The web
  // marks a short docked keyboard on <html> (useKeyboardInset); the iOS app
  // reports its keyboard instead.
  const nativeTyping = native && nativeKeyboard;
  // The open Duo's right page answers the turn on the left one
  const replyPage = useReplyPage(session?.id);
  const slimRef = useRef<HTMLDivElement>(null);
  const pageSlim = variant === "page" || variant === "large";
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

  const iconButton = cn(
    "text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
    TOUCH_TARGET
  );
  // The new headers keep Focus, Files and Changes here; their segments
  // show Chat and Terminal (the desktop's Changes too)
  const newHeader = variant !== "classic";
  // N-PermMode's chip sits by the title in the page and on the desktop bar
  const chipInHeader =
    !!info &&
    (variant === "desktop" || variant === "page" || variant === "large");

  const besideMenu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {variant === "desktop" ? (
          <button
            type="button"
            className="pill pill-secondary pill-sm data-[state=open]:bg-accent shrink-0"
          >
            <Columns2 aria-hidden className="h-4 w-4" />
            <span className="@max-[760px]/bar:hidden">Open beside</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label="Split"
            className={cn(iconButton, "data-[state=open]:bg-accent")}
          >
            <Columns2 className="h-[18px] w-[18px]" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[260px]">
        <BesideItems exclude={session ? [session.id] : undefined} />
        {!native && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!canSplit} onSelect={onSplitHorizontal}>
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
  );

  const moreMenu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More"
          className={cn(
            iconButton,
            "data-[state=open]:bg-accent",
            newHeader && "rounded-full"
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        {/* The headers without the shield chip reach the sheet here */}
        {session && !chipInHeader && (
          <PermissionMenuItem session={session} separator />
        )}
        {newHeader && session && (
          <>
            {variant !== "desktop" && hasFolder && (
              <DropdownMenuItem onSelect={() => onViewModeChange("git")}>
                <GitBranch className="h-4 w-4" />
                Changes
              </DropdownMenuItem>
            )}
            {hasFolder && (
              <DropdownMenuItem onSelect={() => onViewModeChange("files")}>
                <FolderOpen className="h-4 w-4" />
                Files
              </DropdownMenuItem>
            )}
            {variant !== "fold" && (
              <DropdownMenuItem onSelect={() => runNav("focus")}>
                {focus.on ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
                {focus.on ? "Leave Focus" : "Focus"}
              </DropdownMenuItem>
            )}
            {variant === "card" && (
              <>
                {/* No rail beside two panes, nor a strip under them */}
                <DropdownMenuItem onSelect={() => runNav("live")}>
                  <Activity className="h-4 w-4" />
                  Live activity
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => runNav("beside")}>
                  <Columns2 className="h-4 w-4" />
                  Open beside
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        {/* A plain phone has no column: its views are reached from here */}
        {!newHeader && layout === "phone" && session && hasFolder && (
          <>
            {(viewMode === "git" || viewMode === "files") && (
              <DropdownMenuItem
                onSelect={() =>
                  onViewModeChange(mobileNavStore.conversationView)
                }
              >
                <MessageSquare className="h-4 w-4" />
                Back to session
              </DropdownMenuItem>
            )}
            {viewMode !== "git" && (
              <DropdownMenuItem onSelect={() => onViewModeChange("git")}>
                <GitBranch className="h-4 w-4" />
                Changes
              </DropdownMenuItem>
            )}
            {viewMode !== "files" && (
              <DropdownMenuItem onSelect={() => onViewModeChange("files")}>
                <FolderOpen className="h-4 w-4" />
                Files
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        {(agentCount > 0 || viewMode === "agents") && (
          <DropdownMenuItem
            onSelect={() =>
              onViewModeChange(
                viewMode === "agents"
                  ? mobileNavStore.conversationView
                  : "agents"
              )
            }
          >
            <Workflow className="h-4 w-4" />
            <span className="flex-1">
              {viewMode === "agents" ? "Hide agents" : "Agents"}
            </span>
            {agentCount > 0 && (
              <span className="text-muted-foreground text-xs">
                {agentCount}
              </span>
            )}
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
  );

  // Hidden while typing (the slim line stands in) and beside the pills;
  // the agents view names the session in its own header (N-Tree, O-Tree)
  const hidden =
    nativeTyping ||
    pilled ||
    (viewMode === "agents" && (variant === "page" || variant === "large"));
  let header: React.ReactNode;
  if (info && variant === "desktop")
    header = (
      <div className={cn(hidden && "hidden")}>
        <DesktopHeader
          info={info}
          branch={git?.branch ?? session?.branch_name}
          added={added}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          dimmed={wide && !isFocused}
          actions={
            <>
              <PermissionChip
                session={info.session}
                variant="header"
                // A crowded bar keeps the shield alone, so the subtitle keeps the state
                className="h-9 rounded-full @max-[900px]/bar:px-2.5 @max-[900px]/bar:[&>[data-chip-label]]:hidden"
              />
              <DesktopLiveButton />
              {besideMenu}
              {moreMenu}
            </>
          }
        />
      </div>
    );
  else if (info && variant === "card")
    header = (
      <div className={cn(hidden && "hidden", !isFocused && "opacity-80")}>
        <PaneCardHeader
          info={info}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          menu={moreMenu}
          onClose={paneCount > 1 ? onClose : undefined}
        />
      </div>
    );
  else if (info && variant === "fold")
    header = (
      <div className={cn(hidden && "hidden")}>
        <FoldHeader
          info={info}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          menu={moreMenu}
        />
      </div>
    );
  else if (info && (variant === "page" || variant === "large"))
    header = (
      <div className={cn(hidden && "hidden")}>
        <PageHeader
          info={info}
          size={
            variant === "large"
              ? "large"
              : viewMode === "terminal"
                ? "compact"
                : "title"
          }
        />
      </div>
    );
  else
    header = (
      <div
        className={cn(
          "native-top-inset kb-compact-hide border-border/60 bg-background @container/bar flex items-center gap-1.5 border-b py-1.5 pr-[calc(0.5rem+var(--safe-right,env(safe-area-inset-right)))] pl-[calc(0.25rem+env(safe-area-inset-left))]",
          wide && !isFocused && "opacity-70",
          hidden && "hidden"
        )}
      >
        <button
          type="button"
          onClick={() => runNav("sessions")}
          aria-label="Sessions"
          className={iconButton}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] leading-tight font-semibold">
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
              iconButton,
              focus.on && "text-primary hover:text-primary"
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
            className={iconButton}
          >
            <ArrowLeftRight className="h-[18px] w-[18px]" />
          </button>
        )}
        {wide && besideMenu}
        {wide && paneCount > 1 && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close this side"
            className={iconButton}
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        )}
        {moreMenu}
      </div>
    );

  return (
    <>
      <div
        ref={slimRef}
        className={cn(
          "bg-background shrink-0 pr-[calc(0.5rem+var(--safe-right,env(safe-area-inset-right)))] [html[data-native]_&]:pt-[env(safe-area-inset-top)]",
          // The title in the page keeps its crumb and title (Closed-Terminal)
          pageSlim
            ? "pl-[calc(1.25rem+env(safe-area-inset-left))]"
            : "border-border/60 border-b pl-[calc(0.75rem+env(safe-area-inset-left))]",
          nativeTyping
            ? "block"
            : "hidden [html[data-keyboard-compact]_&]:block"
        )}
      >
        {pageSlim && info ? (
          <div className="flex items-center gap-2 pt-2 pb-1.5">
            <div className="flex min-w-0 flex-1 flex-col">
              <Crumb info={info} className="text-[13px] leading-tight" />
              <span className="truncate text-[15px] leading-snug font-semibold">
                {title}
              </span>
            </div>
            {peek && (
              <div
                role="group"
                aria-label="View"
                className="bg-secondary ml-auto flex shrink-0 gap-0.5 rounded-lg p-0.5 text-[11px]"
              >
                {(["chat", "terminal"] as const).map((mode) => (
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
        ) : (
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
              <span className="text-muted-foreground shrink-0">
                · {idLabel}
              </span>
            )}
            {peek && (
              <div
                role="group"
                aria-label="View"
                className="bg-secondary ml-auto flex shrink-0 gap-0.5 rounded-lg p-0.5 text-[11px]"
              >
                {(["chat", "terminal"] as const).map((mode) => (
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
        )}
      </div>
      {header}
      {session && <PermissionSheetHost session={session} />}
    </>
  );
}
