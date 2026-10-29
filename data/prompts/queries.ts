import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PermissionPrompt, PromptOption } from "@/lib/permission-prompt";
import { useSharedPoll } from "@/hooks/useSharedPoll";
import { fetchAsUser } from "@/lib/client/user-fetch";

const PROMPT_POLL_MS = 2000;

export const promptKeys = {
  session: (sessionId: string) => ["session-prompt", sessionId] as const,
};

async function fetchPrompt(id: string): Promise<PermissionPrompt | null> {
  const res = await fetch(`/api/sessions/${id}/prompt`);
  if (!res.ok) return null;
  return (await res.json()).prompt ?? null;
}

/** The selection prompt the session is showing, if any (the Inbox's card) */
export function useSessionPrompt(
  sessionId: string,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const queryKey = promptKeys.session(sessionId);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchPrompt(sessionId),
    enabled,
    staleTime: PROMPT_POLL_MS,
  });
  useSharedPoll(queryKey, PROMPT_POLL_MS, enabled);
  return query;
}

/** Picks an option of the session's prompt, then rereads the prompt */
export function useAnswerPrompt(sessionId: string) {
  const queryClient = useQueryClient();
  const [answering, setAnswering] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (option: PromptOption) => {
    setAnswering(option.index);
    setError(null);
    try {
      const res = await fetchAsUser(`/api/sessions/${sessionId}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: option.index, label: option.label }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body.reason === "no_proof"
            ? "Reload to confirm it's you"
            : (body.error ?? "Couldn't answer")
        );
      }
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setAnswering(null);
      queryClient.invalidateQueries({
        queryKey: promptKeys.session(sessionId),
      });
    }
  };

  return { answer, answering, error };
}
