"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { KindBadge, StateWord } from "@/components/rows/AgentRow";
import { fromSubagentStatus } from "@/lib/agent-state";
import type { SubagentInfo } from "@/lib/claude-subagents";
import { Conversation } from "./Conversation";
import { buildRows } from "./rows";
import { useTranscript } from "./useTranscript";

/**
 * One subagent's own conversation: over the chat on a phone, beside it when
 * there's room (an iPhone Duo opened flat, a desktop)
 */
export function SubagentPanel({
  sessionId,
  agent,
  onClose,
  className,
}: {
  sessionId: string;
  agent: SubagentInfo;
  onClose: () => void;
  className?: string;
}) {
  const { items, state, truncated, loadEarlier, loadingEarlier } =
    useTranscript(
      `/api/sessions/${sessionId}/subagents/${agent.agentId}`,
      true
    );
  const { rows, results } = useMemo(() => buildRows(items), [items]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <section
      aria-label={agent.description}
      className={cn(
        "bg-background border-border absolute inset-0 z-10 flex flex-col @2xl/chat:static @2xl/chat:w-[46%] @2xl/chat:max-w-xl @2xl/chat:shrink-0 @2xl/chat:border-l",
        className
      )}
    >
      <header className="border-border flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the conversation"
          className="text-primary active:bg-accent hover:bg-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {agent.description}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            <StateWord state={fromSubagentStatus(agent.status)} /> ·{" "}
            {agent.agentType || "Agent"}
          </div>
        </div>
        <KindBadge kind="subagent" state={fromSubagentStatus(agent.status)} />
        <span className="w-2" />
      </header>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[calc(0.75rem+var(--pane-inset-bottom,env(safe-area-inset-bottom)))]"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {state === "loading" && (
            <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {state === "missing" && (
            <div className="text-muted-foreground py-8 text-sm">
              This agent&apos;s conversation isn&apos;t available.
            </div>
          )}
          {state === "ready" && truncated && (
            <div className="flex justify-center py-1">
              <button
                type="button"
                onClick={loadEarlier}
                disabled={loadingEarlier}
                className="text-muted-foreground active:bg-accent hover:bg-accent flex h-9 items-center gap-2 rounded-full px-4 text-xs"
              >
                {loadingEarlier && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Earlier messages
              </button>
            </div>
          )}
          <Conversation rows={rows} results={results} />
          {agent.status === "running" && (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />
              Working
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
