"use client";

import type { ProjectScript } from "@/lib/project-config-types";

/**
 * M3 (U3.3): D-Config's Add script dialog (a sheet on touch): name,
 * command, icon grid, Run in (Session terminal | Background), keyboard
 * shortcut recorder, "Run when a worktree is created"; "Saves to
 * .agent-os.json". Also edits an existing script (`initial`).
 */
export function AddScriptDialog(_props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ProjectScript;
  /** The other scripts, for id and shortcut clashes */
  scripts: ProjectScript[];
  /** Changes as typed, for ConfigPreview's highlighted lines */
  onDraftChange?: (draft: ProjectScript | null) => void;
  onSave: (script: ProjectScript) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
}) {
  return null;
}
