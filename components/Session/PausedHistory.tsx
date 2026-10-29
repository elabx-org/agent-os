"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { agentName } from "@/components/a/Avatar";
import type { Session } from "@/lib/db";

/**
 * A handed-off Codex or Gemini session has no transcript and its tmux
 * ended: its paused view shows the terminal as it was at the handoff
 * (lib/paused-history.ts)
 */
export function PausedHistory({ session }: { session: Session }) {
  const { data, isLoading } = useQuery({
    queryKey: ["paused-history", session.id],
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${session.id}/paused-history`);
      if (!res.ok) return null;
      return ((await res.json()) as { text: string | null }).text;
    },
    staleTime: Infinity,
  });
  const name = agentName(session.agent_type);
  const ended = session.settled_at ? "it settled" : "it was handed off";

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading its terminal…
      </div>
    );
  }
  if (!data) {
    return (
      <p className="text-muted-foreground py-8 text-sm">
        {name} keeps no conversation, and its terminal ended when {ended}.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-[13px]">
        {name}&apos;s terminal when {ended}
      </p>
      <pre className="term-blk overflow-x-auto text-[12px] break-words whitespace-pre-wrap">
        {data}
      </pre>
    </div>
  );
}
