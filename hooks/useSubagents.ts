import { useEffect, useState } from "react";
import type { SubagentInfo } from "@/lib/claude-subagents";

const AGENTS_POLL_MS = 3000;

/** The subagents the session has started, by the Agent call that started each */
export function useSubagents(sessionId: string, active: boolean) {
  const [agents, setAgents] = useState<SubagentInfo[]>([]);
  useEffect(() => {
    setAgents([]);
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/subagents`);
        const data = await res.json();
        if (!stopped) setAgents(data.subagents ?? []);
      } catch {
        // Try again next tick
      }
      if (!stopped) timer = setTimeout(poll, AGENTS_POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionId, active]);
  return agents;
}
