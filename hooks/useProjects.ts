import { useCallback } from "react";
import { removeWithUndo } from "@/lib/undo";
import {
  useProjectsQuery,
  useToggleProject,
  useDeleteProject,
  useRenameProject,
} from "@/data/projects";

export function useProjects() {
  const { data: projects = [], refetch } = useProjectsQuery();
  const toggleMutation = useToggleProject();
  const deleteMutation = useDeleteProject();
  const renameMutation = useRenameProject();

  const toggleProject = useCallback(
    async (projectId: string, expanded: boolean) => {
      await toggleMutation.mutateAsync({ projectId, expanded });
    },
    [toggleMutation]
  );

  // At once, with a few seconds to undo; its sessions go to Uncategorized
  const deleteProject = useCallback(
    (projectId: string) => {
      const name = projects.find((p) => p.id === projectId)?.name;
      removeWithUndo({
        kind: "projects",
        id: projectId,
        message: `Deleted “${name ?? "project"}”`,
        commit: () => deleteMutation.mutateAsync(projectId),
      });
    },
    [deleteMutation, projects]
  );

  const renameProject = useCallback(
    async (projectId: string, newName: string) => {
      await renameMutation.mutateAsync({ projectId, newName });
    },
    [renameMutation]
  );

  const fetchProjects = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    projects,
    fetchProjects,
    toggleProject,
    deleteProject,
    renameProject,
  };
}
