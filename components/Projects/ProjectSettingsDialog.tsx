"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ProjectWithRepositories } from "@/lib/projects";
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Project Settings</DialogTitle>
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
