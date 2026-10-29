"use client";

import { useEffect } from "react";
import { useSnapshot } from "valtio";
import type { ProjectWithRepositories } from "@/lib/projects";
import {
  closeProjectSettings,
  projectSettingsStore,
} from "@/stores/projectSettings";
import { openPage } from "@/stores/workspacePage";

interface ProjectSettingsDialogProps {
  project: ProjectWithRepositories | null;
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

/**
 * Project settings were a dialog on the web; since M3 they're the page
 * everywhere (N-Config, D-Config with `.agent-os.json` beside it). Opening
 * this shows the page and hands the dialog's state straight back.
 */
export function ProjectSettingsDialog({
  project,
  open,
  onClose,
}: ProjectSettingsDialogProps) {
  const projectId = open ? project?.id : undefined;
  useEffect(() => {
    if (!projectId) return;
    openPage({ kind: "projectSettings", projectId });
    onClose();
    // onClose is the caller's setter; only a new project opens the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  return null;
}

/** stores/projectSettings.ts's web path: the page instead of a dialog */
export function ProjectSettingsHost() {
  const { projectId } = useSnapshot(projectSettingsStore);
  useEffect(() => {
    if (!projectId) return;
    closeProjectSettings();
    openPage({ kind: "projectSettings", projectId });
  }, [projectId]);
  return null;
}
