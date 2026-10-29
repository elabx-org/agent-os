"use client";

import { useState } from "react";
import { CircleCheck, Loader2 } from "lucide-react";
import type { Session } from "@/lib/db";
import { settledLine } from "@/lib/settle-types";
import { resumeLabel } from "@/lib/settle-views";
import { cn } from "@/lib/utils";
import { useSettleActions } from "./settle-action";

/**
 * Where a settled session's composer was: "Settled · PR #106 merged" and
 * Resume (DELETE settle: relaunches Claude with --resume)
 */
export interface SettledBarProps {
  session: Session;
  className?: string;
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
