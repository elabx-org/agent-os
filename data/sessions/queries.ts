import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePendingRemoval } from "@/stores/pendingRemoval";
import type { Session, Group } from "@/lib/db";
import type { AgentType } from "@/lib/providers";
import { sessionKeys } from "./keys";

interface SessionsResponse {
  sessions: Session[];
  groups: Group[];
}

async function fetchSessions(): Promise<SessionsResponse> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export function useSessionsQuery() {
  // Leave out what's deleted but can still be undone
  const removed = usePendingRemoval();
  const select = useCallback(
    (data: SessionsResponse): SessionsResponse => ({
      sessions: data.sessions.filter((s) => !removed.sessions[s.id]),
      groups: data.groups.filter((g) => !removed.groups[g.path]),
    }),
    [removed]
  );
  return useQuery({
    queryKey: sessionKeys.list(),
    queryFn: fetchSessions,
    staleTime: 5000,
    refetchInterval: 10000,
    select,
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
        keepalive: true,
      });
      if (!res.ok) throw new Error("Failed to delete session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useRenameSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      newName,
    }: {
      sessionId: string;
      newName: string;
    }) => {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) throw new Error("Failed to rename session");
      return res.json();
    },
    onMutate: async ({ sessionId, newName }) => {
      await queryClient.cancelQueries({ queryKey: sessionKeys.list() });
      const previous = queryClient.getQueryData<SessionsResponse>(
        sessionKeys.list()
      );
      queryClient.setQueryData<SessionsResponse>(sessionKeys.list(), (old) =>
        old
          ? {
              ...old,
              sessions: old.sessions.map((s) =>
                s.id === sessionId ? { ...s, name: newName } : s
              ),
            }
          : old
      );
      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(sessionKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useForkSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string): Promise<Session | null> => {
      const res = await fetch(`/api/sessions/${sessionId}/fork`, {
        method: "POST",
      });
      const data = await res.json();
      return data.session || null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useSummarizeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string): Promise<Session | null> => {
      const res = await fetch(`/api/sessions/${sessionId}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createFork: true }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.newSession || null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useMoveSessionToGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      groupPath,
    }: {
      sessionId: string;
      groupPath: string;
    }) => {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupPath }),
      });
      if (!res.ok) throw new Error("Failed to move session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useMoveSessionToProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      projectId,
    }: {
      sessionId: string;
      projectId: string;
    }) => {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("Failed to move session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

/** The server's order: pinned first in pin order, then most recent */
function byPinThenRecent(a: Session, b: Session) {
  const ap = a.pinned_order ?? Infinity;
  const bp = b.pinned_order ?? Infinity;
  if (ap !== bp) return ap - bp;
  return b.updated_at.localeCompare(a.updated_at);
}

/** Changes sessions in the cached list at once, rolled back on failure */
function useOptimisticSessions() {
  const queryClient = useQueryClient();
  return {
    apply: async (change: (sessions: Session[]) => Session[]) => {
      await queryClient.cancelQueries({ queryKey: sessionKeys.list() });
      const previous = queryClient.getQueryData<SessionsResponse>(
        sessionKeys.list()
      );
      queryClient.setQueryData<SessionsResponse>(
        sessionKeys.list(),
        (old) =>
          old && {
            ...old,
            sessions: change(old.sessions).sort(byPinThenRecent),
          }
      );
      return { previous };
    },
    rollback: (context?: { previous?: SessionsResponse }) => {
      if (context?.previous) {
        queryClient.setQueryData(sessionKeys.list(), context.previous);
      }
    },
    refetch: () =>
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() }),
  };
}

export function usePinSession() {
  const optimistic = useOptimisticSessions();

  return useMutation({
    mutationFn: async ({
      sessionId,
      pinned,
    }: {
      sessionId: string;
      pinned: boolean;
    }) => {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      if (!res.ok) throw new Error("Failed to pin session");
      return res.json();
    },
    onMutate: ({ sessionId, pinned }) =>
      optimistic.apply((sessions) => {
        const session = sessions.find((s) => s.id === sessionId);
        const last = Math.max(
          0,
          ...sessions
            .filter(
              (s) =>
                s.project_id === session?.project_id && s.pinned_order != null
            )
            .map((s) => s.pinned_order as number)
        );
        return sessions.map((s) =>
          s.id === sessionId
            ? { ...s, pinned_order: pinned ? last + 1 : null }
            : s
        );
      }),
    onError: (_, __, context) => optimistic.rollback(context),
    onSettled: () => optimistic.refetch(),
  });
}

/** Saves the order of one project's pinned sessions */
export function useReorderPinnedSessions() {
  const optimistic = useOptimisticSessions();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch("/api/sessions/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Failed to order pinned sessions");
      return res.json();
    },
    onMutate: (ids) =>
      optimistic.apply((sessions) => {
        const rank = new Map(ids.map((id, i) => [id, i + 1]));
        return sessions.map((s) =>
          rank.has(s.id) ? { ...s, pinned_order: rank.get(s.id)! } : s
        );
      }),
    onError: (_, __, context) => optimistic.rollback(context),
    onSettled: () => optimistic.refetch(),
  });
}

export interface CreateSessionInput {
  name?: string;
  workingDirectory: string;
  projectId: string | null;
  agentType: AgentType;
  useWorktree: boolean;
  createBranch?: boolean;
  featureName: string | null;
  baseBranch: string | null;
  autoApprove: boolean;
  continueSession: boolean;
  useTmux: boolean;
  initialPrompt: string | null;
  /** Left out, the server keeps its default */
  model?: string;
}

interface CreateSessionResponse {
  session: Session;
  initialPrompt?: string;
  error?: string;
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: CreateSessionInput
    ): Promise<CreateSessionResponse> => {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}
