"use client";

import { ChevronDown } from "lucide-react";
import type { Session } from "@/lib/db";
import type { SessionStatus } from "@/components/views/types";
import { Avatar, agentAvatar } from "@/components/a/Avatar";
import {
  STATE_TEXT_CLASS,
  STATE_WORD,
  fromSessionStatus,
} from "@/lib/agent-state";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { cn } from "@/lib/utils";
import { shortAge } from "./model";

export interface SessionPillProps {
  session: Session;
  status?: SessionStatus;
  /** The chevron: pick another session for this side */
  onPick: () => void;
  className?: string;
}

/**
 * Open-Beside: a glass pill floating over each pane, the agent tile, the
 * session's name and its state line ("Needs you" amber, "Working · 6m"
 * green) and a chevron. The whole pill picks another session for its side.
 */
export function SessionPill({
  session,
  status,
  onPick,
  className,
}: SessionPillProps) {
  const titles = useListTitles([session]);
  const { title } = displayTitle(session, titles);
  const state = fromSessionStatus(status?.status ?? "idle");
  const line =
    state === "work"
      ? `${STATE_WORD.work} · ${shortAge(session.updated_at)}`
      : STATE_WORD[state];

  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`${title}, ${line}. Show another session here`}
      className={cn(
        "glass flex h-11 max-w-full min-w-0 items-center gap-2.5 rounded-full pr-3.5 pl-2 text-left active:opacity-80",
        className
      )}
    >
      <Avatar {...agentAvatar(session.agent_type)} size="sm" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-semibold">{title}</span>
        <span className={cn("truncate text-xs", STATE_TEXT_CLASS[state])}>
          {line}
        </span>
      </span>
      <ChevronDown
        aria-hidden
        className="text-muted-foreground h-4 w-4 flex-none"
      />
    </button>
  );
}
