import { useCallback } from "react";
import type { Session } from "@/lib/db";
import { removeWithUndo } from "@/lib/undo";
import {
  useSessionsQuery,
  useDeleteSession,
  useRenameSession,
  useForkSession,
  useSummarizeSession,
  useMoveSessionToGroup,
  useMoveSessionToProject,
} from "@/data/sessions";

export function useSessions() {
  const { data, refetch } = useSessionsQuery();
  const sessions = data?.sessions ?? [];
  const groups = data?.groups ?? [];

  const deleteMutation = useDeleteSession();
  const renameMutation = useRenameSession();
  const forkMutation = useForkSession();
  const summarizeMutation = useSummarizeSession();
  const moveToGroupMutation = useMoveSessionToGroup();
  const moveToProjectMutation = useMoveSessionToProject();

  const fetchSessions = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // At once, with a few seconds to undo
  const deleteSession = useCallback(
    (sessionId: string) => {
      const name = sessions.find((s) => s.id === sessionId)?.name;
      removeWithUndo({
        kind: "sessions",
        id: sessionId,
        message: `Deleted “${name ?? "session"}”`,
        commit: () => deleteMutation.mutateAsync(sessionId),
      });
    },
    [deleteMutation, sessions]
  );

  const renameSession = useCallback(
    async (sessionId: string, newName: string) => {
      await renameMutation.mutateAsync({ sessionId, newName });
    },
    [renameMutation]
  );

  const forkSession = useCallback(
    async (sessionId: string): Promise<Session | null> => {
      return await forkMutation.mutateAsync(sessionId);
    },
    [forkMutation]
  );

  const summarizeSession = useCallback(
    async (sessionId: string): Promise<Session | null> => {
      return await summarizeMutation.mutateAsync(sessionId);
    },
    [summarizeMutation]
  );

  const moveSessionToGroup = useCallback(
    async (sessionId: string, groupPath: string) => {
      await moveToGroupMutation.mutateAsync({ sessionId, groupPath });
    },
    [moveToGroupMutation]
  );

  const moveSessionToProject = useCallback(
    async (sessionId: string, projectId: string) => {
      await moveToProjectMutation.mutateAsync({ sessionId, projectId });
    },
    [moveToProjectMutation]
  );

  return {
    sessions,
    groups,
    summarizingSessionId: summarizeMutation.isPending
      ? (summarizeMutation.variables as string)
      : null,
    fetchSessions,
    deleteSession,
    renameSession,
    forkSession,
    summarizeSession,
    moveSessionToGroup,
    moveSessionToProject,
  };
}
