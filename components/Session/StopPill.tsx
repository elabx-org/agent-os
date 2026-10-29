"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { Loader2 } from "lucide-react";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import { mobileNavStore } from "@/stores/mobileNav";
import { interruptSession } from "@/components/DeckActions";

export interface StopPillProps {
  session: Session;
  className?: string;
}

/**
 * Fold-Chat's "■ Stop" pill beside the composer, while the agent works or
 * asks: interrupts it (POST /api/sessions/[id]/interrupt), which also
 * turns a question down. Nothing while idle
 */
export function StopPill({ session, className }: StopPillProps) {
  const { statuses } = useSnapshot(mobileNavStore);
  const [stopping, setStopping] = useState(false);
  const status = statuses[session.id]?.status;
  if (status !== "running" && status !== "waiting") return null;

  return (
    <button
      type="button"
      aria-label="Stop"
      title="Stop (Esc)"
      disabled={stopping}
      // The composer keeps focus, so the keyboard stays up
      onMouseDown={(e) => e.preventDefault()}
      onClick={async () => {
        setStopping(true);
        try {
          await interruptSession(session.id);
        } finally {
          setStopping(false);
        }
      }}
      className={cn(
        "pill pill-secondary h-[52px] shrink-0 touch-manipulation rounded-[26px] text-red-600 disabled:opacity-60 dark:text-[#FCA5A5]",
        className
      )}
    >
      {stopping ? (
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
      ) : (
        <span aria-hidden className="h-3 w-3 rounded-[3px] bg-current" />
      )}
      Stop
    </button>
  );
}
