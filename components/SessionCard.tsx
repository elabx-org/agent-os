"use client";

import { useState, useRef, useEffect } from "react";
import { afterMenuCloses, cn } from "@/lib/utils";
import {
  GitFork,
  GitBranch,
  GitPullRequest,
  Circle,
  AlertCircle,
  Loader2,
  MoreHorizontal,
  FolderInput,
  Trash2,
  Copy,
  Pencil,
  Sparkles,
  Square,
  CheckSquare,
  ExternalLink,
  Hash,
  Pin,
  PinOff,
} from "lucide-react";
import { ActionSheet, type SheetAction } from "./ui/action-sheet";
import { SwipeRow } from "./ui/swipe-row";
import { useLongPress } from "@/hooks/useLongPress";
import { useViewport } from "@/hooks/useViewport";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { Session, Group } from "@/lib/db";
import type { ProjectWithDevServers } from "@/lib/projects";

type TmuxStatus = "idle" | "running" | "waiting" | "error" | "dead";

interface SessionCardProps {
  session: Session;
  isActive?: boolean;
  isSummarizing?: boolean;
  tmuxStatus?: TmuxStatus;
  groups?: Group[];
  projects?: ProjectWithDevServers[];
  // Selection props
  isSelected?: boolean;
  isInSelectMode?: boolean;
  onToggleSelect?: (shiftKey: boolean) => void;
  // Navigation
  onClick?: () => void;
  onOpenInTab?: () => void;
  onMove?: (groupPath: string) => void;
  onMoveToProject?: (projectId: string) => void;
  onFork?: () => void;
  onSummarize?: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  onCreatePR?: () => void;
  onTogglePin?: () => void;
  onHoverStart?: (rect: DOMRect) => void;
  onHoverEnd?: () => void;
  /** A drag-sortable row: holding it lifts the row instead */
  sortable?: boolean;
  /** Changes when the list asks for this row's actions (a hold without a move) */
  actionsRequest?: number;
}

// Words carry the state as well as colour: blue working, amber needs you, grey idle
export const statusConfig: Record<
  TmuxStatus,
  { color: string; label: string; word: string; icon: React.ReactNode }
