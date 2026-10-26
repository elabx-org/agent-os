"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  GLASS_DIALOG,
} from "@/components/ui/dialog";
import { useState } from "react";
import { useSnapshot } from "valtio";
import { cn } from "@/lib/utils";
import { useViewport } from "@/hooks/useViewport";
import { Button } from "@/components/ui/button";
import { useProjectsQuery } from "@/data/projects";
import type { ProjectWithRepositories } from "@/lib/projects";
import {
  closeProjectSettings,
  projectSettingsStore,
} from "@/stores/projectSettings";
import {
  ProjectSettingsFolderPicker,
  ProjectSettingsForm,
  useProjectSettingsForm,
} from "./ProjectSettingsForm";

interface ProjectSettingsDialogProps {
  project: ProjectWithRepositories | null;
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

/** Project settings on the web: a wide dialog (a sheet on touch phones) */
export function ProjectSettingsDialog({
  project,
  open,
  onClose,
  onSave,
}: ProjectSettingsDialogProps) {
  const form = useProjectSettingsForm(project, open);
  const { isTouch } = useViewport();

  const handleClose = () => {
    form.reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!(await form.save())) return;
    handleClose();
    onSave();
  };

  if (!project) return null;

  return (
    <>
      <Dialog
        open={open && !form.folderPickerRepoId}
        onOpenChange={(o) => !o && handleClose()}
      >
        <DialogContent
          className={cn(
            "max-h-[90vh] overflow-y-auto sm:max-w-2xl",
            !isTouch && GLASS_DIALOG
          )}
        >
          <DialogHeader>
            <DialogTitle>Project settings</DialogTitle>
          </DialogHeader>

          <ProjectSettingsForm form={form} onSubmit={handleSubmit}>
            <div className="space-y-4">
              {form.error && (
                <p className="text-sm text-red-500">{form.error}</p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={form.isLoading}>
                  {form.isLoading ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </div>
          </ProjectSettingsForm>
        </DialogContent>
      </Dialog>

      <ProjectSettingsFolderPicker form={form} />
    </>
  );
}

/** The dialog as stores/projectSettings.ts opens it */
export function ProjectSettingsHost() {
  const { projectId } = useSnapshot(projectSettingsStore);
  const { data: projects } = useProjectsQuery();
  const live = projects?.find((p) => p.id === projectId) ?? null;

  // The project as the dialog opened: a refetch mustn't reset the edits
  const [snap, setSnap] = useState<ProjectWithRepositories | null>(null);
  if (!live && snap) setSnap(null);
  if (live && snap?.id !== live.id) setSnap(live);

  return (
    <ProjectSettingsDialog
      project={snap}
      open={!!live && !!snap}
      onClose={closeProjectSettings}
      onSave={closeProjectSettings}
    />
  );
}
