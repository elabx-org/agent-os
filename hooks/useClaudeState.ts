import { useQuery } from "@tanstack/react-query";
import type { ClaudeState } from "@/lib/claude-state";
import { useSharedPoll } from "./useSharedPoll";

const STATE_POLL_MS = 1500;

export const claudeStateKeys = {
  session: (sessionId: string) => ["claude-state", sessionId] as const,
};

async function fetchClaudeState(sessionId: string): Promise<ClaudeState> {
  const res = await fetch(`/api/sessions/${sessionId}/claude-state`);
  if (!res.ok) throw new Error("Failed to fetch Claude state");
  return res.json();
}

/**
 * What the session's Claude Code last recorded (permission mode, busy,
 * current tool, pending permission, status line), one poll per session
 */
export function useClaudeState(
  sessionId: string | null | undefined,
  active = true
): ClaudeState {
  const enabled = !!sessionId && active;
  const queryKey = claudeStateKeys.session(sessionId ?? "");
  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchClaudeState(sessionId!),
    enabled,
    staleTime: STATE_POLL_MS,
  });
  useSharedPoll(queryKey, STATE_POLL_MS, enabled);
  return (enabled && data) || NONE;
}

// lib/claude-state reads files, so the empty state is repeated here; one
// object, so consumers' memos don't rerun on every render
const NONE: ClaudeState = {
  claudeSessionId: null,
  status: null,
  mode: null,
  busy: null,
  currentTool: null,
  pendingPermission: null,
  notification: null,
  updatedAt: null,
};
