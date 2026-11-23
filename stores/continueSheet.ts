import { proxy } from "valtio";

/**
 * "Continue on another machine" (lib/session-move.ts): the session whose
 * sheet is up, drawn once by ContinueOnSheetHost. `from` is where the
 * running copy is when that isn't the tab's machine (bringing one back).
 */
/** A chat a project's sheet lists, and why it can't go (null: it can) */
export interface ProjectChat {
  id: string;
  name: string;
  blocked: string | null;
}

/** A whole project going to another machine (lib/project-move-types.ts) */
export interface ProjectContinue {
  /** Absent when its chats are only being brought back */
  id?: string;
  name: string;
  chats: readonly ProjectChat[];
}

export const continueSheetStore = proxy<{
  open: {
    sessionId: string;
    name: string;
    from?: string;
    project?: ProjectContinue;
  } | null;
  /** The focused pane's session when it can go elsewhere: the column's ⋯ */
  offer: { sessionId: string; name: string } | null;
}>({
  open: null,
  offer: null,
});

export function openContinueSheet(
  sessionId: string,
  name: string,
  from?: string
): void {
  continueSheetStore.open = { sessionId, name, from };
}

export function closeContinueSheet(): void {
  continueSheetStore.open = null;
}

/** The sheet for a whole project; `from` when its chats are elsewhere */
export function openProjectContinueSheet(
  project: ProjectContinue,
  from?: string
): void {
  continueSheetStore.open = {
    sessionId: "",
    name: project.name,
    from,
    project,
  };
}
