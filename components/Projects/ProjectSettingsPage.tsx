"use client";

import {
  PageEmpty,
  PageHeader,
  type PageProps,
} from "@/components/WorkspacePage";

/** Project settings as a page (stub: p3-project-settings) */
export function ProjectSettingsPage({
  page,
  view,
}: PageProps<"projectSettings">) {
  const project = view.projects.find((p) => p.id === page.projectId);
  return (
    <>
      <PageHeader title="Project settings" subtitle={project?.name} />
      <PageEmpty />
    </>
  );
}
