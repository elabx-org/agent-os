"use client";

import { useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionsQuery } from "@/data/sessions";
import { requestOpenSession, sentToastTitle } from "@/lib/bg-send";
import { bgSendStore, dismissSentToast } from "@/stores/bgSend";
import { mobileNavStore } from "@/stores/mobileNav";
import type { SessionStatus } from "@/components/views/types";

type Status = SessionStatus["status"];

export type SentToastTone = "work" | "needs" | "quiet";

/**
 * The toast's state line for the session the message went to. Just sent,
 * it may still read idle before its turn starts (or while the message waits
 * in its queue), so idle is "Done" only once it was seen working
 */
export function sentToastState(
  status: Status | undefined,
  seenWorking: boolean
): { word: string; tone: SentToastTone } {
  switch (status) {
    case "running":
      return { word: "Keeps working", tone: "work" };
    case "waiting":
      return { word: "Needs you", tone: "needs" };
    case "dead":
      return { word: "Stopped", tone: "quiet" };
    case "error":
      return { word: "Error", tone: "quiet" };
    default:
      return seenWorking
        ? { word: "Done", tone: "work" }
        : { word: "Keeps working", tone: "work" };
  }
}

const DOT: Record<SentToastTone, string> = {
  work: "bg-work",
  needs: "bg-needs",
  quiet: "bg-muted-foreground",
};

/** The glass "Sent to <name> · Keeps working · Open" toast over the fresh
    session `sessionId` (stores/bgSend.ts toast); Open shows the session the
    message went to */
export function SentToast({ sessionId }: { sessionId: string }) {
  const { toast } = useSnapshot(bgSendStore);
  if (!toast || toast.sessionId !== sessionId) return null;
  return (
    <SentToastCard
      key={`${toast.sessionId}:${toast.sentToId}`}
      sentToId={toast.sentToId}
      sentToName={toast.sentToName}
    />
  );
}

function SentToastCard({
  sentToId,
  sentToName,
}: {
  sentToId: string;
  sentToName: string;
}) {
  const { statuses } = useSnapshot(mobileNavStore);
  const status = statuses[sentToId]?.status;
  const [seenWorking, setSeenWorking] = useState(status === "running");
  useEffect(() => {
    if (status === "running") setSeenWorking(true);
  }, [status]);
  const { word, tone } = sentToastState(status, seenWorking);
  const { data } = useSessionsQuery();
  const sentTo = data?.sessions.find((s) => s.id === sentToId);
  // Gone (deleted elsewhere): nothing left to open or to report on
  useEffect(() => {
    if (data && !sentTo) dismissSentToast();
  }, [data, sentTo]);

  return (
    <div
      role="status"
      className="glass -mx-1 flex items-center gap-2.5 rounded-[20px] py-2 pr-2 pl-3.5"
    >
      <span className="bg-work/15 text-work flex h-7 w-7 flex-none items-center justify-center rounded-full">
        <Check className="h-4 w-4" strokeWidth={2.6} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold">
          {sentToastTitle(sentTo?.name ?? sentToName)}
        </span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-[13px]">
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 flex-none rounded-full", DOT[tone])}
          />
          {word}
        </span>
      </span>
      <button
        type="button"
        disabled={!sentTo}
        onClick={() => {
          if (!sentTo) return;
          requestOpenSession(sentTo);
          dismissSentToast();
        }}
        className="pill pill-secondary flex-none active:opacity-80"
      >
        Open
      </button>
    </div>
  );
}
