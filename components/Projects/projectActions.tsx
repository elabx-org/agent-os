"use client";

import { Fragment } from "react";
import {
  Bot,
  FolderOpen,
  Pencil,
  Plus,
  Server,
  Settings,
  Terminal,
  Trash2,
} from "lucide-react";
import { afterMenuCloses } from "@/lib/utils";
import type { SheetAction } from "@/components/ui/action-sheet";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export interface ProjectActionHandlers {
  onNewSession?: () => void;
  onNewBackgroundAgent?: () => void;
  onOpenTerminal?: () => void;
  onRename?: (newName: string) => void;
  /** Renames in place (a menu); without it Rename asks on the sheet */
  onStartRename?: () => void;
  onEdit?: () => void;
  onOpenInEditor?: () => void;
  onStartDevServer?: () => void;
  onDelete?: () => void;
}

/**
 * A project's actions, one list for its menu, its sheet and its page's ⋯:
 * starting work (session, background agent, terminal), the project itself,
 * then Delete on its own.
 */
export function projectActionGroups(
  project: { name: string },
  h: ProjectActionHandlers
): SheetAction[][] {
  const start: SheetAction[] = [];
  if (h.onNewSession)
    start.push({ label: "New session", icon: Plus, onSelect: h.onNewSession });
  if (h.onNewBackgroundAgent)
    start.push({
      label: "New background agent",
      icon: Bot,
      onSelect: h.onNewBackgroundAgent,
    });
  if (h.onOpenTerminal)
    start.push({
      label: "Open terminal",
      icon: Terminal,
      onSelect: h.onOpenTerminal,
    });

  const own: SheetAction[] = [];
  if (h.onStartRename)
    own.push({ label: "Rename", icon: Pencil, onSelect: h.onStartRename });
  else if (h.onRename)
    own.push({
      label: "Rename",
      icon: Pencil,
      prompt: {
        title: "Rename project",
        value: project.name,
        onSubmit: h.onRename,
      },
    });
  if (h.onEdit)
    own.push({
      label: "Project settings",
      icon: Settings,
      onSelect: h.onEdit,
    });
  if (h.onOpenInEditor)
    own.push({
      label: "Open in editor",
      icon: FolderOpen,
      onSelect: h.onOpenInEditor,
    });
  if (h.onStartDevServer)
    own.push({
      label: "Start dev server",
      icon: Server,
      onSelect: h.onStartDevServer,
    });

  const remove: SheetAction[] = h.onDelete
    ? [
        {
          label: "Delete project",
          icon: Trash2,
          destructive: true,
          onSelect: h.onDelete,
        },
      ]
    : [];

  return [start, own, remove].filter((group) => group.length > 0);
}

/** The groups as menu items, a separator between groups */
export function ProjectActionItems({
  groups,
  context,
}: {
  groups: SheetAction[][];
  /** Right-click menu rather than the ⋯ dropdown */
  context?: boolean;
}) {
  const MenuItem = context ? ContextMenuItem : DropdownMenuItem;
  const MenuSeparator = context ? ContextMenuSeparator : DropdownMenuSeparator;
  return groups.map((group, i) => (
    <Fragment key={i}>
      {i > 0 && <MenuSeparator />}
      {group.map(({ label, icon: Icon, onSelect, destructive }) => (
        <MenuItem
          key={label}
          // A delete may confirm or undo: let the menu close first
          onSelect={() =>
            onSelect && (destructive ? afterMenuCloses(onSelect) : onSelect())
          }
          className={
            destructive ? "text-red-500 focus:text-red-500" : undefined
          }
        >
          {Icon && <Icon className="mr-2 h-3 w-3" />}
          {label}
        </MenuItem>
      ))}
    </Fragment>
  ));
}
