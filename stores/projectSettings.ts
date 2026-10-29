import { proxy } from "valtio";
import { openPage } from "@/stores/workspacePage";

/**
 * Project settings: the projectSettings workspace page everywhere (N-Config,
 * D-Config; M3). The store stays for ProjectSettingsHost's old callers.
 */
export const projectSettingsStore = proxy<{ projectId: string | null }>({
  projectId: null,
});

export function openProjectSettings(projectId: string) {
  openPage({ kind: "projectSettings", projectId });
}

export function closeProjectSettings() {
  projectSettingsStore.projectId = null;
}
