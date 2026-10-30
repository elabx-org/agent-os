import { proxy, subscribe } from "valtio";
import { isNative } from "@/lib/native-bridge";
import type { AgentType } from "@/lib/providers";
import type { Mode } from "@/lib/permission-mode";
import { backPage, openPage, workspacePageStore } from "@/stores/workspacePage";
import type { RunAs } from "@/components/New/useNewForm";

/**
 * New on the web: the sized dialog (a sheet on touch phones). The iOS app
 * shows New as a workspace page instead, so this stays closed there.
 */
export const newSurfaceStore = proxy<{
  open: boolean;
  projectId: string | null;
  runAs: RunAs | null;
}>({ open: false, projectId: null, runAs: null });

/** Every way into New: a page on the Duo, the dialog or sheet elsewhere */
export function openNew({
  projectId,
  runAs,
}: { projectId?: string; runAs?: RunAs } = {}) {
  if (isNative()) {
    // New again from New replaces it rather than stacking a second one
    if (workspacePageStore.page?.kind === "new") backPage();
    openPage({
      kind: "new",
      projectId,
      runAs: runAs === "background" ? "agent" : runAs,
    });
    return;
  }
  newSurfaceStore.projectId = projectId ?? null;
  newSurfaceStore.runAs = runAs ?? null;
  newSurfaceStore.open = true;
}

export function closeNew() {
  newSurfaceStore.open = false;
}

/**
 * What was typed and picked in New before Start: the form remounts when
 * the Duo folds or the phone turns, and a reload starts it again, so it is
 * kept here (and in sessionStorage, this tab only) until New closes. Only
 * what you changed: the rest is the form's defaults
 */
export interface NewDraft {
  task?: string;
  projectId?: string | null;
  workingDirectory?: string;
  agentType?: AgentType;
  model?: string;
  permissionMode?: Mode | null;
}

const DRAFT_KEY = "agentos:newDraft";
let draft: NewDraft | null = null;
let draftLoaded = false;

export function loadNewDraft(): NewDraft | null {
  if (!draftLoaded) {
    draftLoaded = true;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") draft = parsed as NewDraft;
    } catch {
      // None kept
    }
  }
  return draft;
}

export function patchNewDraft(change: NewDraft) {
  draft = { ...loadNewDraft(), ...change };
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Kept until a reload only
  }
}

export function clearNewDraft() {
  draftLoaded = true;
  if (!draft) return;
  draft = null;
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Gone from memory anyway
  }
}

const newShowing = () =>
  newSurfaceStore.open || workspacePageStore.page?.kind === "new";
let keepOnClose = false;

/**
 * A session opening over New (a notification, a link) closes it without
 * your say: the draft stays for the next New
 */
export function keepNewDraftOnClose() {
  keepOnClose = newShowing();
}

// New closed by Cancel or back: its draft goes. A fold or a turn keeps it
// open, so keeps the draft
if (typeof window !== "undefined") {
  let showing = newShowing();
  const check = () => {
    const now = newShowing();
    if (showing && !now && !keepOnClose) clearNewDraft();
    if (!now) keepOnClose = false;
    showing = now;
  };
  subscribe(newSurfaceStore, check);
  subscribe(workspacePageStore, check);
}
