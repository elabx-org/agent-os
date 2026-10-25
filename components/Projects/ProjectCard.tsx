"use client";

import { useState, useRef, useEffect } from "react";
import { afterMenuCloses, cn } from "@/lib/utils";
import {
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Settings,
  Plus,
  Server,
  Trash2,
  Pencil,
  FolderOpen,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Project, DevServer } from "@/lib/db";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import { SwipeRow } from "@/components/ui/swipe-row";
import { useLongPress } from "@/hooks/useLongPress";
import { useViewport } from "@/hooks/useViewport";

interface ProjectCardProps {
  project: Project;
  sessionCount: number;
  runningDevServers?: DevServer[];
  onClick?: () => void;
  onToggleExpanded?: (expanded: boolean) => void;
  onEdit?: () => void;
  onNewSession?: () => void;
  onOpenTerminal?: () => void;
  onStartDevServer?: () => void;
  onOpenInEditor?: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  /** A drag-sortable row: holding it lifts the row instead */
  sortable?: boolean;
  /** Changes when the list asks for this row's actions (a hold without a move) */
  actionsRequest?: number;
}

export function ProjectCard({
  project,
  sessionCount,
  runningDevServers = [],
  onClick,
  onToggleExpanded,
  onEdit,
  onNewSession,
  onOpenTerminal,
  onStartDevServer,
  onOpenInEditor,
  onDelete,
  onRename,
  sortable,
  actionsRequest,
}: ProjectCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const justStartedEditingRef = useRef(false);
  const { isTouch } = useViewport();
  const [sheetOpen, setSheetOpen] = useState(false);

  const hasRunningServers = runningDevServers.length > 0;
  // Uncategorized can have New Session, Open Terminal, and Rename, but not Edit/Delete/DevServer
  const hasActions = project.is_uncategorized
    ? onNewSession || onOpenTerminal || onRename
    : onEdit ||
      onNewSession ||
      onOpenTerminal ||
      onStartDevServer ||
      onDelete ||
      onRename;

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

    if (editName.trim() && editName !== project.name && onRename) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isEditing) return;
    onClick?.();
    onToggleExpanded?.(!project.expanded);
  };

  const renderMenuItems = (isContextMenu: boolean) => {
    const MenuItem = isContextMenu ? ContextMenuItem : DropdownMenuItem;
    const MenuSeparator = isContextMenu
      ? ContextMenuSeparator
      : DropdownMenuSeparator;

    return (
      <>
        {onNewSession && (
          <MenuItem onSelect={() => onNewSession()}>
            <Plus className="mr-2 h-3 w-3" />
            New session
          </MenuItem>
        )}
        {onOpenTerminal && (
          <MenuItem onSelect={() => onOpenTerminal()}>
            <Terminal className="mr-2 h-3 w-3" />
            Open terminal
          </MenuItem>
        )}
        {onEdit && (
          <MenuItem onSelect={() => onEdit()}>
            <Settings className="mr-2 h-3 w-3" />
            Project settings
          </MenuItem>
        )}
        {onRename && (
          <MenuItem onSelect={() => setIsEditing(true)}>
            <Pencil className="mr-2 h-3 w-3" />
            Rename
          </MenuItem>
        )}
        {onOpenInEditor && (
          <MenuItem onSelect={() => onOpenInEditor()}>
            <FolderOpen className="mr-2 h-3 w-3" />
            Open in editor
          </MenuItem>
        )}
        {onStartDevServer && (
          <>
            <MenuSeparator />
            <MenuItem onSelect={() => onStartDevServer()}>
              <Server className="mr-2 h-3 w-3" />
              Start dev server
            </MenuItem>
          </>
        )}
        {onDelete && (
          <>
            <MenuSeparator />
            <MenuItem
              onSelect={() => afterMenuCloses(onDelete)}
              className="text-red-500 focus:text-red-500"
            >
              <Trash2 className="mr-2 h-3 w-3" />
              Delete project
            </MenuItem>
          </>
        )}
      </>
    );
  };

  // On touch: hold the row (unless it's sortable) for its actions
  useLongPress(
    cardRef,
    isTouch && hasActions && !sortable ? () => setSheetOpen(true) : undefined
  );
  useEffect(() => {
    if (actionsRequest) setSheetOpen(true);
  }, [actionsRequest]);

  const sheetGroups: SheetAction[][] = [
    [
      ...(onNewSession
        ? [{ label: "New session", icon: Plus, onSelect: onNewSession }]
        : []),
      ...(onOpenTerminal
        ? [{ label: "Open terminal", icon: Terminal, onSelect: onOpenTerminal }]
        : []),
    ],
    [
      ...(onRename
        ? [
            {
              label: "Rename",
              icon: Pencil,
              prompt: {
                title: "Rename project",
                value: project.name,
                onSubmit: onRename,
              },
            },
          ]
        : []),
      ...(onEdit
        ? [{ label: "Project settings", icon: Settings, onSelect: onEdit }]
        : []),
      ...(onOpenInEditor
        ? [
            {
              label: "Open in editor",
              icon: FolderOpen,
              onSelect: onOpenInEditor,
            },
          ]
        : []),
      ...(onStartDevServer
        ? [
            {
              label: "Start dev server",
              icon: Server,
              onSelect: onStartDevServer,
            },
          ]
        : []),
    ],
    onDelete
      ? [
          {
            label: "Delete project",
            icon: Trash2,
            destructive: true,
            onSelect: onDelete,
          },
        ]
      : [],
  ];

  const cardContent = (
    <div
      ref={cardRef}
      onClick={handleClick}
      className={cn(
        "group data-[held]:bg-accent flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 transition-[background-color,transform] select-none [-webkit-touch-callout:none] data-[held]:scale-[0.98]",
        "min-h-[36px] md:min-h-[28px]",
        "hover:bg-accent/50"
      )}
    >
      {/* Expand/collapse toggle */}
      <button className="flex-shrink-0 p-0.5">
        {project.expanded ? (
          <ChevronDown className="text-muted-foreground h-4 w-4" />
        ) : (
          <ChevronRight className="text-muted-foreground h-4 w-4" />
        )}
      </button>

      {/* Project name */}
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
              setEditName(project.name);
              setIsEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="border-primary min-w-0 flex-1 border-b bg-transparent text-sm font-medium outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {project.name}
        </span>
      )}

      {/* Running servers indicator */}
      {hasRunningServers && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex flex-shrink-0 items-center gap-1 text-green-500">
              <Server className="h-3 w-3" />
              <span className="text-xs">{runningDevServers.length}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {runningDevServers.length} dev server
              {runningDevServers.length > 1 ? "s" : ""} running
            </p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Session count */}
      <span className="text-muted-foreground flex-shrink-0 text-xs">
        {sessionCount}
      </span>

      {/* Actions: a sheet on touch, a menu with a mouse */}
      {hasActions && isTouch && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Project actions"
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7 flex-shrink-0 opacity-100 md:pointer-fine:h-6 md:pointer-fine:w-6 md:pointer-fine:opacity-0 md:pointer-fine:group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
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
          disabled={isEditing}
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
          title={project.name}
          description={`${sessionCount} session${sessionCount === 1 ? "" : "s"}`}
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
