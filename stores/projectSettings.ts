import { proxy } from "valtio";
import { isNative } from "@/lib/native-bridge";
import { openPage } from "@/stores/workspacePage";

/**
 * Project settings on the web: the wide dialog (a sheet on touch phones).
 * The iOS app shows them as a workspace page instead.
 */
export const projectSettingsStore = proxy<{ projectId: string | null }>({
  projectId: null,
});

export function openProjectSettings(projectId: string) {
  if (isNative()) {
    openPage({ kind: "projectSettings", projectId });
    return;
  }
  projectSettingsStore.projectId = projectId;
}

export function closeProjectSettings() {
  projectSettingsStore.projectId = null;
}
