"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CirclePause, Loader2 } from "lucide-react";
import { Avatar, agentAvatar, agentName } from "@/components/a/Avatar";
import { confirmAction } from "@/components/ui/confirm";
import { useSessionsQuery } from "@/data/sessions/queries";
import { HandoffRequestError, useHandoff } from "@/hooks/useHandoff";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import type { Session } from "@/lib/db";
import { successorOf } from "@/lib/paused";
import { cn } from "@/lib/utils";

/**
 * Where a paused (handed-off) session's composer was: "Paused · handed off
 * to Codex", Open that session, and Resume here (resume-paused, warns when
 * the successor still runs in the same folder). Codex and Gemini keep no
 * conversation to resume: theirs is "Start fresh here"
 */
export interface PausedBarProps {
  session: Session;
  /** Open the session it was handed to */
  onOpenSuccessor?: (sessionId: string) => void;
  className?: string;
}

const NO_SESSIONS: Session[] = [];

/** The page attaches a session sent this way (lib/restart-session.ts) */
function showSession(session: Session) {
  window.dispatchEvent(
    new CustomEvent("agentos-session-restarted", { detail: { session } })
  );
}

export function PausedBar({
  session,
  onOpenSuccessor,
  className,
}: PausedBarProps) {
  const sessions = useSessionsQuery().data?.sessions ?? NO_SESSIONS;
  const successor = successorOf(session, sessions);
  const titles = useListTitles(successor ? [successor] : NO_SESSIONS);
  const successorTitle = successor
    ? displayTitle(successor, titles).title
    : null;
  const agent = successor ? agentName(successor.agent_type) : null;
  const [resuming, setResuming] = useState(false);
  const { resumePaused } = useHandoff(session, false);
  const resumes = (session.agent_type || "claude") === "claude";

  const openSuccessor = () => {
    if (!successor) return;
    if (onOpenSuccessor) onOpenSuccessor(successor.id);
    else showSession(successor);
  };

  const resume = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      let result;
      try {
        result = await resumePaused();
      } catch (error) {
        // The session it went to still works here: both would edit the files
        if (
          !(error instanceof HandoffRequestError) ||
          error.body?.reason !== "successor_live"
        )
          throw error;
        const liveId = error.body.successorId;
        const live =
          (liveId && sessions.find((s) => s.id === liveId)) || successor;
        const who = live
          ? `${agentName(live.agent_type)} ("${displayTitle(live, titles).title}")`
          : "The new session";
        const ok = await confirmAction({
          title: resumes ? "Resume here anyway?" : "Start fresh here anyway?",
          message: `${who} still works in this folder; both would edit the same files.`,
          confirmLabel: resumes ? "Resume anyway" : "Start anyway",
        });
        if (!ok) return;
        result = await resumePaused(true);
      }
      showSession(result.session);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't resume the session"
      );
    } finally {
      setResuming(false);
    }
  };

  const line = [
    "Paused",
    agent
      ? `handed off to ${agent}`
      : session.handoff_to_session_id
        ? "handed off"
        : null,
    successorTitle,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div role="status" className={cn("glass composer-card", className)}>
      <div className="text-muted-foreground flex min-w-0 items-center gap-2 px-1 text-[13px]">
        <CirclePause className="h-4 w-4 flex-none" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{line}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {successor && agent && (
          <button
            type="button"
            onClick={openSuccessor}
            className="pill pill-primary pill-sm min-w-0 flex-1 active:opacity-80"
          >
            <Avatar {...agentAvatar(successor.agent_type)} size="sm" />
            <span className="truncate">Open {agent}</span>
          </button>
        )}
        <button
          type="button"
          onClick={resume}
          disabled={resuming}
          className={cn(
            "pill pill-secondary pill-sm active:opacity-80 disabled:opacity-60",
            successor ? "flex-none" : "flex-1"
          )}
        >
          {resuming && <Loader2 className="h-4 w-4 animate-spin" />}
          {resumes ? "Resume here" : "Start fresh here"}
        </button>
      </div>
    </div>
  );
}
