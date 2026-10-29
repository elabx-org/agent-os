"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CirclePause, Loader2 } from "lucide-react";
import { Avatar, agentAvatar, agentName } from "@/components/a/Avatar";
import { confirmAction } from "@/components/ui/confirm";
import { sessionKeys } from "@/data/sessions/keys";
import { useSessionsQuery } from "@/data/sessions/queries";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import type { Session } from "@/lib/db";
import type {
  HandoffError,
  ResumePausedRequest,
  ResumePausedResult,
} from "@/lib/handoff-types";
import { successorOf } from "@/lib/paused";
import { cn } from "@/lib/utils";

/**
 * Where a paused (handed-off) session's composer was: "Paused · handed off
 * to Codex", Open that session, and Resume here (resume-paused, warns when
 * the successor still runs in the same folder)
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
  const queryClient = useQueryClient();
  const sessions = useSessionsQuery().data?.sessions ?? NO_SESSIONS;
  const successor = successorOf(session, sessions);
  const titles = useListTitles(successor ? [successor] : NO_SESSIONS);
  const successorTitle = successor
    ? displayTitle(successor, titles).title
    : null;
  const agent = successor ? agentName(successor.agent_type) : null;
  const [resuming, setResuming] = useState(false);

  const openSuccessor = () => {
    if (!successor) return;
    if (onOpenSuccessor) onOpenSuccessor(successor.id);
    else showSession(successor);
  };

  const post = (body: ResumePausedRequest) =>
    fetchAsUser(`/api/sessions/${session.id}/resume-paused`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const resume = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      let res = await post({});
      let data = (await res.json().catch(() => ({}))) as
        | ResumePausedResult
        | HandoffError;
      // The session it went to still works here: both would edit the files
      if (
        res.status === 409 &&
        "reason" in data &&
        data.reason === "successor_live"
      ) {
        const liveId = data.successorId;
        const live =
          (liveId && sessions.find((s) => s.id === liveId)) || successor;
        const who = live ? displayTitle(live, titles).title : "The new session";
        const ok = await confirmAction({
          title: `Resume ${session.name}?`,
          message: `${who} still works in this folder; both would edit the same files.`,
          confirmLabel: "Resume anyway",
        });
        if (!ok) return;
        res = await post({ force: true });
        data = (await res.json().catch(() => ({}))) as
          | ResumePausedResult
          | HandoffError;
      }
      if (!res.ok || !("session" in data))
        throw new Error(
          res.status === 501
            ? "Resuming isn't available yet"
            : refusalText(data as HandoffError)
        );
      await queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
      showSession(data.session);
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
          Resume here
        </button>
      </div>
    </div>
  );
}
