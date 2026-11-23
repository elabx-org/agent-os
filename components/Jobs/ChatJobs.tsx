"use client";

import type { Session } from "@/lib/db";
import { useJobs } from "@/data/jobs";
import { useTabMachineId } from "@/data/machines";
import { isOver } from "@/lib/jobs/types";
import { openJob } from "@/stores/jobSheet";
import { openPage } from "@/stores/workspacePage";
import { JobLine, useJobClock } from "./parts";

/** A job that ended stays in the chat this long, then lives on the Runners page */
const LINGER_MS = 15 * 60 * 1000;
const SHOWN = 3;

/**
 * Above the composer of a chat that handed work to another machine: each
 * job that is going or just ended, where it runs and how far it is.
 * Tapping one opens its details. Nothing when the chat sent none
 */
export function ChatJobs({
  session,
  working,
}: {
  session: Session;
  /** The chat is in a turn: it may send a job any moment */
  working: boolean;
}) {
  // Jobs are sent from the server: a chat on a linked machine has none
  const elsewhere = useTabMachineId();
  const { data } = useJobs(session.id, !elsewhere, working);
  const now = useJobClock(data?.jobs);
  const jobs = (data?.jobs ?? []).filter(
    (j) => !isOver(j.state) || now - (j.endedAt ?? 0) < LINGER_MS
  );
  if (jobs.length === 0) return null;
  // Oldest first, as they were sent; the newest when there are many
  const shown = jobs.slice(0, SHOWN).reverse();
  const more = (data?.jobs.length ?? 0) - shown.length;
  return (
    <section
      aria-label="Jobs on other machines"
      className="border-border/70 bg-card/60 divide-border/60 mx-3 mb-1.5 divide-y overflow-hidden rounded-xl border"
    >
      {shown.map((job) => (
        <JobLine
          key={job.id}
          job={job}
          now={now}
          onOpen={(j) => openJob(j.id)}
        />
      ))}
      {more > 0 && (
        <button
          type="button"
          onClick={() => openPage({ kind: "runners", sessionId: session.id })}
          className="text-primary active:bg-foreground/5 min-h-[40px] w-full px-3 text-left text-[13px] font-semibold"
        >
          {more === 1 ? "1 earlier job" : `${more} earlier jobs`} from this chat
        </button>
      )}
    </section>
  );
}
