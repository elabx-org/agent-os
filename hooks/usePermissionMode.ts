"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAsUser } from "@/lib/client/user-fetch";
import type {
  PermissionModeState,
  SetPermissionModeRequest,
  SetPermissionModeResult,
} from "@/lib/permission-mode";

export const permissionModeKeys = {
  session: (sessionId: string) => ["permission-mode", sessionId] as const,
};

async function fetchMode(id: string): Promise<PermissionModeState | null> {
  const res = await fetch(`/api/sessions/${id}/permission-mode`);
  if (!res.ok) return null;
  return (await res.json()) as PermissionModeState;
}

/** The refusal in words; a missing proof here survived fetchAsUser's retry */
async function refusal(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    reason?: string;
  } | null;
  if (body?.error === "user_only")
    return body.reason === "no_proof"
      ? "Reload to confirm it's you"
      : "Only you can change this, in AgentOS";
  return body?.error ?? "Couldn't change the permission mode";
}

export interface UsePermissionMode {
  state: PermissionModeState | undefined;
  isLoading: boolean;
  /** Through fetchAsUser; rejects with the server's error */
  setMode: (
    request: SetPermissionModeRequest
  ) => Promise<SetPermissionModeResult>;
  setting: boolean;
  error: string | null;
}

/** A session's permission mode (GET/POST /api/sessions/[id]/permission-mode) */
export function usePermissionMode(
  sessionId: string,
  { enabled = true }: { enabled?: boolean } = {}
): UsePermissionMode {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: permissionModeKeys.session(sessionId),
    queryFn: () => fetchMode(sessionId),
    enabled,
  });
  const [setting, setSetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setMode = useCallback(
    async (request: SetPermissionModeRequest) => {
      const queryKey = permissionModeKeys.session(sessionId);
      setSetting(true);
      setError(null);
      try {
        const res = await fetchAsUser(
          `/api/sessions/${sessionId}/permission-mode`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
          }
        ).catch(() => {
          throw new Error("Couldn't reach the server");
        });
        if (!res.ok) throw new Error(await refusal(res));
        const result = (await res.json()) as SetPermissionModeResult;
        queryClient.setQueryData<PermissionModeState | null>(queryKey, (old) =>
          old ? { ...old, mode: result.mode, pending: result.pending } : old
        );
        queryClient.invalidateQueries({ queryKey });
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setSetting(false);
      }
    },
    [queryClient, sessionId]
  );

  return {
    state: data ?? undefined,
    isLoading: enabled && isLoading,
    setMode,
    setting,
    error,
  };
}
