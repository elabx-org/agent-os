"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@/lib/db";
import type {
  HandoffError,
  HandoffPreview,
  HandoffRequest,
  HandoffResult,
  ModelSwitchRequest,
  ModelSwitchResult,
  ResumePausedResult,
} from "@/lib/handoff-types";
import { fetchAsUser } from "@/lib/client/user-fetch";
import { sessionKeys } from "@/data/sessions/keys";
import { agentName } from "@/components/a/Avatar";
import { handoffRefusalText } from "@/components/Session/switch-model";
import { claudeStateKeys } from "./useClaudeState";
import { queueKeys } from "./useQueue";

/** A refused action: the route's status and body, the mapped text as message */
export class HandoffRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: HandoffError | null
  ) {
    super(message);
  }
}

export const handoffKeys = {
  preview: (sessionId: string) => ["handoff-preview", sessionId] as const,
};

/** While the sheet is open: busy turns to free as the turn ends */
const PREVIEW_POLL_MS = 3000;

/**
 * The "Agent and model" sheet's data and actions (M4, N-Switch). Actions go
 * through fetchAsUser (user-only routes) and refresh the sessions list; they
 * throw with the route's refusal text.
 */
export interface UseHandoff {
  /** GET handoff-preview while `open`; null until loaded */
  preview: HandoffPreview | null;
  loading: boolean;
  switchModel: (request: ModelSwitchRequest) => Promise<ModelSwitchResult>;
  handOff: (request: HandoffRequest) => Promise<HandoffResult>;
  /** `force` resumes although the successor still runs in the same folder */
  resumePaused: (force?: boolean) => Promise<ResumePausedResult>;
}

async function fetchPreview(sessionId: string): Promise<HandoffPreview | null> {
  const res = await fetch(`/api/sessions/${sessionId}/handoff-preview`);
  // Not there yet (501) or refused: the sheet shows what it knows
  if (!res.ok) return null;
  return (await res.json()) as HandoffPreview;
}

export function useHandoff(session: Session, open: boolean): UseHandoff {
  const queryClient = useQueryClient();
  const sessionId = session.id;
  const name = agentName(session.agent_type);

  const { data, isLoading } = useQuery({
    queryKey: handoffKeys.preview(sessionId),
    queryFn: () => fetchPreview(sessionId),
    enabled: open,
    staleTime: 0,
    refetchInterval: open ? PREVIEW_POLL_MS : false,
    retry: false,
  });

  const post = useCallback(
    async <T>(action: string, body: unknown): Promise<T> => {
      const res = await fetchAsUser(`/api/sessions/${sessionId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {
        throw new Error("Couldn't reach the server");
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new HandoffRequestError(
          handoffRefusalText(res.status, json, name),
          res.status,
          json
        );
      }
      return json as T;
    },
    [sessionId, name]
  );

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    queryClient.invalidateQueries({ queryKey: handoffKeys.preview(sessionId) });
  }, [queryClient, sessionId]);

  const switchModel = useCallback(
    async (request: ModelSwitchRequest) => {
      const result = await post<ModelSwitchResult>("model", request);
      refresh();
      queryClient.invalidateQueries({ queryKey: queueKeys.session(sessionId) });
      queryClient.invalidateQueries({
        queryKey: claudeStateKeys.session(sessionId),
      });
      return result;
    },
    [post, refresh, queryClient, sessionId]
  );

  const handOff = useCallback(
    async (request: HandoffRequest) => {
      const result = await post<HandoffResult>("handoff", request);
      refresh();
      return result;
    },
    [post, refresh]
  );

  const resumePaused = useCallback(
    async (force?: boolean) => {
      const result = await post<ResumePausedResult>("resume-paused", {
        force: !!force,
      });
      refresh();
      return result;
    },
    [post, refresh]
  );

  return {
    preview: (open && data) || null,
    loading: open && isLoading,
    switchModel,
    handOff,
    resumePaused,
  };
}
