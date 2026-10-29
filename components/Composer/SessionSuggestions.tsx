"use client";

import { useEffect, useRef } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, agentAvatar } from "@/components/a/Avatar";
import { StateDot } from "@/components/a/StateDot";
import { STATE_WORD, type AgentState } from "@/lib/agent-state";
import type {
  AttachableSession,
  AttachableStatus,
} from "@/lib/session-attach-types";
import { formatTokens } from "./attach-model";

/**
 * The @ popover's Sessions tab (N-Attach): rows with avatar, name, status
 * dot · project, "Summary / N tokens" (or "✓ Attached"), and the caption
 * "The agent gets a summary of that session, not its full transcript."
 */
export interface SessionSuggestionsProps {
  /** The composer box points at it (aria-controls) and its options */
  id: string;
  sessions: AttachableSession[];
  /** Already attached: shown checked, a tap detaches */
  attachedIds: string[];
  selected: number;
  onHover: (index: number) => void;
  onToggle: (session: AttachableSession) => void;
  loading?: boolean;
}

const STATE: Record<AttachableStatus, AgentState> = {
  needs_you: "needs",
  working: "work",
  idle: "idle",
  limited: "limited",
  paused: "paused",
  settled: "settled",
};

export function SessionSuggestions({
  id,
  sessions,
  attachedIds,
  selected,
  onHover,
  onToggle,
  loading = false,
}: SessionSuggestionsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <>
      <div
        ref={listRef}
        id={id}
        role="listbox"
        aria-label="Sessions"
        aria-multiselectable="true"
        className="max-h-[min(34vh,232px)] overflow-y-auto overscroll-contain"
      >
        {sessions.length === 0 && (
          <div className="text-muted-foreground flex min-h-14 items-center gap-2 px-3.5 text-sm">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…
              </>
            ) : (
              "No other sessions"
            )}
          </div>
        )}
        {sessions.map((s, i) => {
          const on = attachedIds.includes(s.id);
          const state = STATE[s.status];
          const tokens = s.tokens === null ? null : formatTokens(s.tokens);
          return (
            <button
              key={s.id}
              type="button"
              id={`${id}-${i}`}
              role="option"
              aria-selected={on}
              tabIndex={-1}
              data-index={i}
              data-attached={on || undefined}
              // Keep the keyboard up: focus stays in the box
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onHover(i)}
              onClick={() => onToggle(s)}
              className={cn(
                "flex min-h-14 w-full items-center gap-2.5 px-3.5 py-2 text-left",
                i > 0 && "border-t border-[var(--hair)]",
                on
                  ? "bg-primary/16"
                  : i === selected
                    ? "bg-foreground/[0.06]"
                    : "active:bg-muted",
                on && i === selected && "bg-primary/22"
              )}
            >
              <Avatar {...agentAvatar(s.agentType)} size="sm" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-medium">
                  {s.name}
                </span>
                <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[13px]">
                  <StateDot state={state} size={6} />
                  <span className="truncate">
                    {STATE_WORD[state]}
                    {s.projectName ? ` · ${s.projectName}` : ""}
                  </span>
                </span>
              </span>
              <span
                className={cn(
                  "flex flex-none flex-col items-end text-xs leading-[1.3]",
                  on
                    ? "text-[#6D28D9] dark:text-[#C4B5FD]"
                    : "text-muted-foreground"
                )}
              >
                {on ? (
                  <span className="flex items-center gap-1">
                    <Check className="h-3 w-3" strokeWidth={2.8} />
                    Attached
                  </span>
                ) : (
                  <span>Summary</span>
                )}
                {tokens && <span>{tokens}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="text-muted-foreground border-t border-[var(--hair)] px-3.5 pt-2.5 pb-3 text-[13px]">
        The agent gets a summary of that session, not its full transcript.
      </div>
    </>
  );
}