> = {
  idle: {
    color: "text-muted-foreground",
    label: "idle",
    word: "Idle",
    icon: <Circle className="h-2 w-2 fill-current" />,
  },
  running: {
    color: "text-blue-400",
    label: "running",
    word: "Working",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  waiting: {
    color: "text-amber-400",
    label: "waiting",
    word: "Needs you",
    icon: <AlertCircle className="h-3 w-3" />,
  },
  error: {
    color: "text-red-400",
    label: "error",
    word: "Error",
    icon: <Circle className="h-2 w-2 fill-current" />,
  },
  dead: {
    color: "text-muted-foreground/50",
    label: "stopped",
    word: "Stopped",
    icon: <Circle className="h-2 w-2" />,
  },
};

export function SessionCard({
  session,
  isActive,
  isSummarizing,
  tmuxStatus,
  groups = [],
  projects = [],
  isSelected,
  isInSelectMode,
  onToggleSelect,
  onClick,
  onOpenInTab,
  onMove,
  onMoveToProject,
  onFork,
  onSummarize,
  onDelete,
  onRename,
  onCreatePR,
  onTogglePin,
  onHoverStart,
  onHoverEnd,
  sortable,
  actionsRequest,
}: SessionCardProps) {
  const timeAgo = getTimeAgo(session.updated_at);
  const status = tmuxStatus || "dead";
  const config = statusConfig[status];
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(session.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const justStartedEditingRef = useRef(false);

  const handleMouseEnter = () => {
    if (!onHoverStart || !cardRef.current || menuOpen) return;
    // Debounce hover to avoid flickering
    hoverTimeoutRef.current = setTimeout(() => {
      if (cardRef.current && !menuOpen) {
        onHoverStart(cardRef.current.getBoundingClientRect());
      }
    }, 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    onHoverEnd?.();
  };

  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (open) {
      // Cancel hover preview when menu opens
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      onHoverEnd?.();
    }
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      const input = inputRef.current;
      // Mark that we just started editing to ignore immediate blur
      justStartedEditingRef.current = true;
      // Small timeout to ensure input is fully mounted
      setTimeout(() => {
        input.focus();
        input.select();
        // Re-focus after Radix UI context menu finishes closing and restoring focus
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
          }
        }, 100);
        // Clear the flag after Radix focus restoration is complete
        setTimeout(() => {
          justStartedEditingRef.current = false;
        }, 300);
      }, 0);
    }
  }, [isEditing]);

  const handleRename = () => {
    // Ignore blur events that happen immediately after starting to edit
    if (justStartedEditingRef.current) return;

    if (editName.trim() && editName !== session.name && onRename) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  const pinned = session.pinned_order != null;
  const { isTouch } = useViewport();
  const [sheetOpen, setSheetOpen] = useState(false);

  const hasActions =
    onTogglePin ||
    onMove ||
    onMoveToProject ||
    onFork ||
    onDelete ||
    onRename ||
    onCreatePR ||
    onOpenInTab;

  // Handle card click - coordinates selection with navigation
  const handleCardClick = (e: React.MouseEvent) => {
    if (isEditing) return;

    // If in select mode (any items selected), any click toggles selection
    if (isInSelectMode && onToggleSelect) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(e.shiftKey);
      return;
    }

    // Not in select mode - shift+click starts selection
    if (e.shiftKey && onToggleSelect) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(false);
      return;
    }

    // Normal click - navigate to session
    onClick?.();
  };

  // Handle checkbox click
  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSelect?.(e.shiftKey);
  };

  // For `claude --resume <id>`, or finding the conversation's transcript
  const copyClaudeSessionId = async () => {
    const id = session.claude_session_id;
    if (!id) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(id);
      copied = true;
    } catch {
      // No Clipboard API outside https: copy from a selected field instead
      const field = document.createElement("textarea");
      field.value = id;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      copied = document.execCommand("copy");
      field.remove();
    }
    if (copied) toast.success("Copied the session ID");
    else toast.error(`Couldn't copy it. The ID is ${id}`);
  };

  // On touch: hold the row (unless it's sortable) for its actions
  useLongPress(
    cardRef,
    isTouch && hasActions && !sortable && !isInSelectMode
      ? () => setSheetOpen(true)
      : undefined
  );
  useEffect(() => {
    if (actionsRequest) setSheetOpen(true);
  }, [actionsRequest]);

  // The same actions as the menus, as rows on a sheet
  const sheetGroups: SheetAction[][] = [
    [
      ...(onOpenInTab
        ? [
            {
              label: "Open in new tab",
              icon: ExternalLink,
              onSelect: onOpenInTab,
            },
          ]
        : []),
      ...(onRename
        ? [
            {
              label: "Rename",
              icon: Pencil,
              prompt: {
                title: "Rename session",
                value: session.name,
                onSubmit: onRename,
              },
            },
          ]
        : []),
      ...(onTogglePin
        ? [
            {
              label: pinned ? "Unpin" : "Pin to top",
              icon: pinned ? PinOff : Pin,
              onSelect: onTogglePin,
            },
          ]
        : []),
    ],
    [
      ...(onFork && session.agent_type === "claude"
        ? [{ label: "Fork session", icon: Copy, onSelect: onFork }]
        : []),
      ...(session.claude_session_id
        ? [
            {
              label: "Copy Claude session ID",
              icon: Hash,
              onSelect: copyClaudeSessionId,
            },
          ]
        : []),
      ...(onSummarize
        ? [
            {
              label: isSummarizing ? "Summarizing..." : "Fresh start",
              icon: Sparkles,
              onSelect: onSummarize,
              disabled: isSummarizing,
            },
          ]
        : []),
      ...(onCreatePR && session.branch_name
        ? [
            {
              label: session.pr_url ? "Open PR" : "Create PR",
              icon: GitPullRequest,
              onSelect: () =>
                session.pr_url
                  ? window.open(session.pr_url, "_blank")
                  : onCreatePR(),
            },
          ]
        : []),
    ],
    [
      ...(onMoveToProject && projects.length > 0
        ? [
            {
              label: "Move to project",
              icon: FolderInput,
              submenu: {
                title: "Move to project",
                groups: [
                  projects.map((project) => ({
                    label: project.name,
                    checked: project.id === session.project_id,
                    onSelect: () => {
                      if (project.id !== session.project_id)
                        onMoveToProject(project.id);
                    },
                  })),
                ],
              },
            },
          ]
        : []),
      ...(onMove && groups.length > 0
        ? [
            {
              label: "Move to group",
              icon: FolderInput,
              submenu: {
                title: "Move to group",
                groups: [
                  groups.map((group) => ({
                    label: group.name,
                    checked: group.path === session.group_path,
                    onSelect: () => {
                      if (group.path !== session.group_path) onMove(group.path);
                    },
                  })),
                ],
              },
            },
          ]
        : []),
    ],
    onDelete
      ? [
          {
            label: "Delete session",
            icon: Trash2,
            destructive: true,
            onSelect: onDelete,
          },
        ]
      : [],
  ];

  // Shared menu items renderer for both context menu and dropdown
  const renderMenuItems = (isContextMenu: boolean) => {
    const MenuItem = isContextMenu ? ContextMenuItem : DropdownMenuItem;
    const MenuSeparator = isContextMenu
      ? ContextMenuSeparator
      : DropdownMenuSeparator;
    const MenuSub = isContextMenu ? ContextMenuSub : DropdownMenuSub;
    const MenuSubTrigger = isContextMenu
      ? ContextMenuSubTrigger
      : DropdownMenuSubTrigger;
    const MenuSubContent = isContextMenu
      ? ContextMenuSubContent
      : DropdownMenuSubContent;

    return (
      <>
        {/* Branch info for worktree sessions */}
        {session.branch_name && (
          <>
            <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-xs">
              <GitBranch className="h-3 w-3" />
              <span className="truncate">{session.branch_name}</span>
            </div>
            <MenuSeparator />
          </>
        )}
        {onOpenInTab && (
          <MenuItem onSelect={() => onOpenInTab()}>
            <ExternalLink className="mr-2 h-3 w-3" />
            Open in new tab
          </MenuItem>
        )}
        {onRename && (
          <MenuItem onSelect={() => setIsEditing(true)}>
            <Pencil className="mr-2 h-3 w-3" />
            Rename
          </MenuItem>
        )}
        {onTogglePin && (
          <MenuItem onSelect={() => onTogglePin()}>
            {pinned ? (
              <PinOff className="mr-2 h-3 w-3" />
            ) : (
              <Pin className="mr-2 h-3 w-3" />
            )}
            {pinned ? "Unpin" : "Pin to top"}
          </MenuItem>
        )}
        {onFork && session.agent_type === "claude" && (
          <MenuItem onSelect={() => onFork()}>
            <Copy className="mr-2 h-3 w-3" />
            Fork session
          </MenuItem>
        )}
        {session.claude_session_id && (
          <MenuItem onSelect={() => copyClaudeSessionId()}>
            <Hash className="mr-2 h-3 w-3 shrink-0" />
            <span className="flex min-w-0 flex-col">
              <span>Copy Claude session ID</span>
              <span className="text-muted-foreground truncate font-mono text-[11px]">
                {session.claude_session_id}
              </span>
            </span>
          </MenuItem>
        )}
        {onSummarize && (
          <MenuItem onSelect={() => onSummarize()} disabled={isSummarizing}>
            {isSummarizing ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-3 w-3" />
            )}
            {isSummarizing ? "Summarizing..." : "Fresh start"}
          </MenuItem>
        )}
        {onCreatePR && session.branch_name && (
          <MenuItem
            onSelect={() => {
              if (session.pr_url) {
                window.open(session.pr_url, "_blank");
              } else {
                onCreatePR();
              }
            }}
          >
            <GitPullRequest className="mr-2 h-3 w-3" />
            {session.pr_url ? "Open PR" : "Create PR"}
          </MenuItem>
        )}
        {onMoveToProject && projects.length > 0 && (
          <MenuSub>
            <MenuSubTrigger>
              <FolderInput className="mr-2 h-3 w-3" />
              Move to project...
            </MenuSubTrigger>
            <MenuSubContent>
              {projects
                .filter((p) => p.id !== session.project_id)
                .map((project) => (
                  <MenuItem
                    key={project.id}
                    onSelect={() => onMoveToProject(project.id)}
                  >
                    {project.name}
                  </MenuItem>
                ))}
            </MenuSubContent>
          </MenuSub>
        )}
        {onMove && groups.length > 0 && (
          <MenuSub>
            <MenuSubTrigger>
              <FolderInput className="mr-2 h-3 w-3" />
              Move to group...
            </MenuSubTrigger>
            <MenuSubContent>
              {groups
                .filter((g) => g.path !== session.group_path)
                .map((group) => (
                  <MenuItem
                    key={group.path}
                    onSelect={() => onMove(group.path)}
                  >
                    {group.name}
                  </MenuItem>
                ))}
            </MenuSubContent>
          </MenuSub>
        )}
        {onDelete && (
          <>
            <MenuSeparator />
            <MenuItem
              onSelect={() => afterMenuCloses(onDelete)}
              className="text-red-500 focus:text-red-500"
            >
              <Trash2 className="mr-2 h-3 w-3" />
              Delete session
            </MenuItem>
          </>
        )}
      </>
    );
  };

  const cardContent = (
    <div
      ref={cardRef}
      onClick={handleCardClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "group data-[held]:bg-accent flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left transition-[background-color,transform] select-none [-webkit-touch-callout:none] data-[held]:scale-[0.98]",
        "min-h-[48px] md:min-h-0", // Two-line row, 48px touch target
        isSelected
          ? "bg-primary/20"
          : isActive
            ? "bg-primary/10"
            : "hover:bg-accent/50",
        status === "waiting" && !isActive && !isSelected && "bg-amber-400/5"
      )}
    >
      {/* Selection checkbox - visible when in select mode */}
      {isInSelectMode && onToggleSelect && (
        <button
          onClick={handleCheckboxClick}
          className="text-primary hover:text-primary/80 flex-shrink-0"
        >
          {isSelected ? (
            <CheckSquare className="h-4 w-4" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </button>
      )}

      {/* Status indicator - hidden when in select mode */}
      {!isInSelectMode && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn("flex-shrink-0", config.color)}>
              {config.icon}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            <span className="capitalize">{config.label}</span>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Session name */}
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") {
              setEditName(session.name);
              setIsEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="border-primary min-w-0 flex-1 border-b bg-transparent text-sm outline-none"
        />
      ) : (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm">{session.name}</span>
          <span className="text-muted-foreground truncate text-xs">
            <span
              className={cn(
                (status === "running" || status === "waiting") && config.color
              )}
            >
              {config.word}
            </span>
            {` · ${timeAgo}`}
          </span>
        </span>
      )}

      {pinned && (
        <Pin className="text-muted-foreground h-3 w-3 flex-shrink-0 -rotate-45" />
      )}

      {/* Fork indicator */}
      {session.parent_session_id && (
        <GitFork className="text-muted-foreground h-3 w-3 flex-shrink-0" />
      )}

      {/* TODO: Show port indicator once auto dev server management is implemented.
          Each worktree gets a unique port (3100, 3110, etc.) for running dev servers.
          See lib/ports.ts and ideas.md for the planned feature. */}

      {/* PR status badge */}
      {session.pr_status && (
        <a
          href={session.pr_url || "#"}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex flex-shrink-0 items-center gap-0.5 rounded px-1 text-[10px]",
            session.pr_status === "open" && "bg-green-500/20 text-green-400",
            session.pr_status === "merged" &&
              "bg-purple-500/20 text-purple-400",
            session.pr_status === "closed" && "bg-red-500/20 text-red-400"
          )}
          title={`PR #${session.pr_number}: ${session.pr_status}`}
        >
          <GitPullRequest className="h-2.5 w-2.5" />
          <span>
            {session.pr_status === "merged"
              ? "M"
              : session.pr_status === "closed"
                ? "X"
                : "O"}
          </span>
        </a>
      )}

      {/* Actions: a sheet on touch, a menu with a mouse */}
      {hasActions && isTouch && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Session actions"
          className="h-8 w-8 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setSheetOpen(true);
          }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      )}
      {hasActions && !isTouch && (
        <DropdownMenu onOpenChange={handleMenuOpenChange}>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 flex-shrink-0 opacity-100 md:pointer-fine:h-5 md:pointer-fine:w-5 md:pointer-fine:opacity-0 md:pointer-fine:group-hover:opacity-100"
            >
              <MoreHorizontal className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            {renderMenuItems(false)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  if (hasActions && isTouch) {
    return (
      <>
        <SwipeRow
          disabled={isEditing || isInSelectMode}
          leading={
            onTogglePin
              ? {
                  label: pinned ? "Unpin" : "Pin",
                  icon: pinned ? PinOff : Pin,
                  tone: "bg-amber-500",
                  onAction: onTogglePin,
                }
              : undefined
          }
          trailing={
            onDelete
              ? {
                  label: "Delete",
                  icon: Trash2,
                  tone: "bg-red-500",
                  onAction: onDelete,
                }
              : undefined
          }
        >
          {cardContent}
        </SwipeRow>
        <ActionSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={session.name}
          description={
            session.branch_name
              ? `${config.word} · ${session.branch_name}`
              : `${config.word} · ${timeAgo}`
          }
          groups={sheetGroups}
        />
      </>
    );
  }

  // Wrap with context menu if actions are available
  if (hasActions) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{cardContent}</ContextMenuTrigger>
        <ContextMenuContent>{renderMenuItems(true)}</ContextMenuContent>
      </ContextMenu>
    );
  }

  return cardContent;
}

export function getTimeAgo(dateStr: string): string {
  const date = new Date(dateStr + "Z"); // Assume UTC
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
