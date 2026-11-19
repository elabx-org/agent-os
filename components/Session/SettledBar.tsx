"use client";

import { useState } from "react";
import { CircleCheck, Laptop, Loader2 } from "lucide-react";
import type { Session } from "@/lib/db";
import { settledLine } from "@/lib/settle-types";
import { resumeLabel } from "@/lib/settle-views";
import { cn } from "@/lib/utils";
import { followLink } from "@/lib/client/machine";
import { HUB_TARGET } from "@/lib/machine-marker";
import { parseMovedTo, type MovedTo } from "@/lib/session-move-types";
import { useMachines } from "@/data/machines";
import { openContinueSheet } from "@/stores/continueSheet";
import { useSettleActions } from "./settle-action";

/**
 * Where a settled session's composer was: "Settled · PR #106 merged" and
 * Resume (DELETE settle: relaunches Claude with --resume)
 */
export interface SettledBarProps {
  session: Session;
  className?: string;
}

/**
 * A session that went on to another machine: "Continued on Mac Studio",
 * open it there or bring it back. Resuming this copy would make two, so
 * that is only offered once the machine is no longer linked
 */
function MovedBar({
  session,
  to,
  className,
  onResume,
  resuming,
}: {
  session: Session;
  to: MovedTo;
  className?: string;
  onResume: () => void;
  resuming: boolean;
}) {
  const { data } = useMachines();
  const linked =
    to.machine === HUB_TARGET ||
    !data ||
    data.machines.some((m) => m.id === to.machine && m.status === "approved");
  return (
    <div role="status" className={cn("glass composer-card", className)}>
      <div className="text-muted-foreground flex min-w-0 items-center gap-2 px-1 text-[13px]">
        <Laptop className="h-4 w-4 flex-none" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {linked
            ? settledLine(session)
            : `${settledLine(session)}, which is no longer linked`}
        </span>
      </div>
      {linked ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => followLink(to.machine, session.id)}
            className="pill pill-primary pill-sm min-w-0 flex-1 active:opacity-80"
          >
            <span className="truncate">Open it there</span>
          </button>
          <button
            type="button"
            onClick={() =>
              openContinueSheet(session.id, session.name, to.machine)
            }
            className="pill pill-secondary pill-sm min-w-0 flex-1 active:opacity-80"
          >
            <span className="truncate">Bring it back</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onResume}
          disabled={resuming}
          className="pill pill-secondary pill-sm w-full active:opacity-80 disabled:opacity-60"
        >
          {resuming && <Loader2 className="h-4 w-4 animate-spin" />}
          Resume this copy here
        </button>
      )}
    </div>
  );
}

export function SettledBar({ session, className }: SettledBarProps) {
  const { unsettle } = useSettleActions();
  const [resuming, setResuming] = useState(false);

  const resume = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      await unsettle(session);
    } finally {
      setResuming(false);
    }
  };

  const movedTo =
    session.settled_reason === "moved" ? parseMovedTo(session.moved_to) : null;
  if (movedTo) {
    return (
      <MovedBar
        session={session}
        to={movedTo}
        className={className}
        onResume={resume}
        resuming={resuming}
      />
    );
  }

  return (
    <div role="status" className={cn("glass composer-card", className)}>
      <div className="text-muted-foreground flex min-w-0 items-center gap-2 px-1 text-[13px]">
        <CircleCheck className="h-4 w-4 flex-none" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{settledLine(session)}</span>
      </div>
      <button
        type="button"
        onClick={resume}
        disabled={resuming}
        className="pill pill-secondary pill-sm w-full active:opacity-80 disabled:opacity-60"
      >
        {resuming && <Loader2 className="h-4 w-4 animate-spin" />}
        {resumeLabel(session.agent_type)}
      </button>
    </div>
  );
}
