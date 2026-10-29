"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CancelMoveResult,
  MoveError,
  MovePreview,
  MoveRequest,
  MoveResult,
  MoveState,
  MovesList,
} from "@/lib/worktree-move-types";
import { fetchAsUser } from "@/lib/client/user-fetch";
import { sessionKeys } from "@/data/sessions/keys";
import { useSharedPoll } from "@/hooks/useSharedPoll";
import type { Session } from "@/lib/db";
import { PROVIDER_MAP, type ProviderId } from "@/lib/providers/registry";
import {
  canOfferMove,
  moveRefusalText,
  movesPollMs,
} from "@/components/Session/move-sheet-model";

/** A refused move or cancel: the route's status and body, the text as message */
export class MoveRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: MoveError | null
  ) {
    super(message);
  }
}

export const moveKeys = {
  preview: (sessionId: string) => ["move-preview", sessionId] as const,
  list: ["worktree-moves"] as const,
};

/** While the sheet is open: busy turns to free, scheduled to moving */
const PREVIEW_POLL_MS = 3000;

/**
 * The "Move to a worktree" sheet's data and actions (M5, N-Worktree).
 * Actions go through fetchAsUser (user-only routes) and refresh the
 * sessions list and the moves list; they throw with the route's refusal
 * text.
 */
export interface UseWorktreeMove {
  /** GET move-to-worktree/preview while `open`; null until loaded */
  preview: MovePreview | null;
  loading: boolean;
  /** Why the preview couldn't be read (while there is none) */
  error: string | null;
  move: (request: MoveRequest) => Promise<MoveResult>;
  /** Cancels the scheduled move */
  cancel: () => Promise<CancelMoveResult>;
}

async function fetchPreview(sessionId: string): Promise<MovePreview> {
  const res = await fetch(
    `/api/sessions/${sessionId}/move-to-worktree/preview`
  ).catch(() => {
    throw new Error("Couldn't reach the server");
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      res.status === 404 ? "This session is gone" : moveRefusalText(body)
    );
  }
  return (await res.json()) as MovePreview;
}

async function fetchMoves(): Promise<MoveState[]> {
  const res = await fetch("/api/worktree-moves");
  if (!res.ok) return [];
  const data = (await res.json()) as MovesList;
  return Array.isArray(data?.moves) ? data.moves : [];
}

export function useWorktreeMove(
  sessionId: string,
  open: boolean
): UseWorktreeMove {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: moveKeys.preview(sessionId),
    queryFn: () => fetchPreview(sessionId),
    enabled: open,
    staleTime: 0,
    refetchInterval: open ? PREVIEW_POLL_MS : false,
    retry: false,
  });

  const send = useCallback(
    async <T>(method: "POST" | "DELETE", body?: unknown): Promise<T> => {
      const res = await fetchAsUser(
        `/api/sessions/${sessionId}/move-to-worktree`,
        {
          method,
          ...(body !== undefined
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        }
      ).catch(() => {
        throw new Error("Couldn't reach the server");
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new MoveRequestError(moveRefusalText(json), res.status, json);
      }
      return json as T;
    },
    [sessionId]
  );

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    queryClient.invalidateQueries({ queryKey: moveKeys.preview(sessionId) });
    queryClient.invalidateQueries({ queryKey: moveKeys.list });
  }, [queryClient, sessionId]);

  const move = useCallback(
    async (request: MoveRequest) => {
      try {
        return await send<MoveResult>("POST", request);
      } finally {
        // A refusal can mean it changed meanwhile (busy, staged)
        refresh();
      }
    },
    [send, refresh]
  );

  const cancel = useCallback(async () => {
    try {
      return await send<CancelMoveResult>("DELETE");
    } finally {
      refresh();
    }
  }, [send, refresh]);

  return {
    preview: (open && data) || null,
    loading: open && isLoading,
    error: open && error ? error.message : null,
    move,
    cancel,
  };
}

const NO_MOVES: MoveState[] = [];

/**
 * Every scheduled, running or failed move by session id (GET
 * /api/worktree-moves through useSharedPoll), for Now's "Moving…"
 */
export function useWorktreeMoves(): Record<string, MoveState> {
  const { data = NO_MOVES } = useQuery({
    queryKey: moveKeys.list,
    queryFn: fetchMoves,
    staleTime: 2000,
    retry: false,
  });
  // Quick while one waits or runs; slow otherwise, to catch a move
  // scheduled from another device
  useSharedPoll(moveKeys.list, movesPollMs(data));
  return useMemo(() => {
    const byId: Record<string, MoveState> = {};
    for (const m of data) byId[m.sessionId] = m;
    return byId;
  }, [data]);
}

async function fetchIsGit(dir: string): Promise<boolean> {
  const res = await fetch("/api/git/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: dir }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { isGitRepo?: boolean };
  return !!data?.isGitRepo;
}

/**
 * Whether the move can be offered for `session` (canOfferMove): a git
 * folder, checked once per folder and kept for minutes; false until known
 */
export function useCanOfferMove(session: Session | null | undefined): boolean {
  const dir = session?.working_directory ?? "";
  const nativeWorktreeFlag = !!PROVIDER_MAP.get(
    (session?.agent_type || "claude") as ProviderId
  )?.worktreeFlag;
  // Everything but git first: only then is the folder checked
  const pre =
    !!session && canOfferMove(session, { nativeWorktreeFlag, isGit: true });
  const { data } = useQuery({
    queryKey: ["git-check", dir],
    queryFn: () => fetchIsGit(dir),
    enabled: pre && !!dir,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return (
    !!session &&
    canOfferMove(session, { nativeWorktreeFlag, isGit: data ?? null })
  );
}
