import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePendingRemoval } from "@/stores/pendingRemoval";
import type { ProjectWithRepositories } from "@/lib/projects";
import type { ProjectPlacement } from "@/lib/project-groups";
import type { MergedPr } from "@/lib/merged-today";
import { projectKeys } from "./keys";
import { sessionKeys } from "../sessions/keys";

async function fetchProjects(): Promise<ProjectWithRepositories[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  const data = await res.json();
  return data.projects || [];
}

export function useProjectsQuery() {
  // Leave out what's deleted but can still be undone
  const removed = usePendingRemoval();
  const select = useCallback(
    (data: ProjectWithRepositories[]) =>
      data.filter((p) => !removed.projects[p.id]),
    [removed]
  );
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: fetchProjects,
    staleTime: 30000,
    select,
  });
}

export function useToggleProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      expanded,
    }: {
      projectId: string;
      expanded: boolean;
    }) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expanded }),
      });
      if (!res.ok) throw new Error("Failed to toggle project");
      return res.json();
    },
    onMutate: async ({ projectId, expanded }) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.list() });
      const previous = queryClient.getQueryData<ProjectWithRepositories[]>(
        projectKeys.list()
      );
      queryClient.setQueryData<ProjectWithRepositories[]>(
        projectKeys.list(),
        (old) => old?.map((p) => (p.id === projectId ? { ...p, expanded } : p))
      );
      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(projectKeys.list(), context.previous);
      }
    },
  });
}

export function useReorderProjects() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch("/api/projects/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Failed to reorder projects");
      return res.json();
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.list() });
      const previous = queryClient.getQueryData<ProjectWithRepositories[]>(
        projectKeys.list()
      );
      const rank = new Map(ids.map((id, i) => [id, i]));
      queryClient.setQueryData<ProjectWithRepositories[]>(
        projectKeys.list(),
        (old) =>
          old &&
          [...old].sort(
            (a, b) =>
              (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)
          )
      );
      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(projectKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
        keepalive: true,
      });
      if (!res.ok) throw new Error("Failed to delete project");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useRenameProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      newName,
    }: {
      projectId: string;
      newName: string;
    }) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) throw new Error("Failed to rename project");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      name,
      workingDirectory,
      agentType,
      defaultModel,
      initialPrompt,
      instructions,
      hooks,
    }: {
      projectId: string;
      name?: string;
      workingDirectory?: string;
      agentType?: string;
      defaultModel?: string;
      initialPrompt?: string | null;
      instructions?: string | null;
      hooks?: { event: string; matcher?: string; command: string }[];
    }) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          workingDirectory,
          agentType,
          defaultModel,
          initialPrompt,
          instructions,
          hooks,
        }),
      });
      if (!res.ok) throw new Error("Failed to update project");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      workingDirectory: string;
      agentType?: string;
      defaultModel?: string;
      devServers?: Array<{
        name: string;
        type: string;
        command: string;
        port?: number;
        portEnvVar?: string;
      }>;
    }) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create project");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

/**
 * Pin a project or move it into a group (Projects page, sort menu). M1b
 * U1b.1 implements it (optimistic, like useToggleProject).
 */
export function useUpdateProjectPlacement() {
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      placement: ProjectPlacement;
    }): Promise<void> => {
      void input;
      throw new Error("Not implemented");
    },
  });
}

/** A project's pull requests merged today (Project page). M1b U1b.1 */
export function useMergedTodayQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.mergedToday(projectId ?? ""),
    queryFn: async (): Promise<MergedPr[]> => [],
    enabled: !!projectId,
  });
}
