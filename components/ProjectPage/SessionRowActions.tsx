"use client";

import { useState, type ReactNode } from "react";
import {
  Copy,
  FolderInput,
  GitBranchPlus,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Session } from "@/lib/db";
import type { ProjectWithDevServers } from "@/lib/projects";
import { HoldMenu } from "@/components/a/HoldMenu";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import type { useSessionListMutations } from "@/components/SessionList/hooks/useSessionListMutations";
import { useCanOfferMove } from "@/hooks/useWorktreeMove";
import { openMoveSheet } from "@/stores/moveSheet";

type Mutations = ReturnType<typeof useSessionListMutations>;

/**
 * A Project page session row's actions (what its old SessionCard had):
 * hold it on touch, right-click it with a mouse. The row stays the mock's
 * plain .row, so they live on a sheet rather than a ⋯
 */
export function SessionRowActions({
  session,
  title,
  projects,
  actions,
  children,
}: {
  session: Session;
  title: string;
  projects: ProjectWithDevServers[];
  actions: Mutations;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // N-Worktree: the page's MoveToWorktreeSheetPageHost draws it
  const movable = useCanOfferMove(session);

  const pinned = session.pinned_order != null;
  const claude = session.agent_type === "claude";
  const others = projects.filter((p) => !p.is_uncategorized);
  const groups: SheetAction[][] = [
    [
      {
        label: "Rename",
        icon: Pencil,
        prompt: {
          title: "Rename session",
          value: session.name,
          onSubmit: (name: string) =>
            actions.handleRenameSession(session.id, name),
        },
      },
      {
        label: pinned ? "Unpin" : "Pin to top",
        icon: pinned ? PinOff : Pin,
        onSelect: () => actions.handleTogglePinSession(session.id, !pinned),
      },
    ],
    claude
      ? [
          {
            label: "Fork session",
            icon: Copy,
            onSelect: () => actions.handleForkSession(session.id),
          },
          {
            label:
              actions.summarizingSessionId === session.id
                ? "Summarizing..."
                : "Fresh start",
            icon: Sparkles,
            disabled: actions.summarizingSessionId === session.id,
            onSelect: () => actions.handleSummarize(session.id),
          },
        ]
      : [],
    movable
      ? [
          {
            label: "Move to a worktree",
            icon: GitBranchPlus,
            onSelect: () => openMoveSheet(session.id),
          },
        ]
      : [],
    others.length > 1
      ? [
          {
            label: "Move to project",
            icon: FolderInput,
            submenu: {
              title: "Move to project",
              groups: [
                others.map((p) => ({
                  label: p.name,
                  checked: p.id === session.project_id,
                  onSelect: () => {
                    if (p.id !== session.project_id)
                      actions.handleMoveSessionToProject(session.id, p.id);
                  },
                })),
              ],
            },
          },
        ]
      : [],
    [
      {
        label: "Delete session",
        icon: Trash2,
        destructive: true,
        onSelect: () => actions.handleDeleteSession(session.id),
      },
    ],
  ];

  return (
    <>
      <HoldMenu onOpen={() => setOpen(true)}>{children}</HoldMenu>
      <ActionSheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        groups={groups.filter((g) => g.length > 0)}
      />
    </>
  );
}
