import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSharedPoll } from "@/hooks/useSharedPoll";
import { useSessionPrompt } from "@/data/prompts/queries";
import { mergePrompt, type ReplyContext } from "@/lib/reply-context";

const CONTEXT_POLL_MS = 2000;

export const replyContextKeys = {
  session: (sessionId: string) => ["reply-context", sessionId] as const,
};

async function fetchContext(id: string): Promise<ReplyContext | null> {
  const res = await fetch(`/api/sessions/${id}/reply-context`);
  if (!res.ok) return null;
  return (await res.json()).context ?? null;
}

/**
 * What a reply in this session answers, with the prompt on screen folded in.
 * Polled only while `active` (the composer is in use); null if there's
 * nothing to show.
 */
export function useReplyContext(
  sessionId: string | null | undefined,
  active: boolean
): ReplyContext | null {
  const enabled = !!sessionId && active;
  const queryKey = replyContextKeys.session(sessionId ?? "");
  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchContext(sessionId!),
    enabled,
    staleTime: CONTEXT_POLL_MS,
  });
  useSharedPoll(queryKey, CONTEXT_POLL_MS, enabled);
  const { data: prompt } = useSessionPrompt(sessionId ?? "", { enabled });
  return useMemo(
    () => (sessionId ? mergePrompt(data ?? null, prompt) : null),
    [sessionId, data, prompt]
  );
}
