import { proxy } from "valtio";
import { isNative } from "@/lib/native-bridge";
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
