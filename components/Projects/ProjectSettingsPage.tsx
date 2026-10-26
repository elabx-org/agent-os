"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PageEmpty,
  PageHeader,
  type PageProps,
} from "@/components/WorkspacePage";
import { useProjectsQuery } from "@/data/projects";
import type { ProjectWithRepositories } from "@/lib/projects";
import { backPage } from "@/stores/workspacePage";
import {
  ProjectSettingsFolderPicker,
  ProjectSettingsForm,
  useProjectSettingsForm,
} from "./ProjectSettingsForm";

const FORM_ID = "project-settings-form";

/** Project settings as a page (the Duo's right page), Save in the header */
export function ProjectSettingsPage({ page }: PageProps<"projectSettings">) {
  const { data: projects, isLoading } = useProjectsQuery();
  const live = projects?.find((p) => p.id === page.projectId) ?? null;

  // The project as the page opened: a refetch mustn't reset the edits
  const [project, setProject] = useState<ProjectWithRepositories | null>(live);
  if (!project && live) setProject(live);

  const form = useProjectSettingsForm(project, true);

  if (!project) {
    return (
      <>
        <PageHeader title="Project settings" />
        <PageEmpty>{isLoading ? null : "This project is gone."}</PageEmpty>
      </>
    );
  }

  const submit = async () => {
    if (await form.save()) backPage();
  };

  return (
    <>
      <PageHeader
        title="Project settings"
        subtitle={project.name}
        actions={
          <Button type="submit" form={FORM_ID} disabled={form.isLoading}>
            {form.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        }
      />
      {form.error && (
        <p className="border-border border-b px-4 py-2 text-sm text-red-500">
          {form.error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ProjectSettingsForm
          form={form}
          id={FORM_ID}
          onSubmit={submit}
          className="mx-auto max-w-3xl px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        />
      </div>
      {form.folderPickerRepoId && (
        // A dialog to the page host, so Esc doesn't leave the page under it
        <div role="dialog" aria-modal="true" aria-label="Choose a folder">
          <ProjectSettingsFolderPicker form={form} />
        </div>
      )}
    </>
  );
}
