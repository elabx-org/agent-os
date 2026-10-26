"use client";

import {
  PageEmpty,
  PageHeader,
  type PageProps,
} from "@/components/WorkspacePage";

/** A project as a workspace (stub: p3-project-page fills it in) */
export function ProjectPage({ page, view }: PageProps<"project">) {
  const project = view.projects.find((p) => p.id === page.projectId);
  return (
    <>
      <PageHeader
        title={project?.name ?? "Project"}
        subtitle={project?.working_directory}
      />
      <PageEmpty>{!project && "This project is gone."}</PageEmpty>
    </>
  );
}
